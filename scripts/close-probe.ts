import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { and, eq } from 'drizzle-orm'
import { getLoadablePath } from 'sqlite-vec'

import {
  loadOpenStory,
  registerAllDomains,
  resetStuckClassifierRunState,
  startManualClose,
  type GroupOutcome,
} from '@/lib/actions'
import { canEndChapter, partTokenLimit } from '@/lib/chapters'
import {
  chapters,
  closeReportSchema,
  openRegionSeries,
  type CloseReport,
  type CloseTask,
  type DbCtx,
  type OpenRegionRow,
} from '@/lib/db'
import { openTestDb } from '@/lib/db/__tests__/test-db'
import {
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
  type LogEntry,
} from '@/lib/diagnostics'
import {
  configureDeltaActionPort,
  ensureChapterClosePipelineRegistered,
  pipelineErrorDetail,
  pipelineEventBus,
  readClassifierStatus,
  recoverInFlightRuns,
  unprocessedEntryCount,
  type PhaseEmittedEvent,
  type PhaseResult,
  type PipelineError,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { standInSlots } from '@/lib/pipeline/__tests__/close-stand-in'
import { realDeltaActionPort } from '@/lib/pipeline/__tests__/harness'
import { embedRangeStep } from '@/lib/pipeline/definitions/close-agent/close-happenings'
import {
  __setCloseAgentSlots,
  PRODUCTION_CLOSE_SLOTS,
  type CloseAgentSlots,
  type CodeStep,
  type SlotEntry,
} from '@/lib/pipeline/definitions/close-agent/slots'
import { closeClustersOf } from '@/lib/pipeline/definitions/close-intermediates'
import {
  appSettingsStore,
  hydrateAppSettings,
  rehydrateStories,
  resetAllStores,
} from '@/lib/stores'

import {
  attemptOf,
  barLine,
  barVerdict,
  failedRunsExit,
  largestOf,
  stepFileName,
  tallyRun,
  type Measured,
  type RunTally,
  type StepAttempt,
} from './close-probe-bar'
import { installProbeBridges, probeEmbedderBridge } from './close-probe-embedder'
import { rejudgeSaved } from './close-probe-rejudge'
import {
  applyDatasetOverlay,
  DATASET_BRANCH_ID,
  overlayCappedLists,
} from './dataset-chapter/overlay'
import { resolveDevSlot } from './dev-slot/resolve'

// Opt-in: a whole chapter close, as the app runs one, on a copy of a branch's database.
//   SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm probe:close
// SMOKE_LLM_KEY (none), PROBE_RUNS (1), PROBE_BRANCH_ID (br_hero_main; the dataset branch under
// PROBE_OVERLAY), PROBE_END_ENTRY (the open region's latest ai_reply), PROBE_OUT (a directory a
// run: each tool step's request and response, and the report; bar.json beside the runs),
// PROBE_STAND_IN=1 (the stand-in task in place of the shipped slots), PROBE_OVERLAY=1 (the dataset
// seed's test overlay on each run's copy, and the bar over the runs), PROBE_WINDOW (none; the
// model's window in tokens, set on the probe's provider as App Settings' override is, so a close
// cuts its chapter into parts at half of it), AVENTURAS_DB_PATH (the dev slot's database; only
// ever read, through a VACUUM INTO copy), PROBE_EMBEDDERS_DIR (the embedders/ beside the database,
// else the dev slot's userData embedders/; where the range embed loads the story's local model,
// through onnxruntime-node in this process),
// PROBE_REJUDGE (a saved PROBE_OUT directory: judges its runs by the bar as it stands, from the
// saved files, with no model call, and writes bar-rejudged.json beside them). Close the app
// first: a live write moves the source's hash, and a held write lock fails the copy.
// A PROBE_OUT that already holds files is refused, so each invocation saves to its own directory.
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const LLM_KEY = process.env.SMOKE_LLM_KEY ?? ''
const RUNS = Number(process.env.PROBE_RUNS ?? 1)
const OVERLAY = process.env.PROBE_OVERLAY === '1'
const BRANCH_ID = process.env.PROBE_BRANCH_ID ?? (OVERLAY ? DATASET_BRANCH_ID : 'br_hero_main')
const END_ENTRY = process.env.PROBE_END_ENTRY
const OUT = process.env.PROBE_OUT
const STAND_IN = process.env.PROBE_STAND_IN === '1'
const REJUDGE = process.env.PROBE_REJUDGE
const WINDOW_ENV = process.env.PROBE_WINDOW
const WINDOW = WINDOW_ENV === undefined ? undefined : Number(WINDOW_ENV)
// The overlay's capped lists as the bar reads them, recorded in bar.json for a later re-judge.
const OVERLAY_LISTS = overlayCappedLists().map(({ id, list }) => ({ id, list }))

const PROVIDER_ID = 'prov_probe'
const PROFILE_ID = 'prof_probe'
const BUSY_TIMEOUT_MS = 2_000

type Server = { url: string; model: string }

function resolveDbPath(): string {
  if (process.env.AVENTURAS_DB_PATH) return resolve(process.env.AVENTURAS_DB_PATH)
  return join(resolveDevSlot().dataDir, 'aventuras.db')
}

// A slot's userData holds both; an AVENTURAS_DB_PATH outside one, as dataset:chapter writes, falls
// back to this checkout's slot. A stand-in loads no model, so it takes the first unchecked.
function resolveEmbeddersRoot(source: string): string {
  const named = process.env.PROBE_EMBEDDERS_DIR
  const tried = [named ? resolve(named) : join(dirname(source), 'embedders')]
  if (STAND_IN || existsSync(tried[0])) return tried[0]
  if (!named && process.env.AVENTURAS_DB_PATH) {
    const slot = join(resolveDevSlot().dataDir, 'embedders')
    if (existsSync(slot)) return slot
    if (slot !== tried[0]) tried.push(slot)
  }
  throw new Error(
    `[probe:close] no embedders folder at ${tried.join(' or ')}: the range embed loads the story's local model from it; set PROBE_EMBEDDERS_DIR to a folder that holds it`,
  )
}

// The current run's range-embed clusters, once it completed; its counts are its own log entry.
let rangeClusters: readonly (readonly string[])[] | null = null

const measuredEmbedStep: CodeStep = {
  name: embedRangeStep.name,
  run: async function* (
    ctx,
  ): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
    const result = yield* embedRangeStep.run(ctx)
    if (result.status === 'completed') rangeClusters = closeClustersOf(ctx.phase.intermediates)
    return result
  },
}

function measuredSlots(): CloseAgentSlots {
  const isEmbed = (entry: SlotEntry<'happenings'>): boolean =>
    entry.kind === 'code' && entry.step === embedRangeStep
  if (!PRODUCTION_CLOSE_SLOTS.before.some(isEmbed))
    throw new Error('[probe:close] the shipped slots hold no range embed to measure')
  return {
    ...PRODUCTION_CLOSE_SLOTS,
    before: PRODUCTION_CLOSE_SLOTS.before.map(
      (entry): SlotEntry<'happenings'> =>
        isEmbed(entry) ? { kind: 'code', step: measuredEmbedStep } : entry,
    ),
  }
}

function printRangeEmbed(k: number): void {
  if (rangeClusters === null) {
    console.log(`[probe:close]   run ${k} range embed: did not complete`)
    return
  }
  const counts = capture.log.findLast(({ entry }) => entry.kind === 'memory.close_range_embed')
  // embedRange's one completion with no log entry: a range of under two happenings.
  if (counts === undefined) {
    console.log(
      `[probe:close]   run ${k} range embed: skipped, the range held fewer than two happenings`,
    )
    return
  }
  const { happenings, unembedded, clusters } = counts.entry.fields
  const sizes = rangeClusters.map((cluster) => cluster.length)
  const rows = sizes.length === 0 ? '' : ` of ${sizes.join(', ')} rows`
  console.log(
    `[probe:close]   run ${k} range embed: ${Number(happenings) - Number(unembedded)} of ${String(happenings)} range happenings embedded, ${String(clusters)} clusters${rows}`,
  )
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// A read-only handle: VACUUM INTO writes a consistent snapshot to the target and nothing to the
// source.
function copyDatabase(source: string, target: string): void {
  const sqlite = new DatabaseSync(source, {
    readOnly: true,
    allowExtension: true,
    timeout: BUSY_TIMEOUT_MS,
  })
  try {
    sqlite.loadExtension(getLoadablePath())
    sqlite.prepare('VACUUM INTO ?').run(target)
  } finally {
    sqlite.close()
  }
}

type StepCapture = {
  phase: string | null
  /** The last task started in `phase`: a code step and a later phase send no start of their own. */
  task: { task: CloseTask; part: number } | null
  dir: string | null
  steps: Map<string, number>
  written: Set<string>
  retries: string[]
  /** Every tool-step response, a cut attempt and its retry alike. */
  attempts: StepAttempt[]
  /** Debug log entries, each under the task or phase it was logged in. */
  log: { at: string; entry: LogEntry }[]
}

const capture: StepCapture = {
  phase: null,
  task: null,
  dir: null,
  steps: new Map(),
  written: new Set(),
  retries: [],
  attempts: [],
  log: [],
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

// A tool step is a chat request carrying tools. Its number is one past the replies it sends back,
// so an attempt the step call retries keeps its step's number.
function toolStepNumber(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const { tools, messages } = body as { tools?: unknown; messages?: unknown }
  if (!Array.isArray(tools) || tools.length === 0) return null
  const replies = Array.isArray(messages)
    ? messages.filter(
        (m: unknown) =>
          typeof m === 'object' && m !== null && (m as { role?: unknown }).role === 'assistant',
      ).length
    : 0
  return replies + 1
}

function unusedName(step: number): string {
  let retry = 0
  while (capture.written.has(stepFileName(capture.task, step, retry))) retry += 1
  const name = stepFileName(capture.task, step, retry)
  capture.written.add(name)
  return name
}

const callKey = (call: { task: CloseTask; part: number }): string => `${call.task}-p${call.part}`

// Counts the step, and saves it when a capture dir is set; a retried attempt keeps its own file.
function noteStep(step: number, saved: () => object): void {
  const key = capture.task === null ? 'unknown-p0' : callKey(capture.task)
  capture.steps.set(key, Math.max(capture.steps.get(key) ?? 0, step))
  if (capture.dir === null) return
  writeFileSync(join(capture.dir, unusedName(step)), `${JSON.stringify(saved(), null, 2)}\n`)
}

const where = (): string =>
  capture.task === null ? (capture.phase ?? 'start') : callKey(capture.task)

// The diagnostics buffer keeps its last 500 entries, so it is drained at each step and each start.
function drainLog(): void {
  const { logEntries } = getDiagnosticsSnapshot()
  if (logEntries.length === 0) return
  const at = where()
  for (const entry of logEntries) capture.log.push({ at, entry })
  clearBuffers()
}

function noteAttempt(step: number, body: unknown): void {
  if (capture.task === null) return
  const attempt = attemptOf(capture.task.task, step, body)
  if (attempt !== null) capture.attempts.push(attempt)
}

// fetch's own message is just "fetch failed"; ECONNREFUSED and its addresses sit in the causes.
function savedError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error) || depth > 8) return String(error)
  const { code } = error as { code?: unknown }
  return {
    message: error.message,
    ...(code === undefined ? {} : { code }),
    ...(error instanceof AggregateError
      ? { errors: (error.errors as unknown[]).map((e) => savedError(e, depth + 1)) }
      : {}),
    ...(error.cause === undefined ? {} : { cause: savedError(error.cause, depth + 1) }),
  }
}

function captureSteps(): void {
  const sdkFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    drainLog()
    // The transport calls fetch(Request), so the body is on the Request, not in init.
    const text = input instanceof Request ? await input.clone().text() : (init?.body ?? undefined)
    const request = typeof text === 'string' ? parseJson(text) : null
    const step = toolStepNumber(request)
    let response: Response
    let body: unknown = null
    try {
      response = await sdkFetch(input, init)
      // Read with no capture dir too: the bar reads each step's output tokens.
      if (step !== null) body = parseJson(await response.clone().text())
    } catch (error) {
      if (step !== null) noteStep(step, () => ({ request, error: savedError(error) }))
      throw error
    }
    if (step !== null) {
      noteAttempt(step, body)
      noteStep(step, () => ({ request, response: body }))
    }
    return response
  }
}

// The agent phase builds its model config from appSettingsStore, so the probe's provider goes there.
async function hydrateProbeSettings(server: Server): Promise<void> {
  const hydrated = await hydrateAppSettings(async () => ({
    providers: [
      {
        id: PROVIDER_ID,
        type: 'openai-compatible',
        displayName: 'Close probe',
        apiKey: LLM_KEY,
        endpoint: server.url,
        favoriteModelIds: [server.model],
        ...(WINDOW === undefined ? {} : { contextWindowOverrides: { [server.model]: WINDOW } }),
      },
    ],
    profiles: [
      {
        id: PROFILE_ID,
        kind: 'agent',
        name: 'Close probe',
        modelRef: { providerId: PROVIDER_ID, modelId: server.model },
      },
    ],
    assignments: { 'lore-mgmt': PROFILE_ID },
    defaultProviderId: PROVIDER_ID,
    diagnostics: { enabled: true, debug_level_enabled: true },
  }))
  if (hydrated.status !== 'ok')
    throw new Error(`[probe:close] provider config rejected: ${hydrated.error}`)
}

// As boot's ensureDiagnosticsGate (lib/boot/bootstrap.ts), whose module also wires the app's boot.
function enableDiagnosticsGate(): void {
  configureDiagnosticsGate({
    isEnabled: () => appSettingsStore.getAppSettings().diagnostics.enabled,
    isDebugEnabled: () => appSettingsStore.getAppSettings().diagnostics.debug_level_enabled,
  })
}

function latestReply(series: readonly OpenRegionRow[]): string {
  const reply = [...series].reverse().find(canEndChapter)
  if (reply === undefined)
    throw new Error(`[probe:close] branch ${BRANCH_ID} has no ai_reply in its open region`)
  return reply.id
}

async function readReport(ctx: DbCtx, endEntryId: string): Promise<CloseReport | null> {
  const [row] = await ctx.db
    .select({ report: chapters.closeReport })
    .from(chapters)
    .where(and(eq(chapters.branchId, BRANCH_ID), eq(chapters.endEntryId, endEntryId)))
  return row?.report == null ? null : closeReportSchema.parse(row.report)
}

function errorLine(error: PipelineError): string {
  const reason = 'reason' in error ? ` (${String(error.reason)})` : ''
  return `${error.kind}${reason}: ${pipelineErrorDetail(error) ?? JSON.stringify(error)}`
}

// A task names only what the failure came after: it may have ended, and a code step run since.
function failedWhere(): string {
  const phase = capture.phase === null ? '' : ` in the ${capture.phase} phase`
  const task = capture.task === null ? '' : `, after ${callKey(capture.task)} started`
  return `${phase}${task}`
}

function printRun(
  k: number,
  result: TxResult | RejectedStart,
  ms: number,
  report: CloseReport | null,
): void {
  if (result.outcome === 'rejected') {
    console.log(`[probe:close] run ${k}: refused at start (${result.blockedBy})`)
    return
  }
  console.log(
    `[probe:close] run ${k}: ${result.outcome} in ${(ms / 1000).toFixed(1)} s, action ${result.actionId}`,
  )
  if (result.outcome === 'failed')
    console.log(`[probe:close]   failed${failedWhere()}: ${errorLine(result.error)}`)
  for (const retry of capture.retries) console.log(`[probe:close]   retried ${retry}`)
  const calls = report?.calls ?? []
  for (const key of new Set([...capture.steps.keys(), ...calls.map(callKey)])) {
    const own = calls.filter((call) => callKey(call) === key)
    console.log(`[probe:close]   ${key}: ${capture.steps.get(key) ?? 0} steps, ${own.length} calls`)
    for (const call of own) {
      const reason = call.reason === undefined ? '' : ` (${call.reason})`
      const rows = call.rows.map((row) => row.name).join(', ')
      console.log(`[probe:close]     ${call.tool} ${call.result}${reason}: ${rows}`)
    }
  }
  if (report === null) return
  const stops = report.stopped.map((stop) => `${callKey(stop)} ${stop.reason}`)
  console.log(
    `[probe:close]   stopped: ${stops.length === 0 ? 'none' : stops.join(', ')}; noToolCalls: ${String(report.noToolCalls)}`,
  )
}

type LargestValue = { length: number; tool: string; path: string }

function largestValueLogged(): LargestValue | null {
  let largest: LargestValue | null = null
  for (const { entry } of capture.log) {
    const { fields } = entry
    if (
      entry.kind === 'memory.close_report_value' &&
      typeof fields.length === 'number' &&
      (largest === null || fields.length > largest.length)
    )
      largest = { length: fields.length, tool: String(fields.tool), path: String(fields.path) }
  }
  return largest
}

const hitSuffix = (result: string, reason: string | undefined): string =>
  `${result}${reason === undefined ? '' : ` (${reason})`}`

function printMeasures(
  k: number,
  tally: RunTally,
  largest: LargestValue | null,
  bytes: number | null,
): void {
  for (const hold of tally.holds)
    console.log(`[probe:close]   ${hold.task}: ${hold.held ? 'held' : `not held (${hold.why})`}`)
  console.log(`[probe:close]   cut-offs: ${tally.cutOffs.length}`)
  for (const cut of tally.cutOffs)
    console.log(
      `[probe:close]     ${cut.task} step ${cut.step}: ${cut.outputTokens ?? 'unreported'} output tokens`,
    )
  if (OVERLAY) {
    console.log(
      `[probe:close]   coverage: ${tally.capCalls} Identity calls reached a cap, ${tally.mergeCalls} merge_threads calls`,
    )
    for (const hit of tally.capHits)
      console.log(
        `[probe:close]     cap check ${hit.row} ${hit.path}: ${hitSuffix(hit.result, hit.result === 'refused' ? hit.reason : undefined)}`,
      )
    for (const hit of tally.mergeHits)
      console.log(
        `[probe:close]     merge_threads ${hit.rows.join(', ')}: ${hitSuffix(hit.result, hit.reason)}`,
      )
  }
  const ratios = new Map<string, string[]>()
  for (const { at, entry } of capture.log) {
    const { fields } = entry
    if (entry.kind === 'provider.input_ratio' && typeof fields.ratio === 'number')
      ratios.set(at, [...(ratios.get(at) ?? []), fields.ratio.toFixed(2)])
  }
  for (const [at, list] of ratios)
    console.log(`[probe:close]   ${at} input_ratio: ${list.join(', ')}`)
  console.log(
    `[probe:close]   run ${k} largest report value: ${largest === null ? 'none' : `${largest.length} characters (${largest.tool} ${largest.path})`}`,
  )
  if (bytes !== null) console.log(`[probe:close]   run ${k} report size: ${bytes} bytes`)
}

function printLargest(
  values: readonly Measured<LargestValue>[],
  sizes: readonly Measured<number>[],
): void {
  const value = largestOf(values, ({ length }) => length)
  const size = largestOf(sizes, (bytes) => bytes)
  console.log(
    `[probe:close] largest report value: ${value === null ? 'none' : `${value.value.length} characters (${value.value.tool} ${value.value.path}, run ${value.run})`}`,
  )
  console.log(
    `[probe:close] largest report: ${size === null ? 'none' : `${size.value} bytes (run ${size.run})`}`,
  )
}

function printBar(tallies: readonly RunTally[]): void {
  const bar = barVerdict(tallies)
  console.log(`[probe:close] ${barLine(bar)}`)
  if (OUT !== undefined) {
    mkdirSync(resolve(OUT), { recursive: true })
    writeFileSync(
      join(resolve(OUT), 'bar.json'),
      `${JSON.stringify({ ...bar, cappedLists: OVERLAY_LISTS, tallies }, null, 2)}\n`,
    )
  }
  if (bar.verdict !== 'met') process.exitCode = 1
}

const OVERRIDE_PATH = '$.models."lore-mgmt"'

// The probe measures the server it was given, and a story override outranks App Settings'
// assignment (lib/ai/resolve-model.ts). Clears it on the scratch copy only.
function clearLoreMgmtOverride(sqlite: DatabaseSync): void {
  const storyOf = '(SELECT story_id FROM branches WHERE id = ?)'
  const held = sqlite
    .prepare(`SELECT json_extract(settings, ?) AS held FROM stories WHERE id = ${storyOf}`)
    .get(OVERRIDE_PATH, BRANCH_ID) as { held: string | null } | undefined
  if (held?.held == null) return
  sqlite
    .prepare(`UPDATE stories SET settings = json_remove(settings, ?) WHERE id = ${storyOf}`)
    .run(OVERRIDE_PATH, BRANCH_ID)
  console.log(`[probe:close] cleared the story's lore-mgmt model override on the scratch copy`)
}

// As the app's boot does (lib/boot/bootstrap.ts): a close cut off mid-run left its writes and an
// open marker, and the probe's close would read the region they moved, or run over them.
async function recoverAsBootDoes(ctx: DbCtx): Promise<void> {
  const recovery = await recoverInFlightRuns(ctx)
  for (const run of recovery.reversed)
    console.log(
      `[probe:close] recovered run ${run.runId} (${run.kind}) on the scratch copy: ${run.deltas} deltas reversed`,
    )
  const [failed] = recovery.failures
  if (failed !== undefined)
    throw new Error(
      `[probe:close] run ${failed.runId} (${failed.kind}, action ${failed.actionId}) does not recover: ${String(failed.error)}`,
    )
  await resetStuckClassifierRunState(ctx, recovery.failures)
}

// A signal skips `finally`, which would leave the scratch copy in the temp folder.
let removeScratch: (() => void) | null = null

function stopOn(signal: NodeJS.Signals, exitCode: number): void {
  process.once(signal, () => {
    removeScratch?.()
    console.error(`[probe:close] ${signal}: stopped, scratch copy removed`)
    process.exit(exitCode)
  })
}

type RunResult = {
  completed: boolean
  tally: RunTally
  largestValue: LargestValue | null
  reportBytes: number | null
}

async function probeRun(
  k: number,
  source: string,
  server: Server,
  embedders: string,
): Promise<RunResult> {
  const scratch = mkdtempSync(join(tmpdir(), 'aventuras-close-probe-'))
  let sqlite: DatabaseSync | null = null
  let uninstall: (() => void) | null = null
  const cleanUp = (): void => {
    try {
      uninstall?.()
      sqlite?.close()
    } finally {
      uninstall = null
      sqlite = null
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  removeScratch = cleanUp
  capture.dir = OUT === undefined ? null : join(resolve(OUT), `run${k}`)
  capture.phase = null
  capture.task = null
  capture.steps.clear()
  capture.written.clear()
  capture.retries = []
  capture.attempts = []
  capture.log = []
  rangeClusters = null
  clearBuffers()
  const unsubscribe = [
    pipelineEventBus.subscribe('phase_start', (event) => {
      drainLog()
      capture.phase = event.name
      capture.task = null
    }),
    pipelineEventBus.subscribe('close_task_start', (event) => {
      drainLog()
      capture.task = { task: event.task, part: event.part }
    }),
    pipelineEventBus.subscribe('recoverable_error', (event) => {
      const { error } = event
      let cut = ''
      if (error.kind === 'reply-cut-off')
        cut = `; the cut attempt's output: ${error.outputTokens ?? 'unreported'} tokens`
      capture.retries.push(`${where()}: ${errorLine(error)}${cut}`)
    }),
  ]
  try {
    const copy = join(scratch, 'copy.db')
    copyDatabase(source, copy)
    const opened = await openTestDb(copy)
    sqlite = opened.sqlite
    uninstall = installProbeBridges(probeEmbedderBridge(embedders), opened)
    clearLoreMgmtOverride(opened.sqlite)
    const ctx: DbCtx = { db: opened.db, runInTransaction: opened.runInTransaction }
    if (capture.dir !== null) mkdirSync(capture.dir, { recursive: true })
    resetAllStores()
    await recoverAsBootDoes(ctx)
    if (OVERLAY) {
      const overlay = await applyDatasetOverlay(ctx)
      console.log(
        `[probe:close] run ${k}: overlay applied${overlay.reopened ? ", the seed's close undone first" : ''}; its user edit ${overlay.userEdit}`,
      )
    }
    // startCloseChain would run a classifier pass first, which this probe doesn't measure.
    const { processedThrough } = await readClassifierStatus(BRANCH_ID, ctx)
    const unprocessed = await unprocessedEntryCount(BRANCH_ID, processedThrough, ctx)
    if (unprocessed > 0)
      throw new Error(
        `[probe:close] branch ${BRANCH_ID} owes a classifier pass over ${unprocessed} entries; run it in the app first`,
      )
    await hydrateProbeSettings(server)
    const story = await loadOpenStory(BRANCH_ID, ctx)
    if (story.status !== 'ok')
      throw new Error(`[probe:close] branch ${BRANCH_ID} did not open: ${story.status}`)
    // The range embed reads the story's embedder from the stories store, which boot fills.
    if (!(await rehydrateStories(ctx.db)))
      throw new Error('[probe:close] the stories store did not load')
    const end = END_ENTRY ?? latestReply(await openRegionSeries(BRANCH_ID, ctx))
    const started = Date.now()
    const result = await startManualClose(BRANCH_ID, end, ctx)
    const ms = Date.now() - started
    drainLog()
    const completed = result.outcome === 'completed'
    // A refused start leaves the chapter at `end` with an earlier close's report.
    const report = completed ? await readReport(ctx, end) : null
    if (report !== null && capture.dir !== null)
      writeFileSync(join(capture.dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    printRun(k, result, ms, report)
    if (!STAND_IN) printRangeEmbed(k)
    const tally = tallyRun({
      report,
      attempts: capture.attempts,
      cappedLists: OVERLAY ? OVERLAY_LISTS : [],
    })
    const largestValue = largestValueLogged()
    const reportBytes = report === null ? null : Buffer.byteLength(JSON.stringify(report))
    if (!STAND_IN) printMeasures(k, tally, largestValue, reportBytes)
    return { completed, tally, largestValue, reportBytes }
  } finally {
    removeScratch = null
    for (const stop of unsubscribe) stop()
    cleanUp()
  }
}

function refuseUsedOutput(): void {
  if (OUT === undefined || !existsSync(OUT) || readdirSync(OUT).length === 0) return
  throw new Error(
    `[probe:close] ${OUT} already holds files; save each invocation to its own directory`,
  )
}

function rejudge(outDir: string): void {
  const dir = resolve(outDir)
  const { bar, runs, cappedLists } = rejudgeSaved(dir, OVERLAY_LISTS)
  const tallies = runs.map(({ tally }) => tally)
  console.log(
    cappedLists.from === 'bar.json'
      ? `[probe:close] coverage reads the ${cappedLists.lists.length} capped lists bar.json recorded`
      : `[probe:close] bar.json records no capped lists: coverage reads today's ${cappedLists.lists.length} in scripts/dataset-chapter/overlay-data.ts`,
  )
  for (const { run, tally } of runs) {
    const { holds, cutOffs } = tally
    const verdicts = holds.map((hold) => `${hold.task} ${hold.held ? 'held' : hold.why}`)
    const cuts = cutOffs.map((cut) => `${cut.task} step ${cut.step} ${cut.outputTokens ?? '?'}`)
    console.log(
      `[probe:close] run ${run}: ${verdicts.join('; ')}; cut-offs: ${cuts.length === 0 ? 'none' : cuts.join(', ')}`,
    )
  }
  console.log(`[probe:close] ${barLine(bar)}`)
  writeFileSync(
    join(dir, 'bar-rejudged.json'),
    `${JSON.stringify({ ...bar, cappedLists: cappedLists.lists, tallies }, null, 2)}\n`,
    { flag: 'wx' },
  )
  if (bar.verdict !== 'met') process.exitCode = 1
}

async function main(): Promise<void> {
  if (REJUDGE !== undefined) return rejudge(REJUDGE)
  if (!LLM_URL || !LLM_MODEL) {
    console.log('[probe:close] skipped: set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')
    return
  }
  if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error('PROBE_RUNS must be a positive integer')
  if (WINDOW !== undefined && (!Number.isInteger(WINDOW) || WINDOW < 1))
    throw new Error('PROBE_WINDOW must be a positive integer')
  if (OVERLAY && STAND_IN)
    throw new Error(
      '[probe:close] PROBE_OVERLAY=1 and PROBE_STAND_IN=1 cannot run together: the stand-in has no Threads task, so the bar would always read missed',
    )
  if (OVERLAY && BRANCH_ID !== DATASET_BRANCH_ID)
    throw new Error(
      `[probe:close] PROBE_OVERLAY=1 runs on the dataset branch ${DATASET_BRANCH_ID}, not ${BRANCH_ID}: unset PROBE_BRANCH_ID`,
    )
  const source = resolveDbPath()
  if (!existsSync(source)) throw new Error(`[probe:close] no database at ${source}`)
  refuseUsedOutput()
  const embedders = resolveEmbeddersRoot(source)
  console.log(`[probe:close] embedders ${embedders}`)
  stopOn('SIGINT', 130)
  stopOn('SIGTERM', 143)
  const before = sha256(source)
  console.log(`[probe:close] source ${source}, sha256 ${before}`)
  if (WINDOW !== undefined)
    console.log(
      `[probe:close] PROBE_WINDOW ${WINDOW}: a part holds at most ${partTokenLimit(WINDOW)} tokens`,
    )

  registerAllDomains()
  configureDeltaActionPort(realDeltaActionPort())
  ensureChapterClosePipelineRegistered()
  __setCloseAgentSlots(STAND_IN ? standInSlots() : measuredSlots())
  // The logger mirrors each debug entry to console.debug; the buffer the probe drains still fills.
  console.debug = () => {}
  enableDiagnosticsGate()
  captureSteps()
  try {
    const results: RunResult[] = []
    for (let k = 1; k <= RUNS; k++)
      results.push(await probeRun(k, source, { url: LLM_URL, model: LLM_MODEL }, embedders))
    if (
      failedRunsExit(
        OVERLAY,
        results.map(({ completed }) => completed),
      )
    )
      process.exitCode = 1
    if (!STAND_IN)
      printLargest(
        results.map(({ largestValue }, i) => ({ value: largestValue, run: i + 1 })),
        results.map(({ reportBytes }, i) => ({ value: reportBytes, run: i + 1 })),
      )
    if (OVERLAY) printBar(results.map(({ tally }) => tally))
  } finally {
    const after = sha256(source)
    console.log(
      `[probe:close] source sha256 ${after} (${after === before ? 'unchanged' : 'CHANGED'})`,
    )
    if (after !== before) process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error('[probe:close] FAILED:', err)
  process.exitCode = 1
})
