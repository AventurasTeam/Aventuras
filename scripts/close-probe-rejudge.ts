import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CLOSE_TASKS, closeReportSchema, type CloseReport, type CloseTask } from '@/lib/db'
import type { CappedList } from '@/lib/pipeline/definitions/close-agent/fields'

import {
  attemptOf,
  barVerdict,
  type BarVerdict,
  type RunTally,
  type StepAttempt,
  tallyRun,
} from './close-probe-bar'

// <task>-p<part>-s<step>.json, and <task>-p<part>-s<step>-r<k>.json for an attempt the step retried.
const STEP_FILE = new RegExp(`^(${CLOSE_TASKS.join('|')})-p\\d+-s(\\d+)(?:-r(\\d+))?\\.json$`)

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown

function readReport(runDir: string): CloseReport | null {
  const path = join(runDir, 'report.json')
  return existsSync(path) ? closeReportSchema.parse(readJson(path)) : null
}

function readAttempts(runDir: string, report: CloseReport | null): StepAttempt[] {
  const names = readdirSync(runDir).filter((name) => STEP_FILE.test(name))
  // A close that wrote a report made tool steps: no file for them means a layout this can't read.
  if (report !== null && names.length === 0)
    throw new Error(`[probe:close] ${runDir} has a report and no step files to read`)
  // A task with no step file would pass the output bound unread.
  const saved = new Set(names.map((name) => (STEP_FILE.exec(name) as RegExpExecArray)[1]))
  const unsaved = [...new Set(report?.calls.map(({ task }) => task))].filter((t) => !saved.has(t))
  if (unsaved.length > 0)
    throw new Error(
      `[probe:close] ${runDir} has no step file for ${unsaved.join(', ')}, whose calls its report holds`,
    )
  const found = names.flatMap((name) => {
    const match = STEP_FILE.exec(name) as RegExpExecArray
    const [, task, step, retry] = match
    const response = (readJson(join(runDir, name)) as { response?: unknown }).response
    const attempt = attemptOf(task as CloseTask, Number(step), response)
    return attempt === null ? [] : [{ attempt, retry: Number(retry ?? 0) }]
  })
  return found
    .sort((a, b) => a.attempt.step - b.attempt.step || a.retry - b.retry)
    .map(({ attempt }) => attempt)
}

/** Judges the runs a probe saved under `outDir` by the bar as it stands, with no model call. */
export function rejudgeSaved(
  outDir: string,
  cappedLists: readonly { id: string; list: CappedList }[],
): { bar: BarVerdict; runs: { run: number; tally: RunTally }[] } {
  if (!existsSync(join(outDir, 'bar.json')))
    throw new Error(
      `[probe:close] ${outDir} has no bar.json: re-judging applies the overlay's capped lists, which only a PROBE_OVERLAY=1 measure saves`,
    )
  const numbers = readdirSync(outDir)
    .flatMap((name) => /^run(\d+)$/.exec(name)?.slice(1, 2) ?? [])
    .map(Number)
    .sort((a, b) => a - b)
  const runs = numbers.map((run) => {
    const runDir = join(outDir, `run${run}`)
    const report = readReport(runDir)
    const tally = tallyRun({
      completed: report !== null,
      report,
      attempts: readAttempts(runDir, report),
      cappedLists,
    })
    return { run, tally }
  })
  return { bar: barVerdict(runs.map(({ tally }) => tally)), runs }
}
