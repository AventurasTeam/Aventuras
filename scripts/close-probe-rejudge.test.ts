import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CLOSE_TASKS, type CloseReport } from '@/lib/db'

import type { RunTally } from './close-probe-bar'
import { rejudgeSaved } from './close-probe-rejudge'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'close-probe-rejudge-'))
  writeFileSync(join(dir, 'bar.json'), '{}')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const reply = (finishReason: string, tokens: number) => ({
  response: { choices: [{ finish_reason: finishReason }], usage: { completion_tokens: tokens } },
})

const landed = (task: 'identity' | 'threads') => ({
  part: 1,
  task,
  tool: task === 'identity' ? 'update_character' : 'update_thread',
  result: 'ok' as const,
  rows: [],
  why: 'The turn says so.',
  turns: ['entry_1'],
  values: { description: 'Settled.' },
})

const reportOf = (stopped: CloseReport['stopped'] = []): CloseReport => ({
  version: 1,
  actionId: 'act_probe',
  calls: [landed('identity'), landed('threads')],
  stopped,
  noToolCalls: false,
})

function save(run: number, files: Record<string, unknown>): void {
  mkdirSync(join(dir, `run${run}`), { recursive: true })
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(dir, `run${run}`, name), JSON.stringify(content))
}

function onlyTally(): RunTally {
  const { runs } = rejudgeSaved(dir, [])
  expect(runs).toHaveLength(1)
  return (runs[0] as (typeof runs)[number]).tally
}

const tallyOf = (runs: ReturnType<typeof rejudgeSaved>['runs'], k: number) => runs[k]?.tally

describe('rejudgeSaved', () => {
  it('rebuilds each run from its saved steps and report, a retried attempt beside its step', () => {
    save(1, {
      'identity-p1-s1.json': reply('length', 8_000),
      'identity-p1-s1-r1.json': reply('tool_calls', 6_480),
      'identity-p1-s2.json': reply('stop', 87),
      'threads-p1-s1.json': reply('stop', 239),
      'report.json': reportOf(),
    })
    const { runs, bar } = rejudgeSaved(dir, [])
    expect(tallyOf(runs, 0)?.holds).toEqual([
      { task: 'identity', held: true, why: 'held' },
      { task: 'threads', held: true, why: 'held' },
    ])
    expect(tallyOf(runs, 0)?.cutOffs).toEqual([{ task: 'identity', step: 1, outputTokens: 8_000 }])
    expect(bar.runs).toBe(1)
  })

  it('holds a task whose two steps were each cut off and retried successfully', () => {
    save(1, {
      'identity-p1-s1.json': reply('length', 8_000),
      'identity-p1-s1-r1.json': reply('tool_calls', 900),
      'identity-p1-s2.json': reply('length', 8_000),
      'identity-p1-s2-r1.json': reply('tool_calls', 700),
      'identity-p1-s3.json': reply('stop', 60),
      'threads-p1-s1.json': reply('stop', 239),
      'report.json': reportOf(),
    })
    const tally = onlyTally()
    expect(tally.holds.map(({ held }) => held)).toEqual([true, true])
    expect(tally.cutOffs.map(({ step }) => step)).toEqual([1, 2])
  })

  it('misses a task whose retry was cut off too, and a run with no report', () => {
    save(1, {
      'identity-p1-s1.json': reply('length', 8_000),
      'identity-p1-s1-r1.json': reply('content_filter', 40),
      'threads-p1-s1.json': reply('stop', 239),
      'report.json': reportOf([{ task: 'identity', part: 1, reason: 'cut-off' }]),
    })
    save(2, { 'identity-p1-s1.json': reply('stop', 50) })
    const { runs } = rejudgeSaved(dir, [])
    expect(tallyOf(runs, 0)?.holds.map(({ why }) => why)).toEqual(['stopped: cut-off', 'held'])
    expect(tallyOf(runs, 0)?.cutOffs.map(({ outputTokens }) => outputTokens)).toEqual([8_000, 40])
    expect(tallyOf(runs, 1)?.holds.map(({ why }) => why)).toEqual([
      'no report: the close did not complete, or wrote none',
      'no report: the close did not complete, or wrote none',
    ])
  })

  it('orders runs by number, and names each by its own, across a gap', () => {
    const steps = {
      'identity-p1-s1.json': reply('stop', 9),
      'threads-p1-s1.json': reply('stop', 9),
      'report.json': reportOf(),
    }
    save(10, steps)
    save(2, steps)
    save(7, steps)
    expect(rejudgeSaved(dir, []).runs.map(({ run }) => run)).toEqual([2, 7, 10])
  })

  it("does not count a step file that saved an error as an attempt, and doesn't crash on one", () => {
    save(1, {
      'identity-p1-s1.json': { error: { message: 'fetch failed' } },
      'identity-p1-s1-r1.json': reply('stop', 300),
      'threads-p1-s1.json': reply('stop', 9),
      'report.json': reportOf(),
    })
    const tally = onlyTally()
    expect(tally.holds[0]).toEqual({ task: 'identity', held: true, why: 'held' })
    expect(tally.cutOffs).toEqual([])
  })

  it('reads a step file of any close task, not only identity and threads', () => {
    const task = CLOSE_TASKS.find((name) => name !== 'identity' && name !== 'threads')
    expect(task).toBeDefined()
    save(1, {
      [`${task}-p1-s1.json`]: reply('length', 8_000),
      'identity-p1-s1.json': reply('stop', 9),
      'threads-p1-s1.json': reply('stop', 9),
      'report.json': reportOf(),
    })
    const tally = onlyTally()
    expect(tally.cutOffs).toEqual([{ task, step: 1, outputTokens: 8_000 }])
  })

  it('refuses a run with a report and no step file it can read', () => {
    save(1, { 'report.json': reportOf(), 'notes.txt': 'x' })
    expect(() => rejudgeSaved(dir, [])).toThrow(/run1.*step files/)
  })

  it("refuses a run whose report holds a task's calls and no step file of that task", () => {
    save(1, { 'threads-p1-s1.json': reply('stop', 9), 'report.json': reportOf() })
    expect(() => rejudgeSaved(dir, [])).toThrow(/run1.*identity/)
  })

  it('refuses a folder with no bar.json, which marks an overlay measure', () => {
    rmSync(join(dir, 'bar.json'))
    save(1, { 'threads-p1-s1.json': reply('stop', 9), 'report.json': reportOf() })
    expect(() => rejudgeSaved(dir, [])).toThrow(/bar\.json/)
  })
})
