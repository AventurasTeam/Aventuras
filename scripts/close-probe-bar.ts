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
/** A call counted as a cap check: the row's name, the list path, and why it was refused, if it was. */
export type CapHit = {
  row: string
  path: string
  result: CloseReportCall['result']
  reason?: string
}
/** A merge_threads call, by the names of the rows it named. */
export type MergeHit = { rows: string[]; result: CloseReportCall['result']; reason?: string }
export type RunTally = {
  holds: readonly TaskHold[]
  capCalls: number
  mergeCalls: number
  capHits: readonly CapHit[]
  mergeHits: readonly MergeHit[]
}

type RunInput = {
  completed: boolean
  report: CloseReport | null
  cutOffTasks: readonly CloseTask[]
  /** Each task's largest step output, from captured usage. */
  maxOutputTokens: Readonly<Partial<Record<CloseTask, number>>>
  cappedLists: readonly { id: string; list: CappedList }[]
}

function landedWrite(call: CloseReportCall): boolean {
  if (call.result !== 'ok') return false
  if (call.survivor !== undefined) return true
  const skipped = new Set((call.skippedFields ?? []).map(({ field }) => field))
  return Object.keys(call.values ?? {}).some((path) => !skipped.has(path))
}

function holdOf(task: CloseTask, input: RunInput): TaskHold {
  const missed = (why: string): TaskHold => ({ task, held: false, why })
  const { report } = input
  if (!input.completed || report === null) return missed('the close did not complete')
  const stop = report.stopped.find((stopped) => stopped.task === task)
  if (stop !== undefined) return missed(`stopped: ${stop.reason}`)
  if (input.cutOffTasks.includes(task)) return missed('a reply was cut off')
  const most = input.maxOutputTokens[task]
  if (most !== undefined && most >= TOOL_STEP_MAX_OUTPUT_DEFAULT)
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
    return [
      { row: row.name, path, result: call.result, ...(loss === undefined ? {} : { reason: loss }) },
    ]
  })
}

function mergeHitOf(call: CloseReportCall): MergeHit {
  return {
    rows: call.rows.map(({ name }) => name),
    result: call.result,
    ...(call.reason === undefined ? {} : { reason: call.reason }),
  }
}

export function tallyRun(input: RunInput): RunTally {
  const calls = input.report?.calls ?? []
  const capped = calls.map((call) => capHitsOf(call, input.cappedLists))
  const merges = calls.filter((call) => call.task === 'threads' && call.tool === 'merge_threads')
  return {
    holds: BAR_TASKS.map((task) => holdOf(task, input)),
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
