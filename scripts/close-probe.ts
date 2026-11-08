import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { and, eq } from 'drizzle-orm'
import { getLoadablePath } from 'sqlite-vec'

import { loadOpenStory, registerAllDomains, startManualClose } from '@/lib/actions'
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
  unprocessedEntryCount,
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
// AVENTURAS_DB_PATH (the dev slot's database; only ever read, through a VACUUM INTO copy).
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
  const sqlite = new DatabaseSync(source, { readOnly: true, allowExtension: true })
  try {
    sqlite.loadExtension(getLoadablePath())
    sqlite.prepare('VACUUM INTO ?').run(target)
  } finally {
    sqlite.close()
  }
}

type StepCapture = {
  task: { task: CloseTask; part: number } | null
  dir: string | null
  steps: Map<string, number>
  written: Set<string>
}

const capture: StepCapture = { task: null, dir: null, steps: new Map(), written: new Set() }

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

function captureSteps(): void {
  const sdkFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    // The transport calls fetch(Request), so the body is on the Request, not in init.
    const text = input instanceof Request ? await input.clone().text() : (init?.body ?? undefined)
    const response = await sdkFetch(input, init)
    const request = typeof text === 'string' ? parseJson(text) : null
    const step = toolStepNumber(request)
    if (step === null) return response
    const key = capture.task === null ? 'unknown-p0' : callKey(capture.task)
    capture.steps.set(key, Math.max(capture.steps.get(key) ?? 0, step))
    if (capture.dir !== null) {
      const saved = { request, response: parseJson(await response.clone().text()) }
      writeFileSync(
        join(capture.dir, `${unusedName(`${key}-s${step}`)}.json`),
        `${JSON.stringify(saved, null, 2)}\n`,
      )
    }
    return response
  }
}

// getModel resolves providers through the app-settings store, so the probe's provider goes there.
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
    console.log(
      `[probe:close]   ${result.error.kind}: ${pipelineErrorDetail(result.error) ?? JSON.stringify(result.error)}`,
    )
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

async function probeRun(k: number, source: string, server: Server): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), 'aventuras-close-probe-'))
  const copy = join(scratch, 'copy.db')
  copyDatabase(source, copy)
  const { db, sqlite, runInTransaction } = await openTestDb(copy)
  const ctx: DbCtx = { db, runInTransaction }
  capture.dir = OUT === undefined ? null : join(resolve(OUT), `run${k}`)
  if (capture.dir !== null) mkdirSync(capture.dir, { recursive: true })
  capture.task = null
  capture.steps.clear()
  capture.written.clear()
  const unsubscribe = pipelineEventBus.subscribe('close_task_start', (event) => {
    capture.task = { task: event.task, part: event.part }
  })
  try {
    resetAllStores()
    await hydrateProbeSettings(server)
    const opened = await loadOpenStory(BRANCH_ID, ctx)
    if (opened.status !== 'ok')
      throw new Error(`[probe:close] branch ${BRANCH_ID} did not open: ${opened.status}`)
    // startCloseChain would run a classifier pass first, which this probe doesn't measure.
    const { processedThrough } = await readClassifierStatus(BRANCH_ID, ctx)
    const unprocessed = await unprocessedEntryCount(BRANCH_ID, processedThrough, ctx)
    if (unprocessed > 0)
      throw new Error(
        `[probe:close] branch ${BRANCH_ID} owes a classifier pass over ${unprocessed} entries; run it in the app first`,
      )
    const end = END_ENTRY ?? latestReply(await openRegionSeries(BRANCH_ID, ctx))
    const started = Date.now()
    const result = await startManualClose(BRANCH_ID, end, ctx)
    const ms = Date.now() - started
    const report = await readReport(ctx, end)
    if (report !== null && capture.dir !== null)
      writeFileSync(join(capture.dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    printRun(k, result, ms, report)
  } finally {
    unsubscribe()
    sqlite.close()
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (!LLM_URL || !LLM_MODEL) {
    console.log('[probe:close] skipped: set SMOKE_LLM_URL and SMOKE_LLM_MODEL to run')
    return
  }
  if (!Number.isInteger(RUNS) || RUNS < 1) throw new Error('PROBE_RUNS must be a positive integer')
  const source = resolveDbPath()
  if (!existsSync(source)) throw new Error(`[probe:close] no database at ${source}`)
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
    for (let k = 1; k <= RUNS; k++) await probeRun(k, source, { url: LLM_URL, model: LLM_MODEL })
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
