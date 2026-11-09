import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CloseReport } from '@/lib/db'

import { rejudgeSaved } from './close-probe-rejudge'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'close-probe-rejudge-'))
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

describe('rejudgeSaved', () => {
  it('rebuilds each run from its saved steps and report, a retried attempt beside its step', () => {
    save(1, {
      'identity-p1-s1.json': reply('length', 8_000),
      'identity-p1-s1-r1.json': reply('tool_calls', 6_480),
      'identity-p1-s2.json': reply('stop', 87),
      'threads-p1-s1.json': reply('stop', 239),
      'report.json': reportOf(),
    })
    const { tallies, bar } = rejudgeSaved(dir, [])
    expect(tallies[0]?.holds).toEqual([
      { task: 'identity', held: true, why: 'held' },
      { task: 'threads', held: true, why: 'held' },
    ])
    expect(tallies[0]?.cutOffs).toEqual([{ task: 'identity', step: 1, outputTokens: 8_000 }])
    expect(bar.runs).toBe(1)
  })

  it('misses a task whose retry was cut off too, and a run with no report', () => {
    save(1, {
      'identity-p1-s1.json': reply('length', 8_000),
      'identity-p1-s1-r1.json': reply('content_filter', 40),
      'threads-p1-s1.json': reply('stop', 239),
      'report.json': reportOf([{ task: 'identity', part: 1, reason: 'cut-off' }]),
    })
    save(2, { 'identity-p1-s1.json': reply('stop', 50) })
    const { tallies } = rejudgeSaved(dir, [])
    expect(tallies[0]?.holds.map(({ why }) => why)).toEqual(['stopped: cut-off', 'held'])
    expect(tallies[0]?.cutOffs.map(({ outputTokens }) => outputTokens)).toEqual([8_000, 40])
    expect(tallies[1]?.holds.map(({ why }) => why)).toEqual([
      'the close did not complete',
      'the close did not complete',
    ])
  })

  it('orders runs by number, not by name, and skips a step that saved an error', () => {
    save(10, { 'report.json': reportOf() })
    save(2, {
      'identity-p1-s1.json': { error: { message: 'fetch failed' } },
      'report.json': reportOf([{ task: 'threads', part: 1, reason: 'budget' }]),
    })
    const { tallies } = rejudgeSaved(dir, [])
    expect(tallies.map(({ holds }) => holds[1]?.why)).toEqual(['stopped: budget', 'held'])
  })

  it('leaves the saved files as they were', () => {
    save(1, { 'report.json': reportOf() })
    const before = readFileSync(join(dir, 'run1', 'report.json'), 'utf8')
    rejudgeSaved(dir, [])
    expect(readFileSync(join(dir, 'run1', 'report.json'), 'utf8')).toBe(before)
  })
})
