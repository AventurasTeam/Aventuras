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
export type RunTally = { holds: readonly TaskHold[]; capCalls: number; mergeCalls: number }

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

function reachedCap(call: CloseReportCall, capped: RunInput['cappedLists']): boolean {
  if (call.task !== 'identity' || call.values === undefined) return false
  const { values } = call
  return capped.some(({ id, list }) => {
    const path = `state.${list}`
    const loss = lossOf(call, path)
    return (
      call.rows.some((row) => row.table === 'entities' && row.id === id) &&
      Object.hasOwn(values, path) &&
      (loss === undefined || !BEFORE_THE_CAP.has(loss))
    )
  })
}

export function tallyRun(input: RunInput): RunTally {
  const calls = input.report?.calls ?? []
  return {
    holds: BAR_TASKS.map((task) => holdOf(task, input)),
    capCalls: calls.filter((call) => reachedCap(call, input.cappedLists)).length,
    mergeCalls: calls.filter((call) => call.task === 'threads' && call.tool === 'merge_threads')
      .length,
  }
}

export type BarVerdict = {
  passing: number
  runs: number
  capRuns: number
  mergeRuns: number
  verdict: 'met' | 'missed' | 'inconclusive'
}

// A share of the runs, in integer arithmetic, rounded up.
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
