import { mkdirSync, writeFileSync } from 'node:fs'
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
  readClassifierReply,
  type ClassifierWindow,
} from '@/lib/classifier'
import {
  branches,
  characterRelationships,
  entities,
  happenings,
  stories,
  storyDefinitionSchema,
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
import {
  PASS_TIMEOUT_DEFAULT_MS,
  readKnownHappenings,
} from '@/lib/pipeline/definitions/periodic-classifier'
import { renderTemplate, TEMPLATE_IDS, type RenderedPrompt } from '@/lib/prompts'
import { appSettingsStore, hydrateAppSettings } from '@/lib/stores'
import { resolveLead } from '@/lib/world'

import { EVAL_WINDOWS, renderWindow, type EvalWindow } from './classifier-eval'
import { resolveDevSlot } from './dev-slot/resolve'

// Opt-in: the real pass prompt, sent N times to a real provider, for a first-attempt parse rate.
//   SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm probe:classifier
// SMOKE_LLM_KEY (none), PROBE_RUNS (20, or 5 a window), PROBE_MAX_OUTPUT and PROBE_TEMPERATURE
// (unset: the server's own), PROBE_BRANCH_ID
// (br_hero_main), AVENTURAS_DB_PATH (dev slot db, read-only). PROBE_EVAL (all, or window names)
// sends the evaluation set's windows instead and scores each reply; PROBE_OUT saves the replies,
// raw and read.
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const LLM_KEY = process.env.SMOKE_LLM_KEY ?? ''
const EVAL = process.env.PROBE_EVAL
const OUT = process.env.PROBE_OUT
const RUNS = Number(process.env.PROBE_RUNS ?? (EVAL == null ? 20 : 5))
const MAX_OUTPUT =
  process.env.PROBE_MAX_OUTPUT === undefined ? undefined : Number(process.env.PROBE_MAX_OUTPUT)
const TEMPERATURE =
  process.env.PROBE_TEMPERATURE === undefined ? undefined : Number(process.env.PROBE_TEMPERATURE)
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
  /** stories.definition.leadEntityId, which may dangle on this branch. */
  leadEntityId: string | null
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
      .select({ settings: stories.settings, definition: stories.definition })
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
      leadEntityId: storyDefinitionSchema.parse(story.definition).leadEntityId ?? null,
      entities: (await db
        .select()
        .from(entities)
        .where(eq(entities.branchId, BRANCH_ID))) as Entity[],
      happenings: await readKnownHappenings(
        db,
        BRANCH_ID,
        branchHappenings,
        window,
        settings.protectedBuffer,
      ),
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
  /** The reply that parsed wasn't strict JSON inside its code fence: jsonrepair made it parse. */
  repaired?: true
  emit: EmitStats
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

// As the planner anchors them (classifier.md → What the classifier writes → Happenings); the
// temporal values print so filler like "none" shows.
function anchorCounts(
  happenings: readonly { title: string; temporal?: string; sourceTurn?: string }[],
  window: ClassifierWindow,
): string {
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

type ReplySchema = ReturnType<typeof classifierReplySchema>
type ParsedReply = Parameters<typeof readClassifierReply>[0]

// The response bodies of the current run's calls, read beside the SDK's copy: its result carries
// only the parsed value, so a repaired reply or a dropped entry can't be seen without them.
const runBodies: string[] = []

function captureReplies(): void {
  const sdkFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const response = await sdkFetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith('/chat/completions')) runBodies.push(await response.clone().text())
    return response
  }
}

// llama.cpp's timings carry its prompt-cache reuse and, with speculative decoding, the drafted
// and accepted tokens: what a slip rate that moves between runs on an unchanged server is read against.
type ServerTimings = {
  cache_n?: number
  prompt_n?: number
  predicted_n?: number
  predicted_per_second?: number
  draft_n?: number
  draft_n_accepted?: number
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[]
  system_fingerprint?: string
  usage?: unknown
  timings?: ServerTimings
}

type ReplyParts = {
  content: string
  reasoning: string | null
  server: Pick<ChatCompletion, 'system_fingerprint' | 'usage' | 'timings'> | null
}

// A body that isn't a chat completion, such as an error, is kept whole as the content.
function replyParts(body: string): ReplyParts {
  let completion: ChatCompletion | undefined
  try {
    completion = JSON.parse(body) as ChatCompletion
  } catch {
    completion = undefined
  }
  const message = completion?.choices?.[0]?.message
  if (completion == null || message == null) return { content: body, reasoning: null, server: null }
  const { system_fingerprint, usage, timings } = completion
  return {
    content: message.content ?? '',
    reasoning: message.reasoning_content ?? null,
    server: { system_fingerprint, usage, timings },
  }
}

function serverLine(replies: readonly ReplyParts[]): string | null {
  const timings = replies.flatMap((r) => (r.server?.timings == null ? [] : [r.server.timings]))
  if (timings.length === 0) return null
  const sum = (pick: (t: ServerTimings) => number | undefined) =>
    timings.reduce((n, t) => n + (pick(t) ?? 0), 0)
  const speeds = timings.flatMap((t) =>
    t.predicted_per_second == null ? [] : [t.predicted_per_second],
  )
  return (
    `draft accepted ${sum((t) => t.draft_n_accepted)}/${sum((t) => t.draft_n)}, ` +
    `prompt from cache ${sum((t) => t.cache_n)}/${sum((t) => t.cache_n) + sum((t) => t.prompt_n)}, ` +
    `${speeds.map((v) => v.toFixed(0)).join('/')} tokens/s`
  )
}

function strictJsonError(text: string): string | null {
  try {
    JSON.parse(text)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const isFenced = (text: string) => /^\s*```/.test(text)
const unfenced = (text: string) => text.replace(/^\s*```[\w-]*\s*|\s*```\s*$/g, '')

// Models pretty-print a key per line, so a key that lost its closing quote (`"ref: "c2",`,
// `"severity: 1,`, `"role:": "x"`) is a line opening on a quote, a word and a colon. A string in
// an array that opens the same way counts too.
const KEY_LINE = /^\s*"[A-Za-z_$][\w$]*"\s*:/gm
const SLIPPED_KEY_LINE = /^\s*"[A-Za-z_$][\w$]*:.*$/gm

type EmitStats = { calls: number; fenced: number; keys: number; slips: readonly string[] }

function emitStats(contents: readonly string[]): EmitStats {
  const slips = contents.flatMap((c) => c.match(SLIPPED_KEY_LINE) ?? []).map((line) => line.trim())
  const keys = contents.reduce((n, c) => n + (c.match(KEY_LINE)?.length ?? 0), 0) + slips.length
  return { calls: contents.length, fenced: contents.filter(isFenced).length, keys, slips }
}

const rawText = (replies: readonly ReplyParts[]) =>
  replies
    .map(({ content, reasoning, server }, i) =>
      [
        `=== call ${i + 1} ===`,
        ...(server == null ? [] : ['--- server ---', JSON.stringify(server)]),
        ...(reasoning == null ? [] : ['--- reasoning ---', reasoning]),
        ...(server == null && reasoning == null ? [] : ['--- reply ---']),
        content,
      ].join('\n'),
    )
    .join('\n\n') + '\n'

// One pass call, printed as a run line; the parsed reply when the call returned one.
async function attempt(
  run: number,
  prompt: RenderedPrompt,
  schema: ReplySchema,
  config: ResolveModelConfig,
): Promise<{ outcome: Outcome; parsed: ParsedReply | null; raw: string }> {
  runBodies.length = 0
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
  const malformed = result.status === 'ok' ? readClassifierReply(result.value).malformed : []
  const replies = runBodies.map(replyParts)
  const notStrict =
    result.status === 'ok' && replies.length > 0
      ? strictJsonError(unfenced(replies.at(-1)!.content))
      : null
  const emit = emitStats(replies.map((r) => r.content))
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
    ...(notStrict != null ? { repaired: true as const } : {}),
    emit,
  }
  console.log(
    `[probe] run ${run}: ${outcome.cutOff === true ? 'cut off at length' : outcome.status} in ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)} s, ` +
      `${parseRetries(outcome)} parse / ${providerRetries(outcome)} provider retries` +
      (outcome.detail ? ` — ${oneLine(outcome.detail)}` : ''),
  )
  const server = serverLine(replies)
  if (server != null) console.log(`[probe]   server: ${server}`)
  if (emit.slips.length > 0)
    console.log(
      `[probe]   ${emit.slips.length} of ${emit.keys} keys lost their closing quote: ` +
        emit.slips.map((line) => oneLine(line).slice(0, 60)).join('  '),
    )
  if (notStrict != null)
    console.log(
      `[probe]   no strict JSON in its fence, parsed by jsonrepair: ${oneLine(notStrict)}`,
    )
  if (outcome.dropped != null)
    console.log(`[probe]   dropped entries that didn't fit: ${outcome.dropped}`)
  const firstParse = outcome.recoverable.find((e): e is ParseRetryError => e.tier === 'parse')
  if (firstParse != null)
    console.log(`[probe]   first parse failure: ${oneLine(parseFailureText(firstParse.detail))}`)
  return { outcome, parsed: result.status === 'ok' ? result.value : null, raw: rawText(replies) }
}

async function probeBranch(config: ResolveModelConfig, maxEntries: number): Promise<Outcome[]> {
  const dbPath = resolveDbPath()
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
      leadId:
        resolveLead(branch.leadEntityId, new Map(branch.entities.map((e) => [e.id, e])), BRANCH_ID)
          ?.id ?? null,
      idMap: new IdBiMap(),
    }),
  )
  const schema = classifierReplySchema(branch.mentionedPlaces)
  console.log(
    `[probe] ${dbPath} ${BRANCH_ID}: ${window.turns.length} turns, ` +
      `mentioned places ${branch.mentionedPlaces ? 'on' : 'off'}, ` +
      `prompt ${prompt.system.length + prompt.user.length} chars, ` +
      `max output ${MAX_OUTPUT ?? 'unset'}, temperature ${TEMPERATURE ?? 'unset'}; ${RUNS} runs of ${LLM_MODEL}`,
  )

  const outcomes: Outcome[] = []
  for (let run = 1; run <= RUNS; run++) {
    const { outcome, parsed } = await attempt(run, prompt, schema, config)
    outcomes.push(outcome)
    if (parsed != null)
      console.log(`[probe]   ${anchorCounts(readClassifierReply(parsed).reply.happenings, window)}`)
  }
  return outcomes
}

function selectWindows(names: string): readonly EvalWindow[] {
  if (names === 'all') return EVAL_WINDOWS
  return names.split(',').map((name) => {
    const window = EVAL_WINDOWS.find((w) => w.name === name.trim())
    if (window == null)
      throw new Error(
        `[probe] no eval window ${name}; one of: ${EVAL_WINDOWS.map((w) => w.name).join(', ')}`,
      )
    return window
  })
}

const listCounts = (reply: object) =>
  Object.entries(reply)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([name, list]) => `${name} ${(list as unknown[]).length}`)
    .join(', ') || 'every list empty'

async function probeEvalSet(
  names: string,
  config: ResolveModelConfig,
  maxEntries: number,
): Promise<Outcome[]> {
  const windows = selectWindows(names)
  if (OUT != null) mkdirSync(OUT, { recursive: true })
  const outcomes: Outcome[] = []
  const scores: { window: EvalWindow; parsedRuns: number; held: number[] }[] = []
  for (const w of windows) {
    const rendered = renderWindow(w, maxEntries)
    const { prompt } = rendered
    console.log(
      `[probe] eval ${w.name}, ${w.about}: prompt ${prompt.system.length + prompt.user.length} ` +
        `chars, max output ${MAX_OUTPUT ?? 'unset'}, temperature ${TEMPERATURE ?? 'unset'}; ${RUNS} runs of ${LLM_MODEL}`,
    )
    if (OUT != null)
      writeFileSync(join(OUT, `${w.name}.prompt.txt`), `${prompt.system}\n\n${prompt.user}\n`)
    const held = w.checks.map(() => 0)
    let parsedRuns = 0
    for (let run = 1; run <= RUNS; run++) {
      const { outcome, parsed, raw } = await attempt(run, prompt, rendered.schema, config)
      outcomes.push(outcome)
      if (OUT != null) writeFileSync(join(OUT, `${w.name}.${run}.raw.txt`), raw)
      if (parsed == null) continue
      parsedRuns++
      const { reply } = rendered.read(parsed)
      const holds = w.checks.map((c) => c.holds(reply))
      holds.forEach((h, i) => (held[i] += h ? 1 : 0))
      console.log(`[probe]   ${listCounts(reply)}`)
      const missed = w.checks.filter((_, i) => !holds[i]).map((c) => c.name)
      if (missed.length > 0) console.log(`[probe]   missed: ${missed.join('; ')}`)
      if (OUT != null)
        writeFileSync(join(OUT, `${w.name}.${run}.json`), `${JSON.stringify(reply, null, 2)}\n`)
    }
    scores.push({ window: w, parsedRuns, held })
  }

  console.log('[probe] eval scores, each over the runs that parsed:')
  for (const { window, parsedRuns, held } of scores) {
    console.log(`[probe] ${window.name}: ${parsedRuns}/${RUNS} parsed`)
    window.checks.forEach((c, i) =>
      console.log(`[probe]   ${held[i]}/${parsedRuns} ${c.kind} ${c.basis}: ${c.name}`),
    )
  }
  for (const basis of ['rule', 'judgment'] as const) {
    let held = 0
    let total = 0
    for (const score of scores)
      score.window.checks.forEach((c, i) => {
        if (c.basis !== basis) return
        held += score.held[i]!
        total += score.parsedRuns
      })
    console.log(`[probe] ${basis} checks held ${held}/${total}`)
  }
  return outcomes
}

function summarizeParses(outcomes: readonly Outcome[]): void {
  const runs = outcomes.length
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
    `[probe] first-attempt parse ${firstAttempt}/${runs} ` +
      `(${((100 * firstAttempt) / runs).toFixed(0)}%; ` +
      `a failed, cut-off or aborted run counts as no success), ` +
      `ok after a parse retry ${afterRetry}, failed after a parse retry ${failedAfterParseRetry.length}, ` +
      `failed with no parse retry ${failedOther.length}, cut off at length ${cutOff.length}, ` +
      `aborted ${aborted.length}, ` +
      `ok only through jsonrepair, past a fence, ${outcomes.filter((o) => o.repaired === true).length}, ` +
      `ok with dropped entries ${outcomes.filter((o) => o.dropped != null).length}, ` +
      `provider retries ${outcomes.reduce((n, o) => n + providerRetries(o), 0)}`,
  )
  const sum = (pick: (e: EmitStats) => number) => outcomes.reduce((n, o) => n + pick(o.emit), 0)
  const slipped = sum((e) => e.slips.length)
  const keys = sum((e) => e.keys)
  console.log(
    `[probe] emitted: ${sum((e) => e.calls)} calls, ${sum((e) => e.fenced)} in a code fence; ` +
      `${slipped} of ${keys} keys lost their closing quote ` +
      `(${keys === 0 ? 0 : ((100 * slipped) / keys).toFixed(2)}%)`,
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
  if (TEMPERATURE !== undefined && !(TEMPERATURE >= 0 && TEMPERATURE <= 2))
    throw new Error(`PROBE_TEMPERATURE must be a number from 0 to 2`)

  // getModel resolves providers through the app-settings store, so the probe's provider goes there.
  const hydrated = await hydrateAppSettings(async () => ({
    providers: [
      {
        id: PROVIDER_ID,
        type: 'openai-compatible',
        displayName: 'Classifier probe',
        apiKey: LLM_KEY,
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
        ...(TEMPERATURE !== undefined ? { temperature: TEMPERATURE } : {}),
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

  captureReplies()
  const maxEntries = settings.classifierWindowMaxEntries
  const outcomes =
    EVAL == null
      ? await probeBranch(config, maxEntries)
      : await probeEvalSet(EVAL, config, maxEntries)
  summarizeParses(outcomes)
}

main().catch((err) => {
  console.error('[probe] FAILED:', err)
  process.exitCode = 1
})
