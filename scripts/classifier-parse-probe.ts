import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { and, asc, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { generateStructured, type CallRetryError, type ResolveModelConfig } from '@/lib/ai'
import { buildClassifierWindow, classifierReplySchema } from '@/lib/classifier'
import {
  characterRelationships,
  entities,
  happenings,
  storyEntries,
  threads,
  type CharacterRelationship,
  type Entity,
  type Happening,
  type StoryEntry,
  type Thread,
} from '@/lib/db'
import { IdBiMap } from '@/lib/ids'
import { buildClassifierContext } from '@/lib/pipeline/definitions/classifier-context'
import { PASS_TIMEOUT_DEFAULT_MS } from '@/lib/pipeline/definitions/periodic-classifier'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, hydrateAppSettings } from '@/lib/stores'

import { resolveDevSlot } from './dev-slot/resolve'

// Opt-in: the real pass prompt, sent N times to a real provider, for a first-attempt parse rate.
//   SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm probe:classifier
// PROBE_RUNS (20), PROBE_BRANCH_ID (br_hero_main), AVENTURAS_DB_PATH (dev slot db, read-only).
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const RUNS = Number(process.env.PROBE_RUNS ?? 20)
const BRANCH_ID = process.env.PROBE_BRANCH_ID ?? 'br_hero_main'

const PROVIDER_ID = 'prov_probe'
const PROFILE_ID = 'prof_probe'

function resolveDbPath(): string {
  if (process.env.AVENTURAS_DB_PATH) return process.env.AVENTURAS_DB_PATH
  return join(resolveDevSlot().dataDir, 'aventuras.db')
}

// node:sqlite returns row objects; sqlite-proxy needs positional arrays (as scripts/seed/index.ts).
function makeProxy(sqlite: DatabaseSync) {
  return async (sql: string, params: unknown[], method: 'run' | 'all' | 'get' | 'values') => {
    const stmt = sqlite.prepare(sql)
    if (method === 'run') {
      stmt.run(...(params as never[]))
      return { rows: [] }
    }
    const raw = stmt.all(...(params as never[])) as Record<string, unknown>[]
    const asArrays = raw.map((r) => Object.values(r))
    return { rows: (method === 'get' ? asArrays[0] : asArrays) as unknown[] }
  }
}

type Branch = {
  entities: Entity[]
  happenings: Happening[]
  relationships: CharacterRelationship[]
  threads: Thread[]
  entries: StoryEntry[]
}

async function readBranch(dbPath: string, maxEntries: number): Promise<Branch> {
  const sqlite = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const db = drizzle(makeProxy(sqlite))
    return {
      entities: (await db
        .select()
        .from(entities)
        .where(eq(entities.branchId, BRANCH_ID))) as Entity[],
      happenings: (await db
        .select()
        .from(happenings)
        .where(eq(happenings.branchId, BRANCH_ID))) as Happening[],
      relationships: (await db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.branchId, BRANCH_ID))) as CharacterRelationship[],
      threads: (await db.select().from(threads).where(eq(threads.branchId, BRANCH_ID))) as Thread[],
      // From watermark 0, one past the cap so the window sees the cut, as the pass reads it.
      entries: (await db
        .select()
        .from(storyEntries)
        .where(and(eq(storyEntries.branchId, BRANCH_ID), gt(storyEntries.position, 0)))
        .orderBy(asc(storyEntries.position))
        .limit(maxEntries + 1)) as StoryEntry[],
    }
  } finally {
    sqlite.close()
  }
}

type Outcome = {
  status: 'ok' | 'failed' | 'aborted'
  recoverable: CallRetryError[]
  detail?: string
}

const parseRetries = (o: Outcome) => o.recoverable.filter((e) => e.tier === 'parse').length
const providerRetries = (o: Outcome) => o.recoverable.filter((e) => e.tier === 'provider').length

async function main(): Promise<void> {
  if (!LLM_URL || !LLM_MODEL) {
    console.log('[probe] skipped: set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')
    return
  }
  if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`PROBE_RUNS must be a positive integer`)

  // getModel resolves providers through the app-settings store, so the probe's provider goes there.
  const hydrated = await hydrateAppSettings(async () => ({
    providers: [
      {
        id: PROVIDER_ID,
        type: 'openai-compatible',
        displayName: 'Classifier probe',
        apiKey: '',
        endpoint: LLM_URL,
        favoriteModelIds: [LLM_MODEL],
      },
    ],
    profiles: [
      {
        id: PROFILE_ID,
        kind: 'agent',
        name: 'Classifier probe',
        modelRef: { providerId: PROVIDER_ID, modelId: LLM_MODEL },
      },
    ],
    assignments: { classifier: PROFILE_ID },
    defaultProviderId: PROVIDER_ID,
    diagnostics: { enabled: false, debug_level_enabled: false },
  }))
  if (hydrated.status !== 'ok')
    throw new Error(`[probe] provider config rejected: ${hydrated.error}`)
  const settings = appSettingsStore.getAppSettings()
  const config: ResolveModelConfig = {
    providers: settings.providers,
    profiles: settings.profiles,
    assignments: settings.assignments,
  }

  const dbPath = resolveDbPath()
  const maxEntries = settings.classifierWindowMaxEntries
  const branch = await readBranch(dbPath, maxEntries)
  const window = buildClassifierWindow({ entries: branch.entries, processedThrough: 0, maxEntries })
  if (window.isEmpty) throw new Error(`[probe] branch ${BRANCH_ID} in ${dbPath} has no prose`)
  const prompt = renderTemplate(
    TEMPLATE_IDS.periodicClassifier,
    buildClassifierContext({
      window,
      entities: branch.entities,
      happenings: branch.happenings,
      relationships: branch.relationships,
      threads: branch.threads,
      mentionedPlaces: true,
      idMap: new IdBiMap(),
    }),
  )
  const schema = classifierReplySchema(true)
  console.log(
    `[probe] ${dbPath} ${BRANCH_ID}: ${window.turns.length} turns, ` +
      `prompt ${prompt.system.length + prompt.user.length} chars; ${RUNS} runs of ${LLM_MODEL}`,
  )

  const outcomes: Outcome[] = []
  for (let run = 1; run <= RUNS; run++) {
    const startedAt = Date.now()
    const result = await generateStructured(
      'classifier',
      prompt,
      schema,
      config,
      AbortSignal.timeout(PASS_TIMEOUT_DEFAULT_MS),
    )
    if (result.status === 'not-configured')
      throw new Error(`[probe] the classifier target did not resolve: ${result.kind}`)
    const outcome: Outcome = {
      status: result.status,
      recoverable: result.recoverable,
      ...(result.status === 'failed' ? { detail: result.detail } : {}),
    }
    outcomes.push(outcome)
    console.log(
      `[probe] run ${run}: ${outcome.status} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s, ` +
        `${parseRetries(outcome)} parse / ${providerRetries(outcome)} provider retries` +
        (outcome.detail ? ` — ${outcome.detail.replace(/\s+/g, ' ').slice(0, 300)}` : ''),
    )
  }

  const firstAttempt = outcomes.filter((o) => o.status === 'ok' && parseRetries(o) === 0).length
  const afterRetry = outcomes.filter((o) => o.status === 'ok' && parseRetries(o) > 0).length
  // callWithRetry keeps a call's final error out of `recoverable`, so a failed run with a parse
  // entry is one whose first reply didn't parse; its re-call failed for either tier.
  const failedAfterParseRetry = outcomes.filter((o) => o.status === 'failed' && parseRetries(o) > 0)
  const failedOther = outcomes.filter((o) => o.status === 'failed' && parseRetries(o) === 0)
  const aborted = outcomes.filter((o) => o.status === 'aborted')
  console.log(
    `[probe] first-attempt parse ${firstAttempt}/${RUNS} ` +
      `(${((100 * firstAttempt) / RUNS).toFixed(0)}%; a failed or aborted run counts as no success), ` +
      `ok after a parse retry ${afterRetry}, failed after a parse retry ${failedAfterParseRetry.length}, ` +
      `failed with no parse retry ${failedOther.length}, aborted ${aborted.length}, ` +
      `provider retries ${outcomes.reduce((n, o) => n + providerRetries(o), 0)}`,
  )
}

main().catch((err) => {
  console.error('[probe] FAILED:', err)
  process.exitCode = 1
})
