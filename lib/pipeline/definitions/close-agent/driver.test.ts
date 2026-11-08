import type { AssistantModelMessage, LanguageModelUsage, ModelMessage, ToolModelMessage } from 'ai'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome } from '@/lib/actions/types'
import {
  generateToolStep,
  type CallRetryError,
  type ContextWindowFailure,
  type ReplyCutOffFailure,
  type ResolveModelConfig,
  type ToolStep,
  type ToolStepCall,
  type ToolStepInvalidCall,
  type ToolStepResult,
} from '@/lib/ai'
import { entities } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { entityWriteAction } from './entity-write'
import { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { CLOSE_TASK_STEP_BUDGET, runCloseTask, type TaskEnd } from './run-task'
import type { CloseTaskDef, TaskRunContext } from './task'
import { readToolSchema, writeToolSchema, type ReadTool, type WriteTool } from './tool'
import { CLOSE_REASON } from './verdict'
import type { PhaseContext, PhaseEmittedEvent } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

const WREN = 'char_00000000-0000-4000-8000-000000000001'
const ACTION_ID = 'act_close_driver'
// The step call is scripted, so the config is only passed through.
const CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

const USAGE: LanguageModelUsage = {
  inputTokens: 100,
  inputTokenDetails: {
    noCacheTokens: 100,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokens: 20,
  outputTokenDetails: { textTokens: 20, reasoningTokens: undefined },
  totalTokens: 120,
}

const WINDOW: ContextWindowFailure = {
  detectedBy: 'check',
  estimate: 9_000,
  providerId: 'prov_close',
  modelId: 'lore-model',
  window: 8_000,
  windowSource: 'configured',
}

const CUT: ReplyCutOffFailure = {
  cause: 'max-output',
  outputTokens: 8_000,
  reasoningTokens: null,
  maxOutput: 8_000,
  window: null,
  providerId: 'prov_close',
  modelId: 'lore-model',
}

let f: CloseFixture
let ids: CloseIds
let ledger: CloseLedger
let writer: CloseLedgerWriter
let beforePlan: (() => void) | undefined

// The chapter runs from the opening to the third reply (positions 1-7); E is that reply, t7.
const endEntryId = (): string => f.entries[6]!.id
const chapterEntryIds = (): string[] => f.entries.slice(0, 7).map((entry) => entry.id)

async function seedWren(): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: WREN,
            branchId: f.branchId,
            kind: 'character',
            name: 'Wren',
            description: 'A courier.',
            status: 'active',
            injectionMode: 'auto',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: f.branchId,
      entryId: null,
    },
    f.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding Wren refused: ${result.reason}`)
}

async function description(): Promise<string | null> {
  const [found] = await f.ctx.db
    .select({ description: entities.description })
    .from(entities)
    .where(and(eq(entities.branchId, f.branchId), eq(entities.id, WREN)))
  return found?.description ?? null
}

// Reads the description from SQL and appends to it, so a second call shows whether it saw the first.
const appendNoteTool: WriteTool = {
  kind: 'write',
  name: 'append_note',
  description: "Append a note to a character's description.",
  schema: writeToolSchema({ id: z.string(), note: z.string() }),
  ids: { id: { shape: 'single', prefixes: ['char'] } },
  plan: async (args, ctx) => {
    beforePlan?.()
    const id = args.id as string
    const [current] = await ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, id)))
    if (current === undefined) return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows: [] }
    const next = `${current.description ?? ''} ${args.note as string}`.trim()
    return {
      kind: 'write',
      actions: [entityWriteAction(current, { description: next })],
      lost: [],
      rows: [{ table: 'entities', id, name: current.name }],
      values: { description: next },
    }
  },
}

const peekRowTool: ReadTool = {
  kind: 'read',
  name: 'peek_row',
  description: 'Read one character.',
  schema: readToolSchema({ id: z.string() }),
  ids: { id: { shape: 'single', prefixes: ['char'] } },
  read: async (args, ctx) => {
    const id = args.id as string
    return {
      output: { id: ctx.ids.handleOf(id) },
      rows: [{ table: 'entities', id, name: ctx.ids.nameOfId(id) ?? '' }],
      read: [{ table: 'entities', id }],
    }
  },
}

// Answers whatever the test sets, to pin how an answer goes out.
let echoOutput: unknown
const echoTool: ReadTool = {
  kind: 'read',
  name: 'echo',
  description: 'Answer a set value.',
  schema: readToolSchema({}),
  ids: {},
  read: async () => ({ output: echoOutput, rows: [], read: [] }),
}
const echoCall: ToolStepCall = { toolCallId: 'k1', toolName: 'echo', input: {} }

function taskDef(over: Partial<CloseTaskDef> = {}): CloseTaskDef {
  return {
    task: 'identity',
    tools: [appendNoteTool, peekRowTool],
    readFields: { character: ['description'] },
    start: async () => ({ show: ['c1'], seeds: [{ table: 'entities', id: WREN }] }),
    render: (_start, ctx) => ({ system: 'The chapter.', user: `Identity.\n${ctx.writesSoFar}` }),
    ...over,
  }
}

function phaseContext(controller = new AbortController()): PhaseContext {
  return {
    actionId: ACTION_ID,
    abortSignal: controller.signal,
    intermediates: {},
    log: makeLogger(ACTION_ID),
    db: f.ctx.db,
    runInTransaction: f.ctx.runInTransaction,
    storyId: f.storyId,
    branchId: f.branchId,
  }
}

function runContext(phase: PhaseContext, over: Partial<TaskRunContext> = {}): TaskRunContext {
  return {
    db: phase.db,
    branchId: f.branchId,
    endEntryId: endEntryId(),
    task: 'identity',
    part: 1,
    ids,
    readFields: { character: ['description'] },
    survivorOf: (table, id) => writer.survivorOf(table, id),
    phase,
    chapterEntryIds: chapterEntryIds(),
    ledger: writer,
    config: CONFIG,
    ...over,
  }
}

// Stands in for the orchestrator: applies each group and sends its outcome back.
async function drive(
  def: CloseTaskDef,
  ctx: TaskRunContext,
): Promise<{ end: TaskEnd; events: PhaseEmittedEvent[] }> {
  const gen = runCloseTask(def, ctx)
  const events: PhaseEmittedEvent[] = []
  let next = await gen.next()
  while (!next.done) {
    const event = next.value
    events.push(event)
    let reply: GroupOutcome | undefined
    if (event.type === 'delta_group_emitted')
      reply = await applyDeltaActionGroupWithOutcomes(
        event.actions,
        { actionId: ctx.phase.actionId, branchId: ctx.phase.branchId, entryId: event.entryId },
        f.ctx,
      )
    next = await gen.next(reply)
  }
  return { end: next.value, events }
}

const appendCall = (toolCallId: string, note: string): ToolStepCall => ({
  toolCallId,
  toolName: 'append_note',
  input: { id: 'c1', note, turns: ['t7'], why: 'She says so at the toll house.' },
})

const peekCall = (toolCallId: string): ToolStepCall => ({
  toolCallId,
  toolName: 'peek_row',
  input: { id: 'c1' },
})

// A step as the SDK returns it: the assistant message, then its own answers to invalid calls.
function okStep(
  calls: readonly ToolStepCall[],
  opts: {
    invalid?: readonly ToolStepInvalidCall[]
    finishReason?: ToolStep['finishReason']
    recoverable?: readonly CallRetryError[]
  } = {},
): ToolStepResult {
  const invalid = opts.invalid ?? []
  const asked = [
    ...calls.map(({ toolCallId, toolName, input }) => ({ toolCallId, toolName, input })),
    ...invalid.map(({ toolCallId, toolName }) => ({ toolCallId, toolName, input: {} })),
  ]
  const assistant: AssistantModelMessage = {
    role: 'assistant',
    content:
      asked.length === 0
        ? [{ type: 'text' as const, text: 'Nothing more to do.' }]
        : asked.map((part) => ({ type: 'tool-call' as const, ...part })),
  }
  const sdkAnswers: ToolModelMessage[] =
    invalid.length === 0
      ? []
      : [
          {
            role: 'tool',
            content: invalid.map(({ toolCallId, toolName, detail }) => ({
              type: 'tool-result' as const,
              toolCallId,
              toolName,
              output: { type: 'error-text' as const, value: detail },
            })),
          },
        ]
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: invalid,
      responseMessages: [assistant, ...sdkAnswers],
      text: '',
      finishReason: opts.finishReason ?? (asked.length > 0 ? 'tool-calls' : 'stop'),
      usage: USAGE,
    },
    recoverable: opts.recoverable ?? [],
  }
}

function stepOf(result: ToolStepResult): ToolStep {
  if (result.status !== 'ok') throw new Error(`expected an ok step, got ${result.status}`)
  return result.step
}

const sentMessages = (call: number): readonly ModelMessage[] =>
  vi.mocked(generateToolStep).mock.calls[call]![1].messages

beforeEach(async () => {
  vi.resetAllMocks()
  // An unscripted step calls nothing, which ends the task.
  vi.mocked(generateToolStep).mockResolvedValue(okStep([]))
  beforePlan = undefined
  echoOutput = undefined
  f = await openCloseFixture()
  await seedWren()
  ids = new CloseIds()
  ids.showTurns(chapterEntryIds())
  ids.show(WREN, 'Wren')
  ledger = seedCloseLedger({})
  writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id))
})

afterEach(() => {
  resetAllStores()
})

describe('runCloseTask', () => {
  it("runs a step's calls in order, the second reading the first's write", async () => {
    vi.mocked(generateToolStep).mockResolvedValueOnce(
      okStep([appendCall('k1', 'first'), appendCall('k2', 'second')]),
    )

    const { end, events } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({ status: 'finished' })
    expect(await description()).toBe('A courier. first second')
    expect(events.filter((event) => event.type === 'delta_group_emitted')).toHaveLength(2)
    expect(ledger.calls.map((call) => [call.tool, call.result, call.values])).toEqual([
      ['append_note', 'ok', { description: 'A courier. first' }],
      ['append_note', 'ok', { description: 'A courier. first second' }],
    ])
  })

  it("skips an invalid call, answers the rest, and keeps the SDK's messages as they came", async () => {
    const first = okStep([peekCall('k1')], {
      invalid: [
        { toolCallId: 'k2', toolName: 'peek_row', detail: 'Invalid input for tool peek_row' },
      ],
    })
    vi.mocked(generateToolStep).mockResolvedValueOnce(first)

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({ status: 'finished' })
    expect(sentMessages(0)).toEqual([])
    expect(sentMessages(1)).toEqual([
      ...stepOf(first).responseMessages,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'k1',
            toolName: 'peek_row',
            output: { type: 'json', value: { id: 'c1' } },
          },
        ],
      },
    ])
    expect(ledger.calls.map((call) => call.tool)).toEqual(['peek_row'])
  })

  it('goes on after a stop reply with calls, and ends on a reply with none, whatever its finish', async () => {
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([appendCall('k1', 'first')], { finishReason: 'stop' }))
      .mockResolvedValueOnce(okStep([], { finishReason: 'tool-calls' }))
      .mockResolvedValueOnce(okStep([appendCall('k3', 'never')]))

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({ status: 'finished' })
    expect(generateToolStep).toHaveBeenCalledTimes(2)
    expect(await description()).toBe('A courier. first')
  })

  it('stops at the budget of 24 steps and records the stop', async () => {
    vi.mocked(generateToolStep).mockResolvedValue(okStep([peekCall('k')]))

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(CLOSE_TASK_STEP_BUDGET).toBe(24)
    expect(generateToolStep).toHaveBeenCalledTimes(24)
    expect(end).toEqual({ status: 'stopped', reason: 'budget' })
    expect(ledger.stopped).toEqual([{ task: 'identity', part: 1, reason: 'budget' }])
  })

  it('returns aborted, recording no stop, on an abort inside the last step', async () => {
    const controller = new AbortController()
    let plans = 0
    beforePlan = () => {
      plans++
      if (plans === CLOSE_TASK_STEP_BUDGET) controller.abort()
    }
    vi.mocked(generateToolStep).mockResolvedValue(okStep([appendCall('k', 'x')]))

    const { end } = await drive(taskDef(), runContext(phaseContext(controller)))

    expect(generateToolStep).toHaveBeenCalledTimes(CLOSE_TASK_STEP_BUDGET)
    expect(plans).toBe(CLOSE_TASK_STEP_BUDGET)
    expect(end).toEqual({ status: 'aborted' })
    expect(ledger.stopped).toEqual([])
  })

  const LATER_STOPS: [string, ToolStepResult][] = [
    ['window', { status: 'stopped', reason: 'window', failure: WINDOW, recoverable: [] }],
    ['cut-off', { status: 'stopped', reason: 'cut-off', failure: CUT, recoverable: [] }],
  ]

  it.each(LATER_STOPS)(
    "stops on a later step's %s and keeps what landed",
    async (reason, stopped) => {
      vi.mocked(generateToolStep)
        .mockResolvedValueOnce(okStep([appendCall('k1', 'kept')]))
        .mockResolvedValueOnce(stopped)

      const { end } = await drive(taskDef(), runContext(phaseContext()))

      expect(end).toEqual({ status: 'stopped', reason })
      expect(ledger.stopped).toEqual([{ task: 'identity', part: 1, reason }])
      expect(await description()).toBe('A courier. kept')
    },
  )

  it('fails on a first call that does not fit', async () => {
    vi.mocked(generateToolStep).mockResolvedValueOnce({
      status: 'failed',
      error: { tier: 'context-window', ...WINDOW },
      recoverable: [],
    })

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({
      status: 'failed',
      error: { kind: 'context-window', target: 'lore-mgmt', ...WINDOW },
    })
    expect(ledger.stopped).toEqual([])
  })

  it('fails on a failed call after a step that landed', async () => {
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([appendCall('k1', 'first')]))
      .mockResolvedValueOnce({
        status: 'failed',
        error: { tier: 'provider', reason: 'network', detail: 'socket hang up' },
        recoverable: [],
      })

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({
      status: 'failed',
      error: { kind: 'provider', reason: 'network', detail: 'socket hang up' },
    })
  })

  it('fails as config-resolver when lore-mgmt resolves to no model', async () => {
    vi.mocked(generateToolStep).mockResolvedValueOnce({
      status: 'not-configured',
      kind: 'no-profile-assigned',
    })

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({
      status: 'failed',
      error: {
        kind: 'config-resolver',
        failure: 'no-profile-assigned',
        target: 'lore-mgmt',
        phaseName: 'agent',
      },
    })
  })

  it('returns aborted on an abort between calls, before the next call runs', async () => {
    const controller = new AbortController()
    let plans = 0
    beforePlan = () => {
      plans++
      controller.abort()
    }
    vi.mocked(generateToolStep).mockResolvedValueOnce(
      okStep([appendCall('k1', 'first'), appendCall('k2', 'second')]),
    )

    const { end } = await drive(taskDef(), runContext(phaseContext(controller)))

    expect(end).toEqual({ status: 'aborted' })
    expect(plans).toBe(1)
    expect(await description()).toBe('A courier. first')
    expect(generateToolStep).toHaveBeenCalledTimes(1)
  })

  it('returns aborted before a step when the run is already cancelled, and when the step is', async () => {
    const controller = new AbortController()
    controller.abort()

    expect((await drive(taskDef(), runContext(phaseContext(controller)))).end).toEqual({
      status: 'aborted',
    })
    expect(generateToolStep).not.toHaveBeenCalled()

    vi.mocked(generateToolStep).mockResolvedValueOnce({ status: 'aborted', recoverable: [] })
    expect((await drive(taskDef(), runContext(phaseContext()))).end).toEqual({ status: 'aborted' })
  })

  it('makes no call and no render when the task has nothing to show', async () => {
    const render = vi.fn(taskDef().render)

    const { end } = await drive(
      taskDef({ start: async () => null, render }),
      runContext(phaseContext()),
    )

    expect(end).toEqual({ status: 'finished' })
    expect(generateToolStep).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('yields a recoverable_error for each retried attempt, on a step that lands and one that fails', async () => {
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(
        okStep([appendCall('k1', 'first')], {
          recoverable: [{ tier: 'provider', reason: 'timeout', detail: 'slow' }],
        }),
      )
      .mockResolvedValueOnce({
        status: 'failed',
        error: { tier: 'provider', reason: 'network' },
        recoverable: [
          { tier: 'parse', detail: 'bad json', attempt: 1 },
          { tier: 'provider', reason: 'network' },
        ],
      })

    const { end, events } = await drive(taskDef(), runContext(phaseContext()))

    expect(events.map((event) => event.type)).toEqual([
      'recoverable_error',
      'delta_group_emitted',
      'recoverable_error',
      'recoverable_error',
    ])
    expect(
      events.flatMap((event) => (event.type === 'recoverable_error' ? [event.error] : [])),
    ).toEqual([
      { kind: 'provider', reason: 'timeout', detail: 'slow' },
      { kind: 'phase-logic', detail: 'bad json' },
      { kind: 'provider', reason: 'network' },
    ])
    expect(end).toEqual({ status: 'failed', error: { kind: 'provider', reason: 'network' } })
  })

  it('sends every step with the cache marker, the run signal and action, firstCall on the first only', async () => {
    vi.mocked(generateToolStep).mockResolvedValueOnce(okStep([peekCall('k1')]))
    const phase = phaseContext()

    await drive(taskDef(), runContext(phase))

    const sent = vi.mocked(generateToolStep).mock.calls
    expect(sent).toHaveLength(2)
    sent.forEach(([target, request, config, signal, options], index) => {
      expect(target).toBe('lore-mgmt')
      expect(request.firstCall).toBe(index === 0)
      expect(request.prompt).toEqual({ system: 'The chapter.', user: 'Identity.\n' })
      expect(Object.keys(request.tools)).toEqual(['append_note', 'peek_row'])
      expect(config).toBe(CONFIG)
      expect(signal).toBe(phase.abortSignal)
      expect(options).toEqual({ actionId: ACTION_ID, cacheSystemPrefix: true })
    })
  })

  it('counts a step holding only an invalid call as a tool call, recording no call', async () => {
    const first = okStep([], {
      invalid: [{ toolCallId: 'k1', toolName: 'append_note', detail: 'Invalid input' }],
    })
    vi.mocked(generateToolStep).mockResolvedValueOnce(first)

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({ status: 'finished' })
    expect(generateToolStep).toHaveBeenCalledTimes(2)
    expect(ledger.noToolCalls).toBe(false)
    expect(ledger.calls).toEqual([])
    expect(sentMessages(1)).toEqual(stepOf(first).responseMessages)
  })

  it('answers a call to a tool outside the task rejected, recording it nowhere', async () => {
    vi.mocked(generateToolStep).mockResolvedValueOnce(
      okStep([{ toolCallId: 'k1', toolName: 'merge_threads', input: {} }]),
    )

    await drive(taskDef(), runContext(phaseContext()))

    expect(ledger.calls).toEqual([])
    expect(ledger.noToolCalls).toBe(false)
    expect(sentMessages(1).at(-1)).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'k1',
          toolName: 'merge_threads',
          output: { type: 'json', value: { result: 'rejected' } },
        },
      ],
    })
  })

  it("renders a task with the writes so far, an earlier task's included", async () => {
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([appendCall('k1', 'first')]))
      .mockResolvedValueOnce(okStep([]))
    const phase = phaseContext()
    const render = vi.fn(taskDef().render)

    await drive(taskDef(), runContext(phase))
    await drive({ ...taskDef({ render }), task: 'upkeep' }, runContext(phase, { task: 'upkeep' }))

    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]![1].writesSoFar).toBe(writer.writesSoFar(ids))
    expect(render.mock.calls[0]![1].writesSoFar).toContain('append_note Wren (c1): description')
  })

  it('leaves a row read in one task unread in the next, so a write to it there is refused', async () => {
    const unseeded = taskDef({ start: async () => ({ show: ['c1'], seeds: [] }) })
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([peekCall('k1')]))
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(okStep([appendCall('k2', 'late')]))
    const phase = phaseContext()

    expect((await drive(unseeded, runContext(phase))).end).toEqual({ status: 'finished' })
    expect(
      (await drive({ ...unseeded, task: 'upkeep' }, runContext(phase, { task: 'upkeep' }))).end,
    ).toEqual({ status: 'finished' })

    expect(ledger.calls.map((call) => [call.task, call.tool, call.result])).toEqual([
      ['identity', 'peek_row', 'ok'],
      ['upkeep', 'append_note', 'rejected'],
    ])
    expect(await description()).toBe('A courier.')
  })

  it("runs under the def's task and fields, whatever the context names", async () => {
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([appendCall('k1', 'first')]))
      .mockResolvedValueOnce({
        status: 'stopped',
        reason: 'window',
        failure: WINDOW,
        recoverable: [],
      })
    const seen: unknown[] = []
    const def = taskDef({
      start: async (ctx) => {
        seen.push([ctx.task, ctx.readFields])
        return { show: ['c1'], seeds: [{ table: 'entities', id: WREN }] }
      },
    })

    await drive(def, runContext(phaseContext(), { task: 'upkeep', readFields: {} }))

    expect(seen).toEqual([['identity', { character: ['description'] }]])
    expect(ledger.calls.map((call) => call.task)).toEqual(['identity'])
    expect(ledger.stopped).toEqual([{ task: 'identity', part: 1, reason: 'window' }])
  })

  it.each<[string, (phase: PhaseContext) => Partial<TaskRunContext>]>([
    ['branch', () => ({ branchId: 'br_00000000-0000-4000-8000-0000000000ff' })],
    ['db', (phase) => ({ db: Object.create(phase.db) as PhaseContext['db'] })],
  ])("throws, starting nothing, when the context's %s isn't the phase's", async (field, over) => {
    const start = vi.fn(taskDef().start)
    const phase = phaseContext()

    await expect(drive(taskDef({ start }), runContext(phase, over(phase)))).rejects.toThrow(
      `runCloseTask: the context's ${field} isn't the phase's`,
    )
    expect(start).not.toHaveBeenCalled()
    expect(generateToolStep).not.toHaveBeenCalled()
  })

  const NOT_JSON: [string, unknown][] = [
    ['undefined', undefined],
    ['an array holding undefined', [1, undefined]],
    ['NaN', Number.NaN],
    ['an object holding Infinity', { at: Number.POSITIVE_INFINITY }],
  ]

  it.each(NOT_JSON)('fails the step whose read answers %s, naming the tool', async (_, output) => {
    echoOutput = output
    vi.mocked(generateToolStep).mockResolvedValueOnce(okStep([echoCall]))

    await expect(
      drive(
        taskDef({ tools: [appendNoteTool, peekRowTool, echoTool] }),
        runContext(phaseContext()),
      ),
    ).rejects.toThrow("close tool echo answered a value that isn't JSON")
    expect(generateToolStep).toHaveBeenCalledTimes(1)
  })

  it.each<[string, unknown, unknown]>([
    ['a string as text', 'Nothing to read.', { type: 'text', value: 'Nothing to read.' }],
    [
      'nested JSON as json',
      { a: [1, 'x', null, true, { b: -2.5 }] },
      { type: 'json', value: { a: [1, 'x', null, true, { b: -2.5 }] } },
    ],
  ])('sends a read answering %s', async (_, output, sent) => {
    echoOutput = output
    vi.mocked(generateToolStep).mockResolvedValueOnce(okStep([echoCall]))

    await drive(taskDef({ tools: [echoTool] }), runContext(phaseContext()))

    expect(sentMessages(1).at(-1)).toEqual({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'k1', toolName: 'echo', output: sent }],
    })
  })
})
