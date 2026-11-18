import { describe, expect, it } from 'vitest'

import { CLOSE_TASKS, type CloseReport, type CloseReportCall, type CloseTask } from '@/lib/db'

import {
  attemptOf,
  barVerdict,
  boundaryVerdict,
  failedRunsExit,
  largestOf,
  parseStepFileName,
  stepFileName,
  tallyRun,
  type BoundaryAttempt,
  type CapHit,
  type RunTally,
  type StepAttempt,
  type TaskHold,
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
const LANDED_LORE = call({
  task: 'lore',
  tool: 'create_lore',
  result: 'ok',
  values: { body: 'The map marks three crosses in red ink.' },
})
const LANDED_UPKEEP = call({
  task: 'upkeep',
  tool: 'update_place',
  result: 'ok',
  values: { description: 'A cove on the island’s north shore.' },
})
// Run order (CLOSE_TASKS): lore, identity, threads, upkeep land a write each.
const WRITES = [LANDED_LORE, LANDED_IDENTITY, LANDED_THREADS, LANDED_UPKEEP]

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

const NO_REPORT = 'no report: the close did not complete, or wrote none'

const run = (over: Partial<Parameters<typeof tallyRun>[0]> = {}) =>
  tallyRun({
    report: report(WRITES),
    attempts: [],
    cappedLists: CAPPED_LISTS,
    ...over,
  })

const holdFor = (tally: RunTally, task: CloseTask): TaskHold | undefined =>
  tally.holds.find((hold) => hold.task === task)

describe('tallyRun', () => {
  it('judges all seven tasks in run order, a task with no start holding as no-start', () => {
    expect(run().holds).toEqual([
      { task: 'happenings', held: true, why: 'no-start' },
      { task: 'lore', held: true, why: 'held' },
      { task: 'identity', held: true, why: 'held' },
      { task: 'threads', held: true, why: 'held' },
      { task: 'upkeep', held: true, why: 'held' },
      { task: 'lifecycle', held: true, why: 'no-start' },
      { task: 'awareness', held: true, why: 'no-start' },
    ])
  })

  it('misses every task, a task with no start included, and counts nothing, on a run with no report', () => {
    expect(run({ report: null, attempts: [attempt('identity', 1, 300)] })).toEqual({
      holds: [
        { task: 'happenings', held: false, why: NO_REPORT },
        { task: 'lore', held: false, why: NO_REPORT },
        { task: 'identity', held: false, why: NO_REPORT },
        { task: 'threads', held: false, why: NO_REPORT },
        { task: 'upkeep', held: false, why: NO_REPORT },
        { task: 'lifecycle', held: false, why: NO_REPORT },
        { task: 'awareness', held: false, why: NO_REPORT },
      ],
      cutOffs: [],
      capCalls: 0,
      mergeCalls: 0,
      capHits: [],
      mergeHits: [],
    })
  })

  it('counts a model step, a call or a recorded stop as a start', () => {
    const refused = call({
      task: 'lifecycle',
      tool: 'retire_entity',
      result: 'rejected',
      reason: 'not-active',
    })
    const tallied = run({
      report: report([...WRITES, refused], [{ task: 'awareness', part: 0, reason: 'window' }]),
      attempts: [attempt('happenings', 1, 412)],
    })
    expect(holdFor(tallied, 'happenings')).toEqual({ task: 'happenings', held: true, why: 'held' })
    expect(holdFor(tallied, 'lifecycle')).toEqual({ task: 'lifecycle', held: true, why: 'held' })
    expect(holdFor(tallied, 'awareness')).toEqual({
      task: 'awareness',
      held: false,
      why: 'stopped: window',
    })
  })

  it('misses Identity, Threads, Lore or Upkeep when it started and landed nothing', () => {
    for (const task of ['identity', 'threads', 'lore', 'upkeep'] as const) {
      const others = WRITES.filter((landed) => landed.task !== task)
      const tallied = run({ report: report(others), attempts: [attempt(task, 1, 240)] })
      expect(holdFor(tallied, task), task).toEqual({ task, held: false, why: 'no write landed' })
    }
  })

  it('holds Happenings, Lifecycle and Awareness once started, with no write', () => {
    const tallied = run({
      attempts: [
        attempt('happenings', 1, 300),
        attempt('lifecycle', 1, 200),
        attempt('awareness', 1, 150),
      ],
    })
    expect(tallied.holds.map(({ held }) => held)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ])
    for (const task of ['happenings', 'lifecycle', 'awareness'] as const)
      expect(holdFor(tallied, task), task).toEqual({ task, held: true, why: 'held' })
  })

  it('misses a task that stopped, whatever it landed', () => {
    const stopped = report(WRITES, [{ task: 'identity', part: 1, reason: 'budget' }])
    const tallied = run({ report: stopped })
    expect(holdFor(tallied, 'identity')).toEqual({
      task: 'identity',
      held: false,
      why: 'stopped: budget',
    })
    expect(holdFor(tallied, 'threads')).toEqual({ task: 'threads', held: true, why: 'held' })
  })

  it('misses a task whose calls landed nothing: a read, a refusal, an ok call wholly skipped', () => {
    const calls = [
      LANDED_LORE,
      call({ task: 'identity', tool: 'read_row', result: 'ok', why: '', turns: [] }),
      call({
        task: 'identity',
        tool: 'update_character',
        result: 'rejected',
        reason: 'over-soft-cap',
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
      LANDED_UPKEEP,
    ]
    expect(holdFor(run({ report: report(calls) }), 'identity')).toEqual({
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
    const calls = [LANDED_LORE, LANDED_IDENTITY, merged, LANDED_UPKEEP]
    expect(holdFor(run({ report: report(calls) }), 'threads')).toEqual({
      task: 'threads',
      held: true,
      why: 'held',
    })
  })

  it("holds a task whose cut attempt's retry succeeded, and reports the cut-off", () => {
    const tallied = run({
      attempts: [attempt('identity', 1, 8_000, true), attempt('identity', 1, 3_323)],
    })
    expect(holdFor(tallied, 'identity')).toEqual({ task: 'identity', held: true, why: 'held' })
    expect(tallied.cutOffs).toEqual([{ task: 'identity', step: 1, outputTokens: 8_000 }])
  })

  it('misses a task whose retry was cut off too, which stopped it, and reports both cut-offs', () => {
    const stopped = report(WRITES, [{ task: 'identity', part: 1, reason: 'cut-off' }])
    const tallied = run({
      report: stopped,
      attempts: [attempt('identity', 1, 8_000, true), attempt('identity', 1, 8_000, true)],
    })
    expect(holdFor(tallied, 'identity')).toEqual({
      task: 'identity',
      held: false,
      why: 'stopped: cut-off',
    })
    expect(holdFor(tallied, 'threads')).toEqual({ task: 'threads', held: true, why: 'held' })
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

  it("misses a task whose final attempt's reply reached 8,000 output tokens, written or not", () => {
    const tallied = run({ attempts: [attempt('threads', 2, 8_000)] })
    expect(holdFor(tallied, 'threads')).toEqual({
      task: 'threads',
      held: false,
      why: "a step's reply reached 8000 output tokens",
    })
    expect(holdFor(tallied, 'identity')).toEqual({ task: 'identity', held: true, why: 'held' })
    expect(holdFor(run({ attempts: [attempt('lifecycle', 1, 8_000)] }), 'lifecycle')).toEqual({
      task: 'lifecycle',
      held: false,
      why: "a step's reply reached 8000 output tokens",
    })
    expect(holdFor(run({ attempts: [attempt('identity', 1, 7_999)] }), 'identity')?.held).toBe(true)
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
        reason: 'over-soft-cap',
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
        skippedFields: [{ field: 'state.traits', reason: 'over-soft-cap' }],
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
      { row: 'Silver', path: 'state.traits', result: 'refused', reason: 'over-soft-cap' },
      { row: 'Silver', path: 'state.traits', result: 'refused', reason: 'over-soft-cap' },
    ])
  })

  it('counts one call sending two capped lists once, with a hit for each list', () => {
    const both = call({
      task: 'identity',
      tool: 'update_character',
      result: 'ok',
      ...onCapped,
      values: { 'state.traits': 'a', 'state.drives': 'b' },
      skippedFields: [{ field: 'state.drives', reason: 'over-soft-cap' }],
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
      { row: 'Silver', path: 'state.drives', result: 'refused', reason: 'over-soft-cap' },
    ])
  })

  it('types a reason on a refused cap hit only', () => {
    const at = { row: 'Silver', path: 'state.traits' }
    // @ts-expect-error a hit that passed the check has no reason
    const passed: CapHit = { ...at, result: 'ok', reason: 'over-soft-cap' }
    // @ts-expect-error a refused hit carries its reason
    const refused: CapHit = { ...at, result: 'refused' }
    expect([passed.result, refused.result]).toEqual(['ok', 'refused'])
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
        reason: 'merge-active-into-inactive',
        rows,
      }),
      call({ task: 'threads', tool: 'merge_threads', result: 'skipped', reason: 'later-turn' }),
      LANDED_THREADS,
    ]
    const tallied = run({ report: report(calls) })
    expect(tallied.mergeCalls).toBe(3)
    expect(tallied.mergeHits).toEqual([
      { rows: ['The map', 'The chart'], result: 'ok' },
      { rows: ['The map', 'The chart'], result: 'rejected', reason: 'merge-active-into-inactive' },
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

describe('step file names', () => {
  it('names a step by task, part and step, and a retried attempt by its retry beside it', () => {
    expect(stepFileName({ task: 'identity', part: 1 }, 2, 0)).toBe('identity-p1-s2.json')
    expect(stepFileName({ task: 'threads', part: 1 }, 3, 1)).toBe('threads-p1-s3-r1.json')
    expect(stepFileName({ task: 'identity', part: 2 }, 12, 0)).toBe('identity-p2-s12.json')
  })

  it('reads back every name it writes, for every close task', () => {
    for (const task of CLOSE_TASKS)
      for (const [part, step, retry] of [
        [0, 1, 0],
        [1, 3, 1],
        [2, 12, 0],
        [11, 10, 12],
      ] as const)
        expect(parseStepFileName(stepFileName({ task, part }, step, retry))).toEqual({
          task,
          part,
          step,
          retry,
        })
  })

  it('reads no other file, and no step that no task start preceded', () => {
    expect(stepFileName(null, 3, 0)).toBe('unknown-p0-s3.json')
    for (const name of [
      'unknown-p0-s3.json',
      'report.json',
      'identity-p1-s2.json.bak',
      'identity-p1-s.json',
      'identity-s2.json',
      'scribe-p1-s2.json',
      'boundary-c1.json',
    ])
      expect(parseStepFileName(name), name).toBeNull()
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

  it('passes runs whose untouched tasks hold as no-start, as Happenings does on MiniLM', () => {
    const covered = (): RunTally => ({ ...run(), capCalls: 1, mergeCalls: 1 })
    expect(barVerdict(runs(10, covered))).toEqual({
      passing: 10,
      runs: 10,
      capRuns: 10,
      mergeRuns: 10,
      verdict: 'met',
    })
  })

  it('refuses to judge no runs', () => {
    expect(() => barVerdict([])).toThrow(/no runs/)
  })
})

const boundary = (outcome: BoundaryAttempt['outcome']): BoundaryAttempt => ({
  outcome,
  endEntryId: outcome === 'failed' || outcome === 'aborted' ? null : 'entry_0001',
  outputTokens: 180,
})

const boundaryRuns = (counts: Partial<Record<BoundaryAttempt['outcome'], number>>) =>
  Object.entries(counts).flatMap(([outcome, n]) =>
    Array.from({ length: n }, () => boundary(outcome as BoundaryAttempt['outcome'])),
  )

describe('boundaryVerdict', () => {
  it('holds at 8 picks of 10 with none cut off', () => {
    expect(boundaryVerdict(boundaryRuns({ picked: 8, parse: 1, failed: 1 }))).toEqual({
      runs: 10,
      picked: 8,
      cutOff: 0,
      held: true,
    })
  })

  it('misses at 7 picks of 10', () => {
    expect(boundaryVerdict(boundaryRuns({ picked: 7, parse: 3 }))).toEqual({
      runs: 10,
      picked: 7,
      cutOff: 0,
      held: false,
    })
  })

  it('misses on one cut-off, whatever the picks', () => {
    expect(boundaryVerdict(boundaryRuns({ picked: 9, 'reply-cut-off': 1 }))).toEqual({
      runs: 10,
      picked: 9,
      cutOff: 1,
      held: false,
    })
  })

  it('counts a parse fallback, a failure and an abort as no pick', () => {
    expect(boundaryVerdict(boundaryRuns({ parse: 4, failed: 3, aborted: 3 }))).toEqual({
      runs: 10,
      picked: 0,
      cutOff: 0,
      held: false,
    })
  })

  it('scales to the runs made: 4 of 5 holds, 3 of 5 misses', () => {
    expect(boundaryVerdict(boundaryRuns({ picked: 4, parse: 1 })).held).toBe(true)
    expect(boundaryVerdict(boundaryRuns({ picked: 3, parse: 2 })).held).toBe(false)
  })

  it('refuses to judge no attempts', () => {
    expect(() => boundaryVerdict([])).toThrow(/no attempts/)
  })
})

describe('failedRunsExit', () => {
  it('fails a plain run on any close that did not complete', () => {
    expect(failedRunsExit(false, [true, false, true])).toBe(true)
    expect(failedRunsExit(false, [true, true])).toBe(false)
  })

  it('leaves an overlay run to the bar, which counts a failed close as a miss', () => {
    expect(failedRunsExit(true, [true, false, true])).toBe(false)
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
