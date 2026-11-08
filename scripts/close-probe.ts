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
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { and, eq } from 'drizzle-orm'
import { getLoadablePath } from 'sqlite-vec'

import {
  loadOpenStory,
  registerAllDomains,
  resetStuckClassifierRunState,
  startManualClose,
} from '@/lib/actions'
import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
  settleUserWrites,
} from '@/lib/actions/delta/apply-delta-action'
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from '@/lib/actions/delta/branch-write-lock'
import { describeDeltaReplayError, reverseReplayDeltas } from '@/lib/actions/delta/reverse-replay'
import { readRowGuard } from '@/lib/actions/delta/row-guard'
import { canEndChapter } from '@/lib/chapters'
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
  configureDeltaActionPort,
  ensureChapterClosePipelineRegistered,
  pipelineErrorDetail,
  pipelineEventBus,
  readClassifierStatus,
  recoverInFlightRuns,
  unprocessedEntryCount,
  type PipelineError,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { standInSlots } from '@/lib/pipeline/__tests__/close-stand-in'
import { __setCloseAgentSlots } from '@/lib/pipeline/definitions/close-agent/slots'
import { hydrateAppSettings, resetAllStores } from '@/lib/stores'

import { resolveDevSlot } from './dev-slot/resolve'

// Opt-in: a whole chapter close, as the app runs one, on a copy of a branch's database.
//   SMOKE_LLM_URL=http://host:port/v1 SMOKE_LLM_MODEL=<id> pnpm probe:close
// SMOKE_LLM_KEY (none), PROBE_RUNS (1), PROBE_BRANCH_ID (br_hero_main), PROBE_END_ENTRY (the open
// region's latest ai_reply), PROBE_OUT (a directory a run: each tool step's request and response,
// and the report), PROBE_STAND_IN=1 (the stand-in task in place of the shipped slots),
// AVENTURAS_DB_PATH (the dev slot's database; only ever read, through a VACUUM INTO copy). Close
// the app first: a live write moves the source's hash, and a held write lock fails the copy.
// A PROBE_OUT that already holds files is refused, so each invocation saves to its own directory.
const LLM_URL = process.env.SMOKE_LLM_URL
const LLM_MODEL = process.env.SMOKE_LLM_MODEL
const LLM_KEY = process.env.SMOKE_LLM_KEY ?? ''
const RUNS = Number(process.env.PROBE_RUNS ?? 1)
const BRANCH_ID = process.env.PROBE_BRANCH_ID ?? 'br_hero_main'
const END_ENTRY = process.env.PROBE_END_ENTRY
const OUT = process.env.PROBE_OUT
const STAND_IN = process.env.PROBE_STAND_IN === '1'

const PROVIDER_ID = 'prov_probe'
const PROFILE_ID = 'prof_probe'
const BUSY_TIMEOUT_MS = 2_000

type Server = { url: string; model: string }

function resolveDbPath(): string {
  if (process.env.AVENTURAS_DB_PATH) return resolve(process.env.AVENTURAS_DB_PATH)
  return join(resolveDevSlot().dataDir, 'aventuras.db')
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
}

const capture: StepCapture = {
  phase: null,
  task: null,
  dir: null,
  steps: new Map(),
  written: new Set(),
  retries: [],
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

function unusedName(base: string): string {
  let name = base
  for (let retry = 1; capture.written.has(name); retry++) name = `${base}-r${retry}`
  capture.written.add(name)
  return name
}

const callKey = (call: { task: CloseTask; part: number }): string => `${call.task}-p${call.part}`

// Counts the step, and saves it when a capture dir is set; a retried attempt keeps its own file.
function noteStep(step: number, saved: () => object): void {
  const key = capture.task === null ? 'unknown-p0' : callKey(capture.task)
  capture.steps.set(key, Math.max(capture.steps.get(key) ?? 0, step))
  if (capture.dir === null) return
  writeFileSync(
    join(capture.dir, `${unusedName(`${key}-s${step}`)}.json`),
    `${JSON.stringify(saved(), null, 2)}\n`,
  )
}

// fetch's own message is "fetch failed": what refused the call, ECONNREFUSED and its addresses,
// sits in the causes.
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
    // The transport calls fetch(Request), so the body is on the Request, not in init.
    const text = input instanceof Request ? await input.clone().text() : (init?.body ?? undefined)
    const request = typeof text === 'string' ? parseJson(text) : null
    const step = toolStepNumber(request)
    let response: Response
    let body: unknown = null
    try {
      response = await sdkFetch(input, init)
      if (step !== null && capture.dir !== null) body = parseJson(await response.clone().text())
    } catch (error) {
      if (step !== null) noteStep(step, () => ({ request, error: savedError(error) }))
      throw error
    }
    if (step !== null) noteStep(step, () => ({ request, response: body }))
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
    diagnostics: { enabled: false, debug_level_enabled: false },
  }))
  if (hydrated.status !== 'ok')
    throw new Error(`[probe:close] provider config rejected: ${hydrated.error}`)
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

async function probeRun(k: number, source: string, server: Server): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), 'aventuras-close-probe-'))
  capture.dir = OUT === undefined ? null : join(resolve(OUT), `run${k}`)
  capture.phase = null
  capture.task = null
  capture.steps.clear()
  capture.written.clear()
  capture.retries = []
  const unsubscribe = [
    pipelineEventBus.subscribe('phase_start', (event) => {
      capture.phase = event.name
      capture.task = null
    }),
    pipelineEventBus.subscribe('close_task_start', (event) => {
      capture.task = { task: event.task, part: event.part }
    }),
    pipelineEventBus.subscribe('recoverable_error', (event) => {
      const at = capture.task === null ? (capture.phase ?? 'start') : callKey(capture.task)
      capture.retries.push(`${at}: ${errorLine(event.error)}`)
    }),
  ]
  let sqlite: DatabaseSync | null = null
  try {
    const copy = join(scratch, 'copy.db')
    copyDatabase(source, copy)
    const opened = await openTestDb(copy)
    sqlite = opened.sqlite
    clearLoreMgmtOverride(opened.sqlite)
    const ctx: DbCtx = { db: opened.db, runInTransaction: opened.runInTransaction }
    if (capture.dir !== null) mkdirSync(capture.dir, { recursive: true })
    resetAllStores()
    await recoverAsBootDoes(ctx)
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
    const end = END_ENTRY ?? latestReply(await openRegionSeries(BRANCH_ID, ctx))
    const started = Date.now()
    const result = await startManualClose(BRANCH_ID, end, ctx)
    const ms = Date.now() - started
    const completed = result.outcome === 'completed'
    // A refused start leaves the chapter at `end` with an earlier close's report.
    const report = completed ? await readReport(ctx, end) : null
    if (report !== null && capture.dir !== null)
      writeFileSync(join(capture.dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    printRun(k, result, ms, report)
    return completed
  } finally {
    for (const stop of unsubscribe) stop()
    sqlite?.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

function refuseUsedOutput(): void {
  if (OUT === undefined || !existsSync(OUT) || readdirSync(OUT).length === 0) return
  throw new Error(
    `[probe:close] ${OUT} already holds files; save each invocation to its own directory`,
  )
}

async function main(): Promise<void> {
  if (!LLM_URL || !LLM_MODEL) {
    console.log('[probe:close] skipped: set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')
    return
  }
  if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error('PROBE_RUNS must be a positive integer')
  const source = resolveDbPath()
  if (!existsSync(source)) throw new Error(`[probe:close] no database at ${source}`)
  refuseUsedOutput()
  const before = sha256(source)
  console.log(`[probe:close] source ${source}, sha256 ${before}`)

  registerAllDomains()
  configureDeltaActionPort({
    applyDeltaAction,
    applyDeltaActionGroupWithOutcomes,
    readRowGuard,
    reverseReplayDeltas,
    describeReplayError: describeDeltaReplayError,
    settleUserWrites,
    holdBranchWriteExclusive,
    releaseBranchWriteExclusive,
  })
  ensureChapterClosePipelineRegistered()
  if (STAND_IN) __setCloseAgentSlots(standInSlots())
  captureSteps()
  try {
    let completed = 0
    for (let k = 1; k <= RUNS; k++)
      if (await probeRun(k, source, { url: LLM_URL, model: LLM_MODEL })) completed++
    if (completed < RUNS) process.exitCode = 1
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
