import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { closeReportSchema, type CloseReport } from '@/lib/db'
import type { CappedList } from '@/lib/pipeline/definitions/close-agent/fields'

import {
  attemptOf,
  barVerdict,
  parseStepFileName,
  type BarVerdict,
  type RunTally,
  type StepAttempt,
  tallyRun,
} from './close-probe-bar'

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8')) as unknown

type CappedLists = readonly { id: string; list: CappedList }[]

const LIST_NAMES = ['traits', 'drives', 'agenda'] as const satisfies readonly CappedList[]

const savedBarSchema = z.object({
  cappedLists: z.array(z.object({ id: z.string(), list: z.enum(LIST_NAMES) })).optional(),
})

function savedCappedLists(outDir: string): CappedLists | undefined {
  const saved = savedBarSchema.safeParse(readJson(join(outDir, 'bar.json')))
  if (!saved.success)
    throw new Error(`[probe:close] ${outDir}/bar.json records capped lists this can't read`)
  return saved.data.cappedLists
}

function readReport(runDir: string): CloseReport | null {
  const path = join(runDir, 'report.json')
  return existsSync(path) ? closeReportSchema.parse(readJson(path)) : null
}

function readAttempts(runDir: string, report: CloseReport | null): StepAttempt[] {
  const files = readdirSync(runDir).flatMap((name) => {
    const file = parseStepFileName(name)
    return file === null ? [] : [{ name, file }]
  })
  // A close that wrote a report made tool steps: no file for them means a layout this can't read.
  if (report !== null && files.length === 0)
    throw new Error(`[probe:close] ${runDir} has a report and no step files to read`)
  // A task with no step file would pass the output bound unread.
  const saved = new Set(files.map(({ file }) => file.task))
  const unsaved = [...new Set(report?.calls.map(({ task }) => task))].filter((t) => !saved.has(t))
  if (unsaved.length > 0)
    throw new Error(
      `[probe:close] ${runDir} has no step file for ${unsaved.join(', ')}, whose calls its report holds`,
    )
  const found = files.flatMap(({ name, file }) => {
    const response = (readJson(join(runDir, name)) as { response?: unknown }).response
    const attempt = attemptOf(file.task, file.step, response)
    return attempt === null ? [] : [{ attempt, retry: file.retry }]
  })
  return found
    .sort((a, b) => a.attempt.step - b.attempt.step || a.retry - b.retry)
    .map(({ attempt }) => attempt)
}

/**
 * Judges the runs a probe saved under `outDir` by the bar as it stands, with no model call. Coverage
 * reads the capped lists bar.json recorded, and `overlayLists` only for a bar.json that records none.
 */
export function rejudgeSaved(
  outDir: string,
  overlayLists: CappedLists,
): {
  bar: BarVerdict
  runs: { run: number; tally: RunTally }[]
  cappedLists: { from: 'bar.json' | 'overlay'; lists: CappedLists }
} {
  if (!existsSync(join(outDir, 'bar.json')))
    throw new Error(
      `[probe:close] ${outDir} has no bar.json: re-judging applies the overlay's capped lists, which only a PROBE_OVERLAY=1 measure saves`,
    )
  const saved = savedCappedLists(outDir)
  const cappedLists =
    saved === undefined
      ? { from: 'overlay' as const, lists: overlayLists }
      : { from: 'bar.json' as const, lists: saved }
  const numbers = readdirSync(outDir)
    .flatMap((name) => /^run(\d+)$/.exec(name)?.slice(1, 2) ?? [])
    .map(Number)
    .sort((a, b) => a - b)
  const runs = numbers.map((run) => {
    const runDir = join(outDir, `run${run}`)
    const report = readReport(runDir)
    const tally = tallyRun({
      report,
      attempts: readAttempts(runDir, report),
      cappedLists: cappedLists.lists,
    })
    return { run, tally }
  })
  return { bar: barVerdict(runs.map(({ tally }) => tally)), runs, cappedLists }
}
