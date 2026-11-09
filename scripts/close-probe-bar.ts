import { USER_EDITED_SINCE_PROSE } from '@/lib/actions/types'
import { TOOL_STEP_MAX_OUTPUT_DEFAULT } from '@/lib/ai'
import type { CloseReport, CloseReportCall, CloseTask } from '@/lib/db'
import type { CappedList } from '@/lib/pipeline/definitions/close-agent/fields'
import { CLOSE_REASON } from '@/lib/pipeline/definitions/close-agent/verdict'

// The measure's bar, set before any run (testing.md → Real-provider checks).
const BAR_TASKS = ['identity', 'threads'] as const satisfies readonly CloseTask[]
const PASSING_OF_TEN = 8
const COVERAGE_OF_TEN = 3

// A list lost to these never reached the cap check: protection runs before it, and a gone row has
// no list.
const BEFORE_THE_CAP = new Set<string>([
  USER_EDITED_SINCE_PROSE,
  CLOSE_REASON.laterTurn,
  CLOSE_REASON.rowGone,
])

export type TaskHold = { task: CloseTask; held: boolean; why: string }
/** A capped list that reached the cap check: `result` is its outcome, `refused` when lost. */
export type CapHit = {
  row: string
  path: string
  result: CloseReportCall['result'] | 'refused'
  reason?: string
}
/** A merge_threads call, by the names of the rows it named. */
export type MergeHit = { rows: string[]; result: CloseReportCall['result']; reason?: string }
/** One response to a tool step; a cut or filtered step is retried, so a step has several. */
export type StepAttempt = {
  task: CloseTask
  step: number
  /** As the server reported it; null when it reported none. */
  outputTokens: number | null
  cut: boolean
}
/** A step attempt the server cut off at its length or stopped by a filter. */
export type CutOff = { task: CloseTask; step: number; outputTokens: number | null }
export type RunTally = {
  holds: readonly TaskHold[]
  cutOffs: readonly CutOff[]
  capCalls: number
  mergeCalls: number
  capHits: readonly CapHit[]
  mergeHits: readonly MergeHit[]
}

type RunInput = {
  /** Null for a close that did not complete, or completed and wrote no report: nothing to judge. */
  report: CloseReport | null
  attempts: readonly StepAttempt[]
  cappedLists: readonly { id: string; list: CappedList }[]
}

function landedWrite(call: CloseReportCall): boolean {
  if (call.result !== 'ok') return false
  if (call.survivor !== undefined) return true
  const skipped = new Set((call.skippedFields ?? []).map(({ field }) => field))
  return Object.keys(call.values ?? {}).some((path) => !skipped.has(path))
}

// A cut attempt is never a step (generation-pipeline.md → Cut-off replies): its one retry stands
// for it, and a retry cut too stops the task, which the report's stops already carry.
function largestFinalOutput(task: CloseTask, attempts: readonly StepAttempt[]): number {
  return Math.max(
    0,
    ...attempts.flatMap((attempt) =>
      attempt.task === task && !attempt.cut && attempt.outputTokens !== null
        ? [attempt.outputTokens]
        : [],
    ),
  )
}

function holdOf(task: CloseTask, input: RunInput): TaskHold {
  const missed = (why: string): TaskHold => ({ task, held: false, why })
  const { report } = input
  if (report === null) return missed('no report: the close did not complete, or wrote none')
  const stop = report.stopped.find((stopped) => stopped.task === task)
  if (stop !== undefined) return missed(`stopped: ${stop.reason}`)
  const most = largestFinalOutput(task, input.attempts)
  if (most >= TOOL_STEP_MAX_OUTPUT_DEFAULT)
    return missed(`a step's reply reached ${most} output tokens`)
  if (!report.calls.some((call) => call.task === task && landedWrite(call)))
    return missed('no write landed')
  return { task, held: true, why: 'held' }
}

// C4: a path's own skippedFields entry, else, where nothing landed, the call's one shared reason.
function lossOf(call: CloseReportCall, path: string): string | undefined {
  const own = call.skippedFields?.find(({ field }) => field === path)
  if (own !== undefined) return own.reason
  return call.result === 'ok' ? undefined : call.reason
}

// One hit per capped list a call sent that reached the cap check, so a call sending two lists on
// one row holds two.
function capHitsOf(call: CloseReportCall, capped: RunInput['cappedLists']): CapHit[] {
  if (call.task !== 'identity' || call.values === undefined) return []
  const { values } = call
  return capped.flatMap(({ id, list }) => {
    const row = call.rows.find((named) => named.table === 'entities' && named.id === id)
    const path = `state.${list}`
    const loss = lossOf(call, path)
    if (row === undefined || !Object.hasOwn(values, path)) return []
    if (loss !== undefined && BEFORE_THE_CAP.has(loss)) return []
    const hit: CapHit =
      loss === undefined
        ? { row: row.name, path, result: call.result }
        : { row: row.name, path, result: 'refused', reason: loss }
    return [hit]
  })
}

function mergeHitOf(call: CloseReportCall): MergeHit {
  return {
    rows: call.rows.map(({ name }) => name),
    result: call.result,
    ...(call.reason === undefined ? {} : { reason: call.reason }),
  }
}

/** A tool step's response body as an attempt: null for a body that is no reply. */
export function attemptOf(task: CloseTask, step: number, body: unknown): StepAttempt | null {
  if (typeof body !== 'object' || body === null) return null
  const { usage, choices } = body as {
    usage?: { completion_tokens?: unknown }
    choices?: { finish_reason?: unknown }[]
  }
  const finish = choices?.[0]?.finish_reason
  const tokens = usage?.completion_tokens
  return {
    task,
    step,
    outputTokens: typeof tokens === 'number' ? tokens : null,
    cut: finish === 'length' || finish === 'content_filter',
  }
}

export function tallyRun(input: RunInput): RunTally {
  const calls = input.report?.calls ?? []
  const capped = calls.map((call) => capHitsOf(call, input.cappedLists))
  const merges = calls.filter((call) => call.task === 'threads' && call.tool === 'merge_threads')
  return {
    holds: BAR_TASKS.map((task) => holdOf(task, input)),
    cutOffs: input.attempts
      .filter(({ cut }) => cut)
      .map(({ task, step, outputTokens }) => ({ task, step, outputTokens })),
    capCalls: capped.filter((hits) => hits.length > 0).length,
    mergeCalls: merges.length,
    capHits: capped.flat(),
    mergeHits: merges.map(mergeHitOf),
  }
}

export type BarVerdict = {
  passing: number
  runs: number
  capRuns: number
  mergeRuns: number
  verdict: 'met' | 'missed' | 'inconclusive'
}

const shareOf = (runs: number, ofTen: number): number => Math.ceil((runs * ofTen) / 10)

/** 8 of 10 passing; coverage at least 3 and 3, scaled to PROBE_RUNS. */
export function barVerdict(tallies: readonly RunTally[]): BarVerdict {
  const runs = tallies.length
  if (runs === 0) throw new Error('barVerdict: no runs to judge')
  const passing = tallies.filter(
    ({ holds }) => holds.length > 0 && holds.every(({ held }) => held),
  ).length
  const capRuns = tallies.filter(({ capCalls }) => capCalls > 0).length
  const mergeRuns = tallies.filter(({ mergeCalls }) => mergeCalls > 0).length
  const covered = shareOf(runs, COVERAGE_OF_TEN)
  const verdict =
    passing < shareOf(runs, PASSING_OF_TEN)
      ? 'missed'
      : capRuns < covered || mergeRuns < covered
        ? 'inconclusive'
        : 'met'
  return { passing, runs, capRuns, mergeRuns, verdict }
}

/** Whether a failed close sets a non-zero exit: an overlay run exits by its bar instead. */
export function failedRunsExit(overlay: boolean, completed: readonly boolean[]): boolean {
  return !overlay && completed.some((done) => !done)
}

export type Measured<T> = { value: T | null; run: number }

/** The run holding the largest value; the first of a tie, and a run with none is skipped. */
export function largestOf<T>(
  items: readonly Measured<T>[],
  sizeOf: (value: T) => number,
): { value: T; run: number } | null {
  let best: { value: T; run: number } | null = null
  for (const { value, run } of items)
    if (value !== null && (best === null || sizeOf(value) > sizeOf(best.value)))
      best = { value, run }
  return best
}

export const barLine = (bar: BarVerdict): string =>
  `bar: ${bar.passing} of ${bar.runs} runs passed; a cap reached in ${bar.capRuns} runs, merge_threads called in ${bar.mergeRuns}: ${bar.verdict}`
