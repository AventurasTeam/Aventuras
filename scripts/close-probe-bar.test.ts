import { describe, expect, it } from 'vitest'

import type { CloseReport, CloseReportCall } from '@/lib/db'

import {
  attemptOf,
  barVerdict,
  largestOf,
  tallyRun,
  type StepAttempt,
  type RunTally,
} from './close-probe-bar'

const CAPPED = 'char_00000000-0000-4000-8000-000000000001'
const BARE = 'char_00000000-0000-4000-8000-000000000002'
const KEEP = 'thr_00000000-0000-4000-8000-000000000003'
const CAPPED_LISTS = [{ id: CAPPED, list: 'traits' as const }]

type CallFields = Pick<CloseReportCall, 'task' | 'tool' | 'result'> & Partial<CloseReportCall>

const call = (over: CallFields): CloseReportCall => ({
  part: 1,
  rows: [],
  why: 'The turn says so.',
  turns: ['entry_1'],
  ...over,
})

const onCapped = { rows: [{ table: 'entities', id: CAPPED, name: 'Silver' }] }

const LANDED_IDENTITY = call({
  task: 'identity',
  tool: 'update_character',
  result: 'ok',
  ...onCapped,
  values: { description: 'The cook.' },
})
const LANDED_THREADS = call({
  task: 'threads',
  tool: 'update_thread',
  result: 'ok',
  values: { description: 'Settled.' },
})

const report = (calls: CloseReportCall[], stopped: CloseReport['stopped'] = []): CloseReport => ({
  version: 1,
  actionId: 'act_probe',
  calls,
  stopped,
  noToolCalls: calls.length === 0,
})

const attempt = (
  task: StepAttempt['task'],
  step: number,
  outputTokens: number | null,
  cut = false,
): StepAttempt => ({ task, step, outputTokens, cut })

const run = (over: Partial<Parameters<typeof tallyRun>[0]> = {}) =>
  tallyRun({
    completed: true,
    report: report([LANDED_IDENTITY, LANDED_THREADS]),
    attempts: [],
    cappedLists: CAPPED_LISTS,
    ...over,
  })

describe('tallyRun', () => {
  it('holds both tasks on a completed close where each landed a write', () => {
    expect(run().holds).toEqual([
      { task: 'identity', held: true, why: 'held' },
      { task: 'threads', held: true, why: 'held' },
    ])
  })

  it('misses both tasks, and counts nothing, on a close that did not complete', () => {
    expect(run({ completed: false, report: null })).toEqual({
      holds: [
        { task: 'identity', held: false, why: 'the close did not complete' },
        { task: 'threads', held: false, why: 'the close did not complete' },
      ],
      cutOffs: [],
      capCalls: 0,
      mergeCalls: 0,
      capHits: [],
      mergeHits: [],
    })
  })

  it('misses a task that stopped, whatever it landed', () => {
    const stopped = report(
      [LANDED_IDENTITY, LANDED_THREADS],
      [{ task: 'identity', part: 1, reason: 'budget' }],
    )
    expect(run({ report: stopped }).holds).toEqual([
      { task: 'identity', held: false, why: 'stopped: budget' },
      { task: 'threads', held: true, why: 'held' },
    ])
  })

  it('misses a task whose calls landed nothing: a read, a refusal, an ok call wholly skipped', () => {
    const calls = [
      call({ task: 'identity', tool: 'read_row', result: 'ok', why: '', turns: [] }),
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'rejected',
        reason: 'over the soft cap',
        values: { 'state.traits': 'a, b' },
      }),
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'ok',
        values: { 'state.voice': 'Gruff.' },
        skippedFields: [{ field: 'state.voice', reason: 'later-turn' }],
      }),
      LANDED_THREADS,
    ]
    expect(run({ report: report(calls) }).holds[0]).toEqual({
      task: 'identity',
      held: false,
      why: 'no write landed',
    })
  })

  it("counts a landed merge's kept row as a write", () => {
    const merged = call({
      task: 'threads',
      tool: 'merge_threads',
      result: 'ok',
      survivor: { table: 'threads', id: KEEP },
    })
    expect(run({ report: report([LANDED_IDENTITY, merged]) }).holds[1]).toEqual({
      task: 'threads',
      held: true,
      why: 'held',
    })
  })

  it("holds a task whose cut attempt's retry succeeded, and reports the cut-off", () => {
    const tallied = run({
      attempts: [attempt('identity', 1, 8_000, true), attempt('identity', 1, 3_323)],
    })
    expect(tallied.holds[0]).toEqual({ task: 'identity', held: true, why: 'held' })
    expect(tallied.cutOffs).toEqual([{ task: 'identity', step: 1, outputTokens: 8_000 }])
  })

  it('misses a task whose retry was cut off too, which stopped it, and reports both cut-offs', () => {
    const stopped = report(
      [LANDED_IDENTITY, LANDED_THREADS],
      [{ task: 'identity', part: 1, reason: 'cut-off' }],
    )
    const tallied = run({
      report: stopped,
      attempts: [attempt('identity', 1, 8_000, true), attempt('identity', 1, 8_000, true)],
    })
    expect(tallied.holds).toEqual([
      { task: 'identity', held: false, why: 'stopped: cut-off' },
      { task: 'threads', held: true, why: 'held' },
    ])
    expect(tallied.cutOffs).toEqual([
      { task: 'identity', step: 1, outputTokens: 8_000 },
      { task: 'identity', step: 1, outputTokens: 8_000 },
    ])
  })

  it('reports a cut-off whose output the server did not report', () => {
    expect(run({ attempts: [attempt('threads', 2, null, true)] }).cutOffs).toEqual([
      { task: 'threads', step: 2, outputTokens: null },
    ])
  })

  it("misses a task whose final attempt's reply reached 8,000 output tokens", () => {
    expect(run({ attempts: [attempt('threads', 2, 8_000)] }).holds).toEqual([
      { task: 'identity', held: true, why: 'held' },
      { task: 'threads', held: false, why: "a step's reply reached 8000 output tokens" },
    ])
    expect(run({ attempts: [attempt('identity', 1, 7_999)] }).holds[0]?.held).toBe(true)
  })

  it("leaves a cut attempt's output out of the task's largest step output", () => {
    const attempts = [
      attempt('threads', 1, 8_000, true),
      attempt('threads', 1, 7_999),
      attempt('identity', 2, 5_000),
    ]
    expect(run({ attempts }).holds.every(({ held }) => held)).toBe(true)
  })

  it('counts the Identity calls whose capped list reached the cap check, landed or refused', () => {
    const calls = [
      // Landed.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'ok',
        ...onCapped,
        values: { 'state.traits': 'a' },
      }),
      // Refused at the cap, alone.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'rejected',
        reason: 'over the soft cap',
        ...onCapped,
        values: { 'state.traits': 'a' },
      }),
      // Refused at the cap beside a landed sibling.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'ok',
        ...onCapped,
        values: { 'state.traits': 'a', description: 'b' },
        skippedFields: [{ field: 'state.traits', reason: 'over the soft cap' }],
      }),
      // Protected beside a landed sibling: never reached the check.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'ok',
        ...onCapped,
        values: { 'state.traits': 'a', description: 'b' },
        skippedFields: [{ field: 'state.traits', reason: 'later-turn' }],
      }),
      // Wholly protected: one shared reason, no skippedFields.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'skipped',
        reason: 'user-edited-since-prose',
        ...onCapped,
        values: { 'state.traits': 'a' },
      }),
      // Stopped by the read gate: no values.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'rejected',
        reason: 'unread',
        ...onCapped,
      }),
      // A gone row.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'rejected',
        reason: 'row-gone',
        ...onCapped,
        values: { 'state.traits': 'a' },
      }),
      // A row with no capped list.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'ok',
        rows: [{ table: 'entities', id: BARE, name: 'Arrow' }],
        values: { 'state.traits': 'a' },
      }),
      // Another list on the capped row.
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'ok',
        ...onCapped,
        values: { 'state.drives': 'a' },
      }),
    ]
    const tallied = run({ report: report(calls) })
    expect(tallied.capCalls).toBe(3)
    expect(tallied.capHits).toEqual([
      { row: 'Silver', path: 'state.traits', result: 'ok' },
      { row: 'Silver', path: 'state.traits', result: 'refused', reason: 'over the soft cap' },
      { row: 'Silver', path: 'state.traits', result: 'refused', reason: 'over the soft cap' },
    ])
  })

  it('counts one call sending two capped lists once, with a hit for each list', () => {
    const both = call({
      task: 'identity',
      tool: 'update_character',
      result: 'ok',
      ...onCapped,
      values: { 'state.traits': 'a', 'state.drives': 'b' },
      skippedFields: [{ field: 'state.drives', reason: 'over the soft cap' }],
    })
    const tallied = run({
      report: report([both]),
      cappedLists: [
        { id: CAPPED, list: 'traits' },
        { id: CAPPED, list: 'drives' },
      ],
    })
    expect(tallied.capCalls).toBe(1)
    expect(tallied.capHits).toEqual([
      { row: 'Silver', path: 'state.traits', result: 'ok' },
      { row: 'Silver', path: 'state.drives', result: 'refused', reason: 'over the soft cap' },
    ])
  })

  it('counts every merge_threads call, whatever its result', () => {
    const rows = [
      { table: 'threads', id: KEEP, name: 'The map' },
      { table: 'threads', id: 'thr_00000000-0000-4000-8000-000000000004', name: 'The chart' },
    ]
    const calls = [
      call({
        task: 'threads',
        tool: 'merge_threads',
        result: 'ok',
        rows,
        survivor: { table: 'threads', id: KEEP },
      }),
      call({
        task: 'threads',
        tool: 'merge_threads',
        result: 'rejected',
        reason: 'keep the active one',
        rows,
      }),
      call({ task: 'threads', tool: 'merge_threads', result: 'skipped', reason: 'later-turn' }),
      LANDED_THREADS,
    ]
    const tallied = run({ report: report(calls) })
    expect(tallied.mergeCalls).toBe(3)
    expect(tallied.mergeHits).toEqual([
      { rows: ['The map', 'The chart'], result: 'ok' },
      { rows: ['The map', 'The chart'], result: 'rejected', reason: 'keep the active one' },
      { rows: [], result: 'skipped', reason: 'later-turn' },
    ])
  })
})

const tally = (passed: boolean, capCalls = 0, mergeCalls = 0): RunTally => ({
  holds: [
    { task: 'identity', held: passed, why: passed ? 'held' : 'no write landed' },
    { task: 'threads', held: true, why: 'held' },
  ],
  cutOffs: [],
  capCalls,
  mergeCalls,
  capHits: [],
  mergeHits: [],
})

const runs = (n: number, make: (k: number) => RunTally): RunTally[] =>
  Array.from({ length: n }, (_, k) => make(k))

describe('attemptOf', () => {
  const reply = (finishReason: string, tokens: number) => ({
    choices: [{ finish_reason: finishReason }],
    usage: { completion_tokens: tokens },
  })

  it('reads a step reply as final, and one the server cut or filtered as a cut attempt', () => {
    expect(attemptOf('identity', 3, reply('tool_calls', 120))).toEqual({
      task: 'identity',
      step: 3,
      outputTokens: 120,
      cut: false,
    })
    expect(attemptOf('identity', 3, reply('stop', 90))?.cut).toBe(false)
    expect(attemptOf('threads', 1, reply('length', 8_000))).toEqual({
      task: 'threads',
      step: 1,
      outputTokens: 8_000,
      cut: true,
    })
    expect(attemptOf('threads', 1, reply('content_filter', 40))?.cut).toBe(true)
  })

  it('reports no output tokens when the body carries no usage, and is null for no body', () => {
    expect(attemptOf('threads', 1, { choices: [{ finish_reason: 'length' }] })).toEqual({
      task: 'threads',
      step: 1,
      outputTokens: null,
      cut: true,
    })
    expect(attemptOf('threads', 1, null)).toBeNull()
    expect(attemptOf('threads', 1, 'not json')).toBeNull()
  })
})

describe('barVerdict', () => {
  it('meets the bar at 8 passing runs of 10, with a cap and a merge in 3 runs each', () => {
    expect(barVerdict(runs(10, (k) => tally(k < 8, k < 3 ? 1 : 0, k >= 7 ? 2 : 0)))).toEqual({
      passing: 8,
      runs: 10,
      capRuns: 3,
      mergeRuns: 3,
      verdict: 'met',
    })
  })

  it('misses it at 7 passing runs, whatever the coverage', () => {
    expect(barVerdict(runs(10, (k) => tally(k < 7, 1, 1))).verdict).toBe('missed')
    expect(barVerdict(runs(10, (k) => tally(k < 7))).verdict).toBe('missed')
  })

  it('is inconclusive when the runs pass but a coverage count reaches only 2 runs', () => {
    expect(barVerdict(runs(10, (k) => tally(true, k < 2 ? 1 : 0, 1))).verdict).toBe('inconclusive')
    expect(barVerdict(runs(10, (k) => tally(true, 1, k < 2 ? 1 : 0))).verdict).toBe('inconclusive')
  })

  it('scales to the runs made: 4 of 5 passing, coverage in 2 runs', () => {
    expect(barVerdict(runs(5, (k) => tally(k < 4, k < 2 ? 1 : 0, k < 2 ? 1 : 0))).verdict).toBe(
      'met',
    )
    expect(barVerdict(runs(5, (k) => tally(k < 4, k < 1 ? 1 : 0, 1))).verdict).toBe('inconclusive')
    expect(barVerdict(runs(5, (k) => tally(k < 3, 1, 1))).verdict).toBe('missed')
  })

  it('refuses to judge no runs', () => {
    expect(() => barVerdict([])).toThrow(/no runs/)
  })
})

describe('largestOf', () => {
  it('names the run of the largest value, the first of a tie, and skips runs with none', () => {
    const items = [
      { value: null, run: 1 },
      { value: 120, run: 2 },
      { value: 300, run: 3 },
      { value: 300, run: 4 },
      { value: 90, run: 5 },
    ]
    expect(largestOf(items, (n) => n)).toEqual({ value: 300, run: 3 })
  })

  it('is null when no run has a value', () => {
    expect(largestOf([{ value: null, run: 1 }], (n: number) => n)).toBeNull()
    expect(largestOf([], (n: number) => n)).toBeNull()
  })
})
