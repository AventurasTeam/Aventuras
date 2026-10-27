import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { and, asc, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'

import {
  describeCallRetryError,
  generateStructured,
  type CallRetryError,
  type ResolveModelConfig,
} from '@/lib/ai'
import {
  buildClassifierWindow,
  classifierReplySchema,
  knownHappenings,
  readClassifierReply,
  type ClassifierWindow,
} from '@/lib/classifier'
import {
  branches,
  characterRelationships,
  entities,
  happenings,
  stories,
  storyEntries,
  storySettingsSchema,
  threads,
  type CharacterRelationship,
  type Entity,
  type Happening,
  type StoryEntry,
  type Thread,
} from '@/lib/db'
import { dbSchema } from '@/lib/db/schema'
import { IdBiMap } from '@/lib/ids'
import { buildClassifierContext } from '@/lib/pipeline/definitions/classifier-context'
import { readRecentEntryIds } from '@/lib/pipeline/definitions/entry-reads'
import { PASS_TIMEOUT_DEFAULT_MS } from '@/lib/pipeline/definitions/periodic-classifier'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { appSettingsStore, hydrateAppSettings } from '@/lib/stores'

import { resolveDevSlot } from './dev-slot/resolve'

// Opt-in: the real pass prompt, sent N times to a real provider, for a first-attempt parse rate.
//   SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm probe:classifier
// PROBE_RUNS (20), PROBE_MAX_OUTPUT (unset), PROBE_BRANCH_ID (br_hero_main), AVENTURAS_DB_PATH
// (dev slot db, read-only).
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const RUNS = Number(process.env.PROBE_RUNS ?? 20)
const MAX_OUTPUT =
  process.env.PROBE_MAX_OUTPUT === undefined ? undefined : Number(process.env.PROBE_MAX_OUTPUT)
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
  /** stories.settings.classifierMentionedPlaces, which picks the pass's prompt and reply schema. */
  mentionedPlaces: boolean
  entities: Entity[]
  /** The Known happenings the pass would list for this window. */
  happenings: Happening[]
  relationships: CharacterRelationship[]
  threads: Thread[]
  window: ClassifierWindow
}

async function readBranch(dbPath: string, maxEntries: number): Promise<Branch> {
  const sqlite = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const db = drizzle(makeProxy(sqlite), { schema: dbSchema })
    const [story] = await db
      .select({ settings: stories.settings })
      .from(branches)
      .innerJoin(stories, eq(stories.id, branches.storyId))
      .where(eq(branches.id, BRANCH_ID))
    if (story == null) throw new Error(`[probe] no branch ${BRANCH_ID} in ${dbPath}`)
    const settings = storySettingsSchema.parse(story.settings)
    // From watermark 0, one past the cap so the window sees the cut, as the pass reads it.
    const entries = (await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, BRANCH_ID), gt(storyEntries.position, 0)))
      .orderBy(asc(storyEntries.position))
      .limit(maxEntries + 1)) as StoryEntry[]
    const window = buildClassifierWindow({ entries, processedThrough: 0, maxEntries })
    if (window.isEmpty) throw new Error(`[probe] branch ${BRANCH_ID} in ${dbPath} has no prose`)
    const branchHappenings = (await db
      .select()
      .from(happenings)
      .where(eq(happenings.branchId, BRANCH_ID))) as Happening[]
    return {
      mentionedPlaces: settings.classifierMentionedPlaces,
      entities: (await db
        .select()
        .from(entities)
        .where(eq(entities.branchId, BRANCH_ID))) as Entity[],
      happenings: knownHappenings(branchHappenings, {
        recorded: window.injectedHappenings,
        recentEntryIds: await readRecentEntryIds(db, BRANCH_ID, {
          firstPosition: window.turns[0]!.position,
          lastPosition: window.turns.at(-1)!.position,
          protectedBuffer: settings.protectedBuffer,
        }),
      }),
      relationships: (await db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.branchId, BRANCH_ID))) as CharacterRelationship[],
      threads: (await db.select().from(threads).where(eq(threads.branchId, BRANCH_ID))) as Thread[],
      window,
    }
  } finally {
    sqlite.close()
  }
}

type Outcome = {
  status: 'ok' | 'failed' | 'aborted'
  recoverable: readonly CallRetryError[]
  detail?: string
  /** The reply stopped at its length limit and didn't parse strictly as a complete reply. */
  cutOff?: true
  /** Entries a tolerant list dropped from a reply that parsed, by list. */
  dropped?: string
}

type ParseRetryError = Extract<CallRetryError, { tier: 'parse' }>

const parseRetries = (o: Outcome) => o.recoverable.filter((e) => e.tier === 'parse').length
const providerRetries = (o: Outcome) => o.recoverable.filter((e) => e.tier === 'provider').length
const oneLine = (text: string) => text.replace(/\s+/g, ' ').slice(0, 300)

// A Zod failure's message is its issues as JSON: name each by path, so a rate can say what broke.
function parseFailureText(detail: string): string {
  let issues: unknown
  try {
    issues = JSON.parse(detail)
  } catch {
    return detail
  }
  if (!Array.isArray(issues) || issues.length === 0) return detail
  return issues
    .map((issue: { path?: unknown[]; message?: string }) => {
      const path = (issue.path ?? []).join('.')
      return `${path === '' ? '(root)' : path}: ${issue.message ?? ''}`
    })
    .join('; ')
}

// As the planner anchors them (classifier.md → What the classifier writes → Happenings): a blank
// title creates nothing, a recounted one carries a temporal, the rest sit at a source turn that
// resolves or get no position. The temporal values are printed so filler like "none" shows.
function anchorCounts(
  happenings: readonly { title: string; temporal?: string; sourceTurn?: string }[],
  window: ClassifierWindow,
) {
  const titled = happenings.filter((h) => h.title.trim() !== '')
  const temporals = titled.map((h) => h.temporal?.trim() ?? '').filter((t) => t !== '')
  const placed = titled.filter((h) => (h.temporal?.trim() ?? '') === '')
  const unanchored = placed.filter((h) => window.resolveHandle(h.sourceTurn).fellBack).length
  return (
    `happenings: ${titled.length} (temporal ${temporals.length}, ` +
    `at source turn ${placed.length - unanchored}, unanchored ${unanchored})` +
    (temporals.length > 0 ? `; temporal values ${JSON.stringify([...new Set(temporals)])}` : '')
  )
}

async function main(): Promise<void> {
  if (!LLM_URL || !LLM_MODEL) {
    console.log('[probe] skipped: set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')
    return
  }
  if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error(`PROBE_RUNS must be a positive integer`)
  if (MAX_OUTPUT !== undefined && (!Number.isInteger(MAX_OUTPUT) || MAX_OUTPUT < 1))
    throw new Error(`PROBE_MAX_OUTPUT must be a positive integer`)

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
        ...(MAX_OUTPUT !== undefined ? { maxOutput: MAX_OUTPUT } : {}),
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
  const { window } = branch
  const prompt = renderTemplate(
    TEMPLATE_IDS.periodicClassifier,
    buildClassifierContext({
      window,
      entities: branch.entities,
      happenings: branch.happenings,
      relationships: branch.relationships,
      threads: branch.threads,
      mentionedPlaces: branch.mentionedPlaces,
      idMap: new IdBiMap(),
    }),
  )
  const schema = classifierReplySchema(branch.mentionedPlaces)
  console.log(
    `[probe] ${dbPath} ${BRANCH_ID}: ${window.turns.length} turns, ` +
      `mentioned places ${branch.mentionedPlaces ? 'on' : 'off'}, ` +
      `prompt ${prompt.system.length + prompt.user.length} chars, ` +
      `max output ${MAX_OUTPUT ?? 'unset'}; ${RUNS} runs of ${LLM_MODEL}`,
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
      { actionId: null },
    )
    if (result.status === 'not-configured')
      throw new Error(`[probe] the classifier target did not resolve: ${result.kind}`)
    const read = result.status === 'ok' ? readClassifierReply(result.value) : null
    const malformed = read?.malformed ?? []
    const outcome: Outcome = {
      status: result.status,
      recoverable: result.recoverable,
      ...(result.status === 'failed'
        ? {
            detail: describeCallRetryError(result.error),
            ...(result.error.tier === 'reply-cut-off' ? { cutOff: true as const } : {}),
          }
        : {}),
      ...(malformed.length > 0
        ? { dropped: malformed.map(({ list, count }) => `${list} ${count}`).join(', ') }
        : {}),
    }
    outcomes.push(outcome)
    console.log(
      `[probe] run ${run}: ${outcome.cutOff === true ? 'cut off at length' : outcome.status} in ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)} s, ` +
        `${parseRetries(outcome)} parse / ${providerRetries(outcome)} provider retries` +
        (outcome.detail ? ` — ${oneLine(outcome.detail)}` : ''),
    )
    if (outcome.dropped != null)
      console.log(`[probe]   dropped entries that didn't fit: ${outcome.dropped}`)
    if (read != null) console.log(`[probe]   ${anchorCounts(read.reply.happenings, window)}`)
    const firstParse = outcome.recoverable.find((e): e is ParseRetryError => e.tier === 'parse')
    if (firstParse != null)
      console.log(`[probe]   first parse failure: ${oneLine(parseFailureText(firstParse.detail))}`)
  }

  const firstAttempt = outcomes.filter((o) => o.status === 'ok' && parseRetries(o) === 0).length
  const afterRetry = outcomes.filter((o) => o.status === 'ok' && parseRetries(o) > 0).length
  const cutOff = outcomes.filter((o) => o.cutOff === true)
  // callWithRetry keeps a call's final error out of `recoverable`: a failed run with a parse entry
  // had an unparseable first reply, then a failed re-call. A cut-off run counts only as cut off.
  const failedAfterParseRetry = outcomes.filter(
    (o) => o.status === 'failed' && o.cutOff !== true && parseRetries(o) > 0,
  )
  const failedOther = outcomes.filter(
    (o) => o.status === 'failed' && o.cutOff !== true && parseRetries(o) === 0,
  )
  const aborted = outcomes.filter((o) => o.status === 'aborted')
  console.log(
    `[probe] first-attempt parse ${firstAttempt}/${RUNS} ` +
      `(${((100 * firstAttempt) / RUNS).toFixed(0)}%; ` +
      `a failed, cut-off or aborted run counts as no success), ` +
      `ok after a parse retry ${afterRetry}, failed after a parse retry ${failedAfterParseRetry.length}, ` +
      `failed with no parse retry ${failedOther.length}, cut off at length ${cutOff.length}, ` +
      `aborted ${aborted.length}, ` +
      `ok with dropped entries ${outcomes.filter((o) => o.dropped != null).length}, ` +
      `provider retries ${outcomes.reduce((n, o) => n + providerRetries(o), 0)}`,
  )
}

main().catch((err) => {
  console.error('[probe] FAILED:', err)
  process.exitCode = 1
})
