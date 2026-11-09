import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { closeReportSchema, type CloseReport, type CloseTask } from '@/lib/db'
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
const STEP_FILE = /^(identity|threads)-p\d+-s(\d+)(?:-r(\d+))?\.json$/

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown

function readReport(runDir: string): CloseReport | null {
  const path = join(runDir, 'report.json')
  return existsSync(path) ? closeReportSchema.parse(readJson(path)) : null
}

function readAttempts(runDir: string): StepAttempt[] {
  const found = readdirSync(runDir).flatMap((name) => {
    const match = STEP_FILE.exec(name)
    if (match === null) return []
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
): { bar: BarVerdict; tallies: RunTally[] } {
  const runs = readdirSync(outDir)
    .flatMap((name) => /^run(\d+)$/.exec(name)?.slice(1, 2) ?? [])
    .map(Number)
    .sort((a, b) => a - b)
  const tallies = runs.map((k) => {
    const runDir = join(outDir, `run${k}`)
    const report = readReport(runDir)
    return tallyRun({
      completed: report !== null,
      report,
      attempts: readAttempts(runDir),
      cappedLists,
    })
  })
  return { bar: barVerdict(tallies), tallies }
}
