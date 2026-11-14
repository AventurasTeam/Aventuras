import {
  generateText,
  type AssistantModelMessage,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolModelMessage,
} from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { and, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome, PipelineAction } from '@/lib/actions/types'
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
import type { ChapterPartCut } from '@/lib/chapters'
import {
  clearEmbeddingStaleOp,
  emptyEntityState,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  lore,
  packFloat32,
  sourceHash,
  storyEntries,
  threads,
  upsertVecOps,
  type CloseTask,
} from '@/lib/db'
import { logger, makeLogger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { appSettingsStore, currentStoryStore, entitiesStore, resetAllStores } from '@/lib/stores'

import { __setCloseEmbedDepsForTest, type CloseEmbedDeps } from './close-happenings'
import { entityWriteAction } from './entity-write'
import { identityTask } from './identity'
import { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { loreTask } from './lore'
import { closeParts } from './parts'
import { CLOSE_TASK_STEP_BUDGET, runCloseTask, type TaskEnd, type TaskRunArgs } from './run-task'
import {
  __setCloseAgentSlots,
  closeAgentSlots,
  NO_CLOSE_TASKS,
  PRODUCTION_CLOSE_SLOTS,
  type CloseAgentSlots,
  type CodeStepContext,
  type SlotEntry,
  type SlotName,
} from './slots'
import type { CloseTaskDef, TaskPromptContext } from './task'
import { threadsTask } from './threads'
import {
  readToolSchema,
  writeToolSchema,
  type ReadFields,
  type ReadTool,
  type WriteTool,
} from './tool'
import { readTaskTurns } from './turns'
import { CLOSE_REASON } from './verdict'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, PipelineError } from '../../types'
import { openCloseFixture, queryAllOn, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import {
  closeIdsOf,
  closeLedgerOf,
  seedCloseLedger,
  setCloseParts,
  setCloseRange,
} from '../close-intermediates'
import type { CloseLedger, CloseRange } from '../intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

// Pass-throughs: closeParts is spied for its arguments; a slot case scripts a task end.
vi.mock('./parts', async (importOriginal) => {
  const actual = await importOriginal<{ closeParts: typeof closeParts }>()
  return { ...actual, closeParts: vi.fn(actual.closeParts) }
})
vi.mock('./run-task', async (importOriginal) => {
  const actual = await importOriginal<{ runCloseTask: typeof runCloseTask }>()
  return { ...actual, runCloseTask: vi.fn(actual.runCloseTask) }
})

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

// Reads the description from SQL and appends to it, so a second call shows if it saw the first.
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

const createNoteTool: WriteTool = {
  kind: 'write',
  name: 'create_note',
  description: 'Create a lore note.',
  schema: writeToolSchema({ title: z.string() }),
  ids: {},
  plan: async (args, ctx) => {
    const id = generateId('lore')
    const title = args.title as string
    return {
      kind: 'write',
      actions: [
        {
          action: {
            kind: 'createLore',
            source: 'chapter_close',
            payload: {
              entry: {
                id,
                branchId: ctx.branchId,
                title,
                body: 'Paid.',
                injectionMode: 'auto',
                createdAt: 1,
                updatedAt: 1,
              },
            },
          },
          fields: ['title', 'body'],
          row: 'lore',
        },
      ],
      lost: [],
      rows: [{ table: 'lore', id, name: title }],
      values: { title },
      createdId: id,
    }
  },
}

// Names a lore row and writes nothing, so only the read gate decides its answer.
const touchNoteTool: WriteTool = {
  kind: 'write',
  name: 'touch_note',
  description: 'Name a lore note.',
  schema: writeToolSchema({ id: z.string() }),
  ids: { id: { shape: 'single', prefixes: ['lore'] } },
  plan: async (args, ctx) => ({
    kind: 'write',
    actions: [],
    lost: [],
    rows: [
      { table: 'lore', id: args.id as string, name: ctx.ids.nameOfId(args.id as string) ?? '' },
    ],
    values: {},
  }),
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

function runContext(phase: PhaseContext): TaskRunArgs {
  return {
    endEntryId: endEntryId(),
    part: 1,
    ids,
    survivorOf: (table, id) => writer.survivorOf(table, id),
    clusterOf: () => undefined,
    landedCalls: (tool) => writer.landedCalls(tool),
    phase,
    taskEntryIds: chapterEntryIds(),
    ledger: writer,
    config: CONFIG,
  }
}

// Stands in for the orchestrator: applies each group and sends its outcome back.
async function drive(
  def: CloseTaskDef,
  ctx: TaskRunArgs,
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

const createCall = (toolCallId: string): ToolStepCall => ({
  toolCallId,
  toolName: 'create_note',
  input: { title: 'The Toll', turns: ['t7'], why: 'The toll is named at the river.' },
})

const touchCall = (toolCallId: string): ToolStepCall => ({
  toolCallId,
  toolName: 'touch_note',
  input: { id: 'lo1', turns: ['t7'], why: 'The toll is paid again.' },
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
    /** The assistant message's call order, by id; else the valid calls, then the invalid. */
    order?: readonly string[]
  } = {},
): ToolStepResult {
  const invalid = opts.invalid ?? []
  const asked = [
    ...calls.map(({ toolCallId, toolName, input }) => ({ toolCallId, toolName, input })),
    ...invalid.map(({ toolCallId, toolName }) => ({ toolCallId, toolName, input: {} })),
  ]
  const { order } = opts
  if (order !== undefined)
    asked.sort((a, b) => order.indexOf(a.toolCallId) - order.indexOf(b.toolCallId))
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

// The answers' call ids, across every tool message, in the order they go out.
const callIdsOf = (messages: readonly { role: string; content: unknown }[]): string[] =>
  messages.flatMap((message) =>
    message.role === 'tool' && Array.isArray(message.content)
      ? message.content.map((part: { toolCallId?: string }) => part.toolCallId ?? '')
      : [],
  )

type SentPrompt = Parameters<MockLanguageModelV3['doGenerate']>[0]['prompt']

// What a provider receives for `messages` after the pair: the SDK's own prompt conversion.
async function requestPrompt(messages: readonly ModelMessage[]): Promise<SentPrompt> {
  let prompt: SentPrompt = []
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      prompt = options.prompt
      return {
        content: [{ type: 'text', text: 'done' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }
    },
  })
  await generateText({ model, messages: [{ role: 'user', content: 'Identity.' }, ...messages] })
  return prompt
}

beforeEach(() => {
  vi.resetAllMocks()
  // An unscripted step calls nothing, which ends the task.
  vi.mocked(generateToolStep).mockResolvedValue(okStep([]))
})

afterEach(() => {
  resetAllStores()
})

describe('runCloseTask', () => {
  beforeEach(async () => {
    beforePlan = undefined
    echoOutput = undefined
    f = await openCloseFixture()
    await seedWren()
    ids = new CloseIds()
    ids.showTurns(chapterEntryIds())
    ids.show(WREN, 'Wren')
    ledger = seedCloseLedger({})
    writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id), ACTION_ID)
  })

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

  it('runs one call per call id: a repeat, which the SDK gives the first call input, is refused', async () => {
    vi.mocked(generateToolStep).mockResolvedValueOnce(
      okStep([appendCall('k1', 'first'), appendCall('k1', 'first')]),
    )

    const { end, events } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({ status: 'finished' })
    expect(await description()).toBe('A courier. first')
    expect(events.filter((event) => event.type === 'delta_group_emitted')).toHaveLength(1)
    expect(ledger.calls).toHaveLength(1)
    const answers = (sentMessages(1)[1] as ToolModelMessage).content
    expect(answers.map((part) => part.type === 'tool-result' && part.toolCallId)).toEqual([
      'k1',
      'k1',
    ])
    expect(answers[1]).toMatchObject({
      output: {
        type: 'json',
        value: { result: 'rejected', reason: expect.stringContaining('k1') },
      },
    })
  })

  it("drops the SDK's own answer under a repeated call id, so each call place gets one answer", async () => {
    // A valid and an invalid call under one id: the SDK gives both the valid one's input, and still
    // answers the invalid one with an error.
    const first = okStep([appendCall('k1', 'first'), appendCall('k1', 'first')])
    const [assistant] = stepOf(first).responseMessages
    const sdkError: ToolModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'k1',
          toolName: 'append_note',
          output: { type: 'error-text', value: 'Invalid input' },
        },
      ],
    }
    vi.mocked(generateToolStep).mockResolvedValueOnce({
      ...first,
      step: { ...stepOf(first), responseMessages: [assistant!, sdkError] },
    } as ToolStepResult)

    await drive(taskDef(), runContext(phaseContext()))

    expect(await description()).toBe('A courier. first')
    const answers = (sentMessages(1)[1] as ToolModelMessage).content
    expect(answers).toHaveLength(2)
    expect(answers).toMatchObject([
      { toolCallId: 'k1', output: { type: 'json', value: { result: 'ok' } } },
      { toolCallId: 'k1', output: { type: 'json', value: { result: 'rejected' } } },
    ])
  })

  it.each([1, 2])(
    'answers every call under a repeated id whose first call is invalid, from %i SDK error(s)',
    async (sdkErrors) => {
      // Invalid first: the SDK gives every call under the id the invalid one, and errors one or both.
      const invalid = { toolCallId: 'k1', toolName: 'append_note', detail: 'Invalid input' }
      const first = okStep([], { invalid: [invalid, invalid] })
      const [assistant, sdk] = stepOf(first).responseMessages
      const errors = (sdk as ToolModelMessage).content.slice(0, sdkErrors)
      vi.mocked(generateToolStep).mockResolvedValueOnce({
        ...first,
        step: {
          ...stepOf(first),
          responseMessages: [assistant!, { ...(sdk as ToolModelMessage), content: errors }],
        },
      } as ToolStepResult)

      await drive(taskDef(), runContext(phaseContext()))

      expect(await description()).toBe('A courier.')
      const answers = (sentMessages(1)[1] as ToolModelMessage).content
      expect(answers).toMatchObject([
        { toolCallId: 'k1', output: { type: 'error-text', value: 'Invalid input' } },
        { toolCallId: 'k1', output: { type: 'json', value: { result: 'rejected' } } },
      ])
      expect(answers).toHaveLength(2)
    },
  )

  it("skips an invalid call, answers the rest, and sends the model's message, then one tool message in call order", async () => {
    const first = okStep([peekCall('k1')], {
      invalid: [
        { toolCallId: 'k2', toolName: 'peek_row', detail: 'Invalid input for tool peek_row' },
      ],
    })
    vi.mocked(generateToolStep).mockResolvedValueOnce(first)

    const { end } = await drive(taskDef(), runContext(phaseContext()))

    expect(end).toEqual({ status: 'finished' })
    expect(sentMessages(0)).toEqual([])
    const [assistant, sdkAnswers] = stepOf(first).responseMessages
    expect(sentMessages(1)).toEqual([
      assistant,
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'k1',
            toolName: 'peek_row',
            output: { type: 'json', value: { id: 'c1' } },
          },
          ...(sdkAnswers as ToolModelMessage).content,
        ],
      },
    ])
    expect(ledger.calls.map((call) => call.tool)).toEqual(['peek_row'])
  })

  // Valid, invalid, outside the task, valid: the SDK's answer to k2 comes back first.
  async function driveMixedStep(): Promise<{
    model: ModelMessage
    stored: readonly ModelMessage[]
  }> {
    const first = okStep(
      [
        appendCall('k1', 'first'),
        { toolCallId: 'k3', toolName: 'merge_threads', input: {} },
        peekCall('k4'),
      ],
      {
        invalid: [{ toolCallId: 'k2', toolName: 'append_note', detail: 'Invalid input' }],
        order: ['k1', 'k2', 'k3', 'k4'],
      },
    )
    vi.mocked(generateToolStep).mockResolvedValueOnce(first)
    await drive(taskDef(), runContext(phaseContext()))
    return { model: stepOf(first).responseMessages[0]!, stored: sentMessages(1) }
  }

  it("keeps a mixed step's model message as returned, then one tool message in call order", async () => {
    const { model, stored } = await driveMixedStep()

    expect(stored).toHaveLength(2)
    expect(stored[0]).toEqual(model)
    expect(stored[1]!.role).toBe('tool')
    expect(callIdsOf(stored)).toEqual(['k1', 'k2', 'k3', 'k4'])
  })

  it("sends a mixed step's answers to the provider in call order", async () => {
    const { stored } = await driveMixedStep()

    // The SDK's own conversion merges consecutive tool messages, keeping their parts' order.
    const sent = await requestPrompt(stored)
    expect(sent.filter((message) => message.role === 'tool')).toHaveLength(1)
    expect(callIdsOf(sent)).toEqual(['k1', 'k2', 'k3', 'k4'])
  })

  it("gives each answer to a repeated call id that call's place, in call order", async () => {
    const first = okStep([peekCall('k1'), peekCall('k2'), appendCall('k1', 'again')], {
      invalid: [{ toolCallId: 'k3', toolName: 'append_note', detail: 'Invalid input' }],
    })
    vi.mocked(generateToolStep).mockResolvedValueOnce(first)

    await drive(taskDef(), runContext(phaseContext()))

    const sent = sentMessages(1)
    expect(sent).toHaveLength(2)
    expect(
      (sent[1] as ToolModelMessage).content.flatMap((part) =>
        part.type === 'tool-result' ? [[part.toolCallId, part.toolName]] : [],
      ),
    ).toEqual([
      ['k1', 'peek_row'],
      ['k2', 'peek_row'],
      ['k1', 'append_note'],
      ['k3', 'append_note'],
    ])
  })

  it('puts answers to no call after the calls, as they came, keeping the provider options', async () => {
    const first = okStep([peekCall('k1')], {
      invalid: [{ toolCallId: 'k2', toolName: 'peek_row', detail: 'Invalid input' }],
    })
    const [assistant, sdkAnswers] = stepOf(first).responseMessages
    const orphan = (toolCallId: string) => ({
      type: 'tool-result' as const,
      toolCallId,
      toolName: 'peek_row',
      output: { type: 'text' as const, value: 'no call' },
    })
    const withOrphans: ToolModelMessage = {
      role: 'tool',
      content: [orphan('kx'), ...(sdkAnswers as ToolModelMessage).content, orphan('ky')],
      providerOptions: { mock: { kept: true } },
    }
    vi.mocked(generateToolStep).mockResolvedValueOnce({
      ...first,
      step: { ...stepOf(first), responseMessages: [assistant!, withOrphans] },
    } as ToolStepResult)

    await drive(taskDef(), runContext(phaseContext()))

    const stored = sentMessages(1)
    expect(callIdsOf(stored)).toEqual(['k1', 'k2', 'kx', 'ky'])
    expect(stored[1]).toMatchObject({ providerOptions: { mock: { kept: true } } })
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

  it.each<[string, ToolStepResult, PipelineError['kind']]>([
    [
      'a failed step',
      { status: 'failed', error: { tier: 'provider', reason: 'network' }, recoverable: [] },
      'provider',
    ],
    [
      'no model for lore-mgmt',
      { status: 'not-configured', kind: 'no-profile-assigned' },
      'config-resolver',
    ],
  ])(
    'logs the task it fails at debug on %s, with its part and error kind',
    async (_, step, kind) => {
      const debug = vi.spyOn(logger, 'debug')
      onTestFinished(() => debug.mockRestore())
      vi.mocked(generateToolStep).mockResolvedValueOnce(step)

      const { end } = await drive(
        { ...taskDef(), task: 'upkeep' },
        { ...runContext(phaseContext()), part: 2 },
      )

      expect(end).toMatchObject({ status: 'failed', error: { kind } })
      expect(debug).toHaveBeenCalledWith(
        'memory.close_task_failed',
        { task: 'upkeep', part: 2, kind },
        { actionId: ACTION_ID },
      )
    },
  )

  it("logs each invalid call at debug, with its task, part, tool and the SDK's detail", async () => {
    const debug = vi.spyOn(logger, 'debug')
    onTestFinished(() => debug.mockRestore())
    vi.mocked(generateToolStep).mockResolvedValueOnce(
      okStep([peekCall('k1')], {
        invalid: [
          { toolCallId: 'k2', toolName: 'append_note', detail: 'Invalid input for append_note' },
          { toolCallId: 'k3', toolName: 'merge_threads', detail: 'No such tool: merge_threads' },
        ],
      }),
    )

    await drive({ ...taskDef(), task: 'upkeep' }, { ...runContext(phaseContext()), part: 2 })

    expect(debug.mock.calls.filter(([kind]) => kind === 'memory.close_tool_call_invalid')).toEqual([
      [
        'memory.close_tool_call_invalid',
        { task: 'upkeep', part: 2, tool: 'append_note', detail: 'Invalid input for append_note' },
        { actionId: ACTION_ID },
      ],
      [
        'memory.close_tool_call_invalid',
        { task: 'upkeep', part: 2, tool: 'merge_threads', detail: 'No such tool: merge_threads' },
        { actionId: ACTION_ID },
      ],
    ])
    expect(debug).not.toHaveBeenCalledWith(
      'memory.close_task_failed',
      expect.anything(),
      expect.anything(),
    )
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
          output: {
            type: 'json',
            value: { result: 'rejected', reason: expect.stringContaining('merge_threads') },
          },
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
    await drive({ ...taskDef({ render }), task: 'upkeep' }, runContext(phase))

    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]![1]).not.toHaveProperty('ledger')
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
    expect((await drive({ ...unseeded, task: 'upkeep' }, runContext(phase))).end).toEqual({
      status: 'finished',
    })

    expect(ledger.calls.map((call) => [call.task, call.tool, call.result])).toEqual([
      ['identity', 'peek_row', 'ok'],
      ['upkeep', 'append_note', 'rejected'],
    ])
    expect(await description()).toBe('A courier.')
  })

  it('counts a row a task created as read for that task, and for no later one', async () => {
    const noteTools = taskDef({
      tools: [createNoteTool, touchNoteTool],
      start: async () => ({ show: [], seeds: [] }),
    })
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([createCall('k1'), touchCall('k2')]))
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(okStep([touchCall('k3')]))
    const phase = phaseContext()

    await drive(noteTools, runContext(phase))
    await drive({ ...noteTools, task: 'upkeep' }, runContext(phase))

    expect(ledger.calls.map((call) => [call.task, call.tool, call.result])).toEqual([
      ['identity', 'create_note', 'ok'],
      ['identity', 'touch_note', 'ok'],
      ['upkeep', 'touch_note', 'rejected'],
    ])
    expect(ledger.calls[2]!.reason).toBe(
      "lo1 hasn't been read in this task: call read_row on it, then write it",
    )
  })

  const NOT_JSON: [string, unknown][] = [
    ['undefined', undefined],
    ['an array holding undefined', [1, undefined]],
    ['NaN', Number.NaN],
    ['an object holding Infinity', { at: Number.POSITIVE_INFINITY }],
    ['a Map', new Map([['a', 1]])],
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
    [
      'an absent property as JSON does, leaving it out',
      { name: 'Wren', keywords: undefined },
      { type: 'json', value: { name: 'Wren' } },
    ],
    [
      'a nested absent property, leaving it out',
      { name: 'Wren', state: { voice: undefined, face: 'scarred' } },
      { type: 'json', value: { name: 'Wren', state: { face: 'scarred' } } },
    ],
    [
      'an own __proto__ key as a key, as JSON.parse made it',
      JSON.parse('{"__proto__":{"x":1},"b":2}'),
      { type: 'json', value: JSON.parse('{"__proto__":{"x":1},"b":2}') },
    ],
  ])('sends a read answering %s', async (_, output, sent) => {
    echoOutput = output
    vi.mocked(generateToolStep).mockResolvedValueOnce(okStep([echoCall]))

    await drive(taskDef({ tools: [echoTool] }), runContext(phaseContext()))

    // Strict: toEqual reads an undefined property as absent, so it can't tell a key dropped.
    expect(sentMessages(1).at(-1)).toStrictEqual({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'k1', toolName: 'echo', output: sent }],
    })
  })
})

// `cuts: null` parks no parts, as a run whose metadata phase never ran.
function closePhaseContext(
  fixture: CloseFixture,
  opts: {
    actionId: string
    range: CloseRange
    cuts: readonly ChapterPartCut[] | null
    abortSignal?: AbortSignal
  },
): PhaseContext {
  const { actionId, range, cuts, abortSignal = new AbortController().signal } = opts
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, range)
  if (cuts !== null) setCloseParts(intermediates, cuts)
  return {
    actionId,
    abortSignal,
    intermediates,
    log: makeLogger(actionId),
    db: fixture.ctx.db,
    runInTransaction: fixture.ctx.runInTransaction,
    storyId: fixture.storyId,
    branchId: fixture.branchId,
  }
}

// Stands in for the orchestrator over a whole phase: each group lands in `fixture` and its outcome
// goes back, so a landed create counts toward a cap as it does in a close.
async function drainApplying(
  ctx: PhaseContext,
  fixture: CloseFixture,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  let reply: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(reply)
    if (next.done) return { events, result: next.value }
    const event = next.value
    events.push(event)
    reply =
      event.type === 'delta_group_emitted'
        ? await applyDeltaActionGroupWithOutcomes(
            event.actions,
            { actionId: ctx.actionId, branchId: ctx.branchId, entryId: event.entryId },
            fixture.ctx,
          )
        : undefined
  }
}

describe('closeAgentPhase', () => {
  const SCRIPTED_ERROR: PipelineError = { kind: 'orchestrator', detail: 'scripted task failure' }
  let fixture: CloseFixture
  let abort: AbortController

  beforeEach(async () => {
    vi.mocked(closeParts).mockReset()
    vi.mocked(runCloseTask).mockReset()
    vi.mocked(generateToolStep).mockClear()
    fixture = await openCloseFixture()
    abort = new AbortController()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    vi.mocked(closeParts).mockReset()
    vi.mocked(runCloseTask).mockReset()
    resetAllStores()
  })

  // The range below ends on the third reply: the opening and three turns, positions 1 to 7.
  const chapterIds = (): string[] => fixture.entries.slice(0, 7).map((entry) => entry.id)

  // One cut over the range, as the metadata phase stores a chapter that fits; the agent reads
  // only a cut's ids, so its tokens stay 0.
  const onePart = (): ChapterPartCut[] => [
    { part: 1, startEntryId: fixture.entries[0]!.id, endEntryId: fixture.replyIds[2]!, tokens: 0 },
  ]

  // Two cuts over the range: t1–t4 and t5–t7.
  const twoParts = (): ChapterPartCut[] => [
    { part: 1, startEntryId: chapterIds()[0]!, endEntryId: chapterIds()[3]!, tokens: 0 },
    { part: 2, startEntryId: chapterIds()[4]!, endEntryId: chapterIds()[6]!, tokens: 0 },
  ]

  function phaseCtx(cuts: readonly ChapterPartCut[] | null = onePart()): PhaseContext {
    return closePhaseContext(fixture, {
      actionId: 'act_slots',
      range: {
        chapterId: 'chap_slots',
        startEntryId: fixture.entries[0]!.id,
        endEntryId: fixture.replyIds[2]!,
      },
      cuts,
      abortSignal: abort.signal,
    })
  }

  // With a log, each close_task_start lands in it as it is yielded, among the tasks' own entries.
  async function drain(
    ctx: PhaseContext,
    log?: string[],
  ): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
    const gen = closeAgentPhase(ctx)
    const events: PhaseEmittedEvent[] = []
    for (;;) {
      const next = await gen.next(undefined)
      if (next.done) return { events, result: next.value }
      if (next.value.type === 'close_task_start') log?.push(`start:${next.value.task}`)
      events.push(next.value)
    }
  }

  const taskStarts = (events: readonly PhaseEmittedEvent[]) =>
    events.filter(
      (event): event is Extract<PhaseEmittedEvent, { type: 'close_task_start' }> =>
        event.type === 'close_task_start',
    )

  // Nothing to show: runCloseTask ends it with no step, so it must never render.
  function quietTask<T extends CloseTask>(
    task: T,
    log: string[],
    opts: { readFields?: ReadFields; seen?: (ctx: TaskPromptContext) => void } = {},
  ): SlotEntry<T> {
    return {
      kind: 'task',
      def: {
        task,
        tools: [],
        readFields: opts.readFields ?? {},
        start: async (ctx) => {
          log.push(`${task}@${ctx.part}`)
          opts.seen?.(ctx)
          return null
        },
        render: () => {
          throw new Error(`${task} rendered with nothing to show`)
        },
      },
    }
  }

  function codeStep(
    name: string,
    log: string[],
    end: (ctx: CodeStepContext) => PhaseResult = () => ({ status: 'completed' }),
  ): Extract<SlotEntry, { kind: 'code' }> {
    return {
      kind: 'code',
      step: {
        name,
        run: async function* (
          ctx,
        ): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
          log.push(`${name}@${ctx.part}`)
          return end(ctx)
        },
      },
    }
  }

  // The types keep a task out of a slot its run order has no place for; this reaches the guard.
  const misplaced = (slots: Record<SlotName, readonly SlotEntry[]>): CloseAgentSlots =>
    slots as CloseAgentSlots

  // The next runCloseTask call ends as given without running its task's start.
  function nextTaskEnds(end: TaskEnd): void {
    vi.mocked(runCloseTask).mockImplementationOnce(async function* (): AsyncGenerator<
      PhaseEmittedEvent,
      TaskEnd,
      GroupOutcome | undefined
    > {
      return end
    })
  }

  it('runs before once, perPart once per part and after once, in that order', async () => {
    const log: string[] = []
    const turnIds = chapterIds()
    const cuts = twoParts()
    __setCloseAgentSlots({
      before: [codeStep('normalize', log), quietTask('happenings', log)],
      perPart: [quietTask('lore', log), codeStep('between', log), quietTask('identity', log)],
      after: [quietTask('awareness', log), codeStep('reset', log)],
    })

    const { events, result } = await drain(phaseCtx(cuts), log)

    expect(result).toEqual({ status: 'completed' })
    expect(log).toEqual([
      'normalize@0',
      'start:happenings',
      'happenings@0',
      'start:lore',
      'lore@1',
      'between@1',
      'start:identity',
      'identity@1',
      'start:lore',
      'lore@2',
      'between@2',
      'start:identity',
      'identity@2',
      'start:awareness',
      'awareness@0',
      'reset@0',
    ])
    expect(taskStarts(events)).toEqual([
      { type: 'close_task_start', task: 'happenings', part: 0, index: 1, total: 12 },
      { type: 'close_task_start', task: 'lore', part: 1, index: 2, total: 12 },
      { type: 'close_task_start', task: 'identity', part: 1, index: 3, total: 12 },
      { type: 'close_task_start', task: 'lore', part: 2, index: 7, total: 12 },
      { type: 'close_task_start', task: 'identity', part: 2, index: 8, total: 12 },
      { type: 'close_task_start', task: 'awareness', part: 0, index: 12, total: 12 },
    ])
    expect(
      vi
        .mocked(closeParts)
        .mock.calls.map(([entries, passed]) => [entries.map((entry) => entry.id), passed]),
    ).toEqual([[turnIds, cuts]])
  })

  it('reads the one part the metadata phase stored, numbered 1, so Identity starts 3 of 7', async () => {
    const log: string[] = []
    __setCloseAgentSlots({ before: [], perPart: [quietTask('identity', log)], after: [] })

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual({ status: 'completed' })
    expect(log).toEqual(['identity@1'])
    expect(taskStarts(events)).toEqual([
      { type: 'close_task_start', task: 'identity', part: 1, index: 3, total: 7 },
    ])
    const [entries, cuts] = vi.mocked(closeParts).mock.calls[0]!
    expect(cuts).toEqual(onePart())
    expect(closeParts(entries, cuts)).toEqual([{ index: 1, entryIds: chapterIds() }])
  })

  it("hands a part's entries to each of its entries, and the chapter's to a chapter-wide one", async () => {
    const shown: string[][] = []
    const record = (c: { taskEntryIds: readonly string[] }): void => {
      shown.push([...c.taskEntryIds])
    }
    __setCloseAgentSlots({
      before: [quietTask('happenings', [], { seen: record })],
      perPart: [
        codeStep('between', [], (c) => {
          record(c)
          return { status: 'completed' }
        }),
        quietTask('lore', [], { seen: record }),
      ],
      after: [quietTask('awareness', [], { seen: record })],
    })
    const turnIds = chapterIds()

    await drain(phaseCtx(twoParts()))

    expect(shown).toEqual([
      turnIds,
      turnIds.slice(0, 4),
      turnIds.slice(0, 4),
      turnIds.slice(4),
      turnIds.slice(4),
      turnIds,
    ])
  })

  it('refuses parts that leave a range entry out, before any entry has run or been announced', async () => {
    const log: string[] = []
    __setCloseAgentSlots({
      before: [quietTask('happenings', log)],
      perPart: [quietTask('identity', log)],
      after: [],
    })
    const short: ChapterPartCut[] = [
      { part: 1, startEntryId: chapterIds()[0]!, endEntryId: chapterIds()[5]!, tokens: 0 },
    ]

    await expect(drain(phaseCtx(short), log)).rejects.toThrow(RangeError)
    expect(log).toEqual([])
  })

  it('starts a task with nothing to show and makes no step for it', async () => {
    const log: string[] = []
    __setCloseAgentSlots({ before: [quietTask('happenings', log)], perPart: [], after: [] })

    const { events } = await drain(phaseCtx())

    expect(log).toEqual(['happenings@0'])
    expect(taskStarts(events)).toEqual([
      { type: 'close_task_start', task: 'happenings', part: 0, index: 1, total: 7 },
    ])
    expect(generateToolStep).not.toHaveBeenCalled()
  })

  it("hands every entry the run's one id map and ledger, the chapter's turns shown first", async () => {
    const log: string[] = []
    const seen: TaskPromptContext[] = []
    const stepSeen: CodeStepContext[] = []
    let handlesAtFirstStart: (string | undefined)[] = []
    __setCloseAgentSlots({
      before: [
        quietTask('happenings', log, {
          seen: (c) => {
            handlesAtFirstStart = chapterIds().map((id) => c.ids.handleOf(id))
            seen.push(c)
          },
        }),
      ],
      perPart: [
        codeStep('between', log, (c) => {
          stepSeen.push(c)
          return { status: 'completed' }
        }),
      ],
      after: [quietTask('awareness', log, { seen: (c) => seen.push(c) })],
    })
    const ctx = phaseCtx()

    await drain(ctx)

    expect(handlesAtFirstStart).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect(seen).toHaveLength(2)
    expect(stepSeen).toHaveLength(1)
    const runIds = closeIdsOf(ctx.intermediates)
    // A code step records nothing, and a task's start makes no call: neither gets the writer.
    expect(stepSeen[0]).not.toHaveProperty('ledger')
    expect(seen[0]).not.toHaveProperty('ledger')
    const writers = vi.mocked(runCloseTask).mock.calls.map(([, args]) => args.ledger)
    expect(writers).toHaveLength(2)
    expect(writers[1]).toBe(writers[0])
    const runWriter = writers[0]!
    for (const c of [...seen, ...stepSeen]) {
      expect(c.ids).toBe(runIds)
      expect(c.phase).toBe(ctx)
      expect(c.db).toBe(fixture.ctx.db)
      expect(c.branchId).toBe(fixture.branchId)
      expect(c.endEntryId).toBe(fixture.replyIds[2])
      expect(c.taskEntryIds).toEqual(chapterIds())
    }
    // The writer wraps the run's own ledger, and every entry's survivorOf reads it.
    runWriter.noteToolCall()
    expect(closeLedgerOf(ctx.intermediates)?.noToolCalls).toBe(false)
    runWriter.record({
      task: 'happenings',
      part: 0,
      tool: 'merge_happenings',
      rows: [
        { table: 'happenings', id: 'hap_absorbed', name: 'The crossing' },
        { table: 'happenings', id: 'hap_kept', name: 'The night crossing' },
      ],
      why: 'One crossing, told twice.',
      turns: [],
      result: 'ok',
      survivor: { table: 'happenings', id: 'hap_kept' },
    })
    // It names a ref by the run's id map: a value holding a shown row's id is stored as its name.
    runIds.show(WREN, 'Wren')
    runWriter.record({
      task: 'happenings',
      part: 0,
      tool: 'update_happening',
      rows: [],
      why: 'Wren was there.',
      turns: [],
      result: 'ok',
      values: { 'state.involved': WREN },
    })
    expect(closeLedgerOf(ctx.intermediates)?.calls.at(-1)?.values).toEqual({
      'state.involved': 'Wren',
    })
    expect(seen[1]!.survivorOf('happenings', 'hap_absorbed')).toEqual({
      table: 'happenings',
      id: 'hap_kept',
    })
    // Every entry counts the same ledger's landed calls, across tasks: a chapter-wide cap's count.
    expect(seen[1]!.landedCalls({ name: 'merge_happenings' })).toBe(1)
    expect(seen[0]!.landedCalls({ name: 'update_happening' })).toBe(1)
    expect(stepSeen[0]!.landedCalls({ name: 'merge_happenings' })).toBe(1)
    expect(seen[1]!.landedCalls({ name: 'create_lore' })).toBe(0)
  })

  it("hands a task a ledger that logs a report value under the run's actionId", async () => {
    __setCloseAgentSlots({ before: [quietTask('happenings', [])], perPart: [], after: [] })
    await drain(phaseCtx())
    const { ledger } = vi.mocked(runCloseTask).mock.calls[0]![1]
    const debug = vi.spyOn(logger, 'debug')
    onTestFinished(() => debug.mockRestore())

    ledger.record({
      task: 'happenings',
      part: 0,
      tool: 'update_happening',
      rows: [],
      why: '',
      turns: [],
      result: 'ok',
      values: { description: 'The ferry runs late.' },
    })

    expect(debug).toHaveBeenCalledWith(
      'memory.close_report_value',
      { tool: 'update_happening', path: 'description', length: 20 },
      { actionId: 'act_slots' },
    )
  })

  it("gives a task's start its part and the lore-mgmt model config", async () => {
    let captured: TaskPromptContext | undefined
    __setCloseAgentSlots({
      before: [],
      perPart: [
        quietTask('identity', [], {
          seen: (c) => {
            captured = c
          },
        }),
      ],
      after: [],
    })

    await drain(phaseCtx())

    const settings = appSettingsStore.getAppSettings()
    expect(captured).toMatchObject({ part: 1 })
    expect(captured!.config).toEqual({
      providers: settings.providers,
      profiles: settings.profiles,
      assignments: settings.assignments,
      storyModels: currentStoryStore.getCurrentStory()!.settings.models,
    })
  })

  it.each<TaskEnd>([
    { status: 'finished' },
    { status: 'stopped', reason: 'budget' },
    { status: 'stopped', reason: 'window' },
    { status: 'stopped', reason: 'cut-off' },
  ])('goes on past a task that ends %o', async (end) => {
    const log: string[] = []
    nextTaskEnds(end)
    __setCloseAgentSlots({
      before: [quietTask('happenings', log)],
      perPart: [quietTask('identity', log)],
      after: [],
    })

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual({ status: 'completed' })
    expect(log).toEqual(['identity@1'])
    expect(taskStarts(events).map((start) => start.task)).toEqual(['happenings', 'identity'])
  })

  it.each<[TaskEnd, PhaseResult]>([
    [
      { status: 'failed', error: SCRIPTED_ERROR },
      { status: 'failed', error: SCRIPTED_ERROR },
    ],
    [{ status: 'aborted' }, { status: 'aborted' }],
  ])('ends the phase on a task that ends %o, starting nothing after it', async (end, expected) => {
    const log: string[] = []
    nextTaskEnds(end)
    __setCloseAgentSlots({
      before: [quietTask('happenings', log)],
      perPart: [quietTask('identity', log)],
      after: [],
    })

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual(expected)
    expect(log).toEqual([])
    expect(taskStarts(events).map((start) => start.task)).toEqual(['happenings'])
  })

  it.each<PhaseResult>([{ status: 'failed', error: SCRIPTED_ERROR }, { status: 'aborted' }])(
    'ends the phase on a code step that ends %o',
    async (stop) => {
      const log: string[] = []
      __setCloseAgentSlots({
        before: [codeStep('normalize', log, () => stop), quietTask('happenings', log)],
        perPart: [],
        after: [],
      })

      const { events, result } = await drain(phaseCtx())

      expect(result).toEqual(stop)
      expect(log).toEqual(['normalize@0'])
      expect(taskStarts(events)).toEqual([])
    },
  )

  it('polls the abort before each entry', async () => {
    const log: string[] = []
    __setCloseAgentSlots({
      before: [
        codeStep('normalize', log, () => {
          abort.abort()
          return { status: 'completed' }
        }),
      ],
      perPart: [quietTask('identity', log)],
      after: [],
    })

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual({ status: 'aborted' })
    expect(log).toEqual(['normalize@0'])
    expect(taskStarts(events)).toEqual([])
  })

  it('polls the abort before a code step', async () => {
    const log: string[] = []
    __setCloseAgentSlots({
      before: [
        codeStep('normalize', log, () => {
          abort.abort()
          return { status: 'completed' }
        }),
        codeStep('reset', log),
      ],
      perPart: [],
      after: [],
    })

    const { result } = await drain(phaseCtx())

    expect(result).toEqual({ status: 'aborted' })
    expect(log).toEqual(['normalize@0'])
  })

  it.each([
    ['Happenings in after', { before: [], perPart: [], after: [['happenings']] }],
    ['Awareness in before', { before: [['awareness']], perPart: [], after: [] }],
    ['a part task in before', { before: [['identity']], perPart: [], after: [] }],
    ['a chapter-wide task in perPart', { before: [], perPart: [['happenings']], after: [] }],
  ] as const)('refuses %s', async (_, shape) => {
    const log: string[] = []
    const slot = (names: readonly (readonly [CloseTask])[]): SlotEntry[] =>
      names.map(([task]) => quietTask(task, log))
    __setCloseAgentSlots(
      misplaced({
        before: slot(shape.before),
        perPart: slot(shape.perPart),
        after: slot(shape.after),
      }),
    )

    await expect(drain(phaseCtx(), log)).rejects.toThrow(RangeError)
    expect(log).toEqual([])
  })

  it('refuses a misplaced task before any valid one has run or been announced', async () => {
    const log: string[] = []
    __setCloseAgentSlots(
      misplaced({
        before: [quietTask('happenings', log)],
        perPart: [quietTask('identity', log)],
        after: [quietTask('happenings', log)],
      }),
    )

    await expect(drain(phaseCtx(), log)).rejects.toThrow(RangeError)
    expect(log).toEqual([])
    expect(generateToolStep).not.toHaveBeenCalled()
  })

  // A slot's types hold no order, so the banner's N of M could go backwards or repeat.
  it.each([
    ['a part task ahead of one canon runs first', ['threads', 'identity']],
    ['a part task twice', ['lore', 'lore']],
  ] as const)('refuses %s, before any entry has run or been announced', async (_, tasks) => {
    const log: string[] = []
    __setCloseAgentSlots({
      before: [quietTask('happenings', log)],
      perPart: tasks.map((task) => quietTask(task, log)),
      after: [],
    })

    await expect(drain(phaseCtx(), log)).rejects.toThrow(RangeError)
    expect(log).toEqual([])
  })

  it('with the production slots, runs normalization, the range embed and Happenings, the prose tasks per part, then Awareness and the reset', () => {
    __setCloseAgentSlots({ before: [], perPart: [quietTask('identity', [])], after: [] })
    __setCloseAgentSlots(undefined)
    expect(closeAgentSlots()).toBe(PRODUCTION_CLOSE_SLOTS)
    const named = (entries: readonly SlotEntry[]): string[] =>
      entries.map((entry) => (entry.kind === 'task' ? entry.def.task : entry.step.name))
    expect(named(PRODUCTION_CLOSE_SLOTS.before)).toEqual([
      'stackables',
      'happenings-embed',
      'happenings',
    ])
    expect(named(PRODUCTION_CLOSE_SLOTS.perPart)).toEqual([
      'lore',
      'identity',
      'threads',
      'upkeep',
      'lifecycle',
    ])
    expect(named(PRODUCTION_CLOSE_SLOTS.after)).toEqual(['awareness', 'retrieval-reset'])
  })

  it('with no task in any slot, starts nothing and reads no store and no parts, the ledger seeded', async () => {
    __setCloseAgentSlots(NO_CLOSE_TASKS)
    expect(NO_CLOSE_TASKS).toEqual({ before: [], perPart: [], after: [] })
    // A phase that read the stores here would fail: nothing holds the branch.
    resetAllStores()
    const ctx = phaseCtx(null)

    const { events, result } = await drain(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    expect(closeLedgerOf(ctx.intermediates)).toEqual({ calls: [], stopped: [], noToolCalls: true })
  })

  // Control for the case above: the production slots do read the stores.
  it('with the production slots and no story open, fails before any task', async () => {
    __setCloseAgentSlots(undefined)
    resetAllStores()

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    })
    expect(events).toEqual([])
  })

  it.each([
    { name: 'no story is open', unload: () => resetAllStores() },
    { name: 'the stores hold another branch', unload: () => entitiesStore.hydrate('b2', []) },
  ])('fails as the metadata call does when $name, before any entry', async ({ unload }) => {
    const log: string[] = []
    __setCloseAgentSlots({ before: [quietTask('happenings', log)], perPart: [], after: [] })
    unload()

    const { events, result } = await drain(phaseCtx())

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: branch not loaded' },
    })
    expect(log).toEqual([])
    expect(events).toEqual([])
  })

  it('fails as the other close phases do without a range', async () => {
    __setCloseAgentSlots({ before: [quietTask('happenings', [])], perPart: [], after: [] })

    const { result } = await drain({ ...phaseCtx(), intermediates: {} })

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close range' },
    })
  })

  it('fails as it does without a range when no parts were stored, before any entry', async () => {
    const log: string[] = []
    __setCloseAgentSlots({ before: [quietTask('happenings', log)], perPart: [], after: [] })

    const { events, result } = await drain(phaseCtx(null))

    expect(result).toEqual({
      status: 'failed',
      error: { kind: 'orchestrator', detail: 'chapter-close: no close parts' },
    })
    expect(events).toEqual([])
    expect(log).toEqual([])
  })
})

describe('closeAgentPhase over three parts', () => {
  const TOBIN = 'char_00000000-0000-4000-8000-000000000002'
  const LETTER = 'thr_00000000-0000-4000-8000-000000000003'

  beforeEach(async () => {
    beforePlan = undefined
    vi.mocked(generateToolStep).mockClear()
    // Eight turns: the opening through the eighth reply, t1 to t17.
    f = await openCloseFixture({ turns: 8 })
    await seedWren()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
  })

  // Identity and Threads, slotted by hand: the production slots grow, these cases don't.
  const IDENTITY_AND_THREADS: CloseAgentSlots = {
    before: [],
    perPart: [
      { kind: 'task', def: identityTask },
      { kind: 'task', def: threadsTask },
    ],
    after: [],
  }

  // Three parts: t1–t5, t6–t12 and t13–t17.
  function partsCtx(): PhaseContext {
    return closePhaseContext(f, {
      actionId: ACTION_ID,
      range: {
        chapterId: 'chap_parts',
        startEntryId: f.entries[0]!.id,
        endEntryId: f.entries[16]!.id,
      },
      cuts: [
        { part: 1, startEntryId: f.entries[0]!.id, endEntryId: f.entries[4]!.id, tokens: 0 },
        { part: 2, startEntryId: f.entries[5]!.id, endEntryId: f.entries[11]!.id, tokens: 0 },
        { part: 3, startEntryId: f.entries[12]!.id, endEntryId: f.entries[16]!.id, tokens: 0 },
      ],
    })
  }

  const sentPrompt = (call: number) => vi.mocked(generateToolStep).mock.calls[call]![1].prompt

  const citing = (toolCallId: string, note: string, turn: string): ToolStepCall => ({
    toolCallId,
    toolName: 'append_note',
    input: { id: 'c1', note, turns: [turn], why: 'The crossing shows it.' },
  })

  // A per-part task over append_note and peek_row, Wren shown as c1: its system half lists the
  // turns it was shown, its user half the writes so far.
  function partTask(opts: { seeded: boolean }): SlotEntry<'identity'> {
    const def: CloseTaskDef<string[]> & { task: 'identity' } = {
      task: 'identity',
      tools: [appendNoteTool, peekRowTool],
      readFields: { character: ['description'] },
      start: async (ctx) => {
        ctx.ids.show(WREN, 'Wren')
        const { closeTurns } = await readTaskTurns(ctx)
        return {
          show: closeTurns.map((turn) => turn.handle),
          seeds: opts.seeded ? [{ table: 'entities', id: WREN }] : [],
        }
      },
      render: ({ show }, ctx) => ({
        system: `Turns: ${show.join(', ')}`,
        user: `Identity.\n${ctx.writesSoFar}`,
      }),
    }
    return { kind: 'task', def }
  }

  async function putCharacter(id: string, name: string): Promise<void> {
    await f.ctx.db.insert(entities).values({
      id,
      branchId: f.branchId,
      kind: 'character',
      name,
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
  }

  async function setScene(entryId: string, sceneIds: readonly string[]): Promise<void> {
    const where = and(eq(storyEntries.branchId, f.branchId), eq(storyEntries.id, entryId))
    const [row] = await f.ctx.db
      .select({ metadata: storyEntries.metadata })
      .from(storyEntries)
      .where(where)
    if (!row?.metadata) throw new Error(`setScene: entry ${entryId} has no metadata`)
    await f.ctx.db
      .update(storyEntries)
      .set({ metadata: { ...row.metadata, sceneEntities: [...sceneIds] } })
      .where(where)
  }

  async function putThread(id: string, title: string): Promise<void> {
    await f.ctx.db.insert(threads).values({
      id,
      branchId: f.branchId,
      title,
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
  }

  // C6: 2 + 5 × 3. Only Identity and Threads are slotted, so the other places (2, 5, 6, …) start
  // nothing.
  it('counts 17 tasks over three parts, Identity and Threads in part order', async () => {
    __setCloseAgentSlots(IDENTITY_AND_THREADS)

    const { events, result } = await drainApplying(partsCtx(), f)

    expect(result).toEqual({ status: 'completed' })
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([
      { type: 'close_task_start', task: 'identity', part: 1, index: 3, total: 17 },
      { type: 'close_task_start', task: 'threads', part: 1, index: 4, total: 17 },
      { type: 'close_task_start', task: 'identity', part: 2, index: 8, total: 17 },
      { type: 'close_task_start', task: 'threads', part: 2, index: 9, total: 17 },
      { type: 'close_task_start', task: 'identity', part: 3, index: 13, total: 17 },
      { type: 'close_task_start', task: 'threads', part: 3, index: 14, total: 17 },
    ])
    expect(generateToolStep).not.toHaveBeenCalled()
  })

  it("records each write under its part, and lists part 1's writes in part 2's prompt", async () => {
    __setCloseAgentSlots({ before: [], perPart: [partTask({ seeded: true })], after: [] })
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([citing('k1', 'first', 't3')]))
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(okStep([citing('k2', 'second', 't8')]))
    const ctx = partsCtx()

    const { result } = await drainApplying(ctx, f)

    expect(result).toEqual({ status: 'completed' })
    expect(await description()).toBe('A courier. first second')
    expect(
      closeLedgerOf(ctx.intermediates)?.calls.map((call) => [call.tool, call.part, call.result]),
    ).toEqual([
      ['append_note', 1, 'ok'],
      ['append_note', 2, 'ok'],
    ])
    // Steps: part 1's two, part 2's two, part 3's one.
    expect(generateToolStep).toHaveBeenCalledTimes(5)
    expect(sentPrompt(0).user).toBe('Identity.\n')
    expect(sentPrompt(2).user).toBe('Identity.\n- append_note Wren (c1): description')
  })

  it("shows each part its own turns under the chapter's handles, one map for every part", async () => {
    __setCloseAgentSlots({ before: [], perPart: [partTask({ seeded: true })], after: [] })
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(okStep([citing('k1', 'twelfth', 't12')]))
    const ctx = partsCtx()

    await drainApplying(ctx, f)

    // Steps: part 1's one, part 2's two, part 3's one.
    expect(sentPrompt(0).system).toBe('Turns: t1, t2, t3, t4, t5')
    expect(sentPrompt(1).system).toBe('Turns: t6, t7, t8, t9, t10, t11, t12')
    expect(sentPrompt(3).system).toBe('Turns: t13, t14, t15, t16, t17')
    expect(closeIdsOf(ctx.intermediates).idOf('t12')).toBe(f.entries[11]!.id)
    expect(closeLedgerOf(ctx.intermediates)?.calls).toMatchObject([
      { part: 2, result: 'ok', turns: [f.entries[11]!.id] },
    ])
  })

  it('leaves a row read in part 1 unread in part 2, so a write to it there is refused', async () => {
    __setCloseAgentSlots({ before: [], perPart: [partTask({ seeded: false })], after: [] })
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([peekCall('k1'), citing('k2', 'first', 't3')]))
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(okStep([citing('k3', 'second', 't8')]))
    const ctx = partsCtx()

    await drainApplying(ctx, f)

    expect(await description()).toBe('A courier. first')
    const calls = closeLedgerOf(ctx.intermediates)?.calls ?? []
    expect(calls.map((call) => [call.tool, call.part, call.result])).toEqual([
      ['peek_row', 1, 'ok'],
      ['append_note', 1, 'ok'],
      ['append_note', 2, 'rejected'],
    ])
    expect(calls[2]?.reason).toMatch(/^c1 hasn't been read in this task/)
  })

  it('refuses a part-2 write citing a turn only part 1 was shown', async () => {
    __setCloseAgentSlots({ before: [], perPart: [partTask({ seeded: true })], after: [] })
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(okStep([citing('k1', 'late', 't3')]))
    const ctx = partsCtx()

    await drainApplying(ctx, f)

    expect(await description()).toBe('A courier.')
    expect(closeLedgerOf(ctx.intermediates)?.calls).toEqual([
      expect.objectContaining({
        tool: 'append_note',
        part: 2,
        result: 'rejected',
        turns: [],
        reason: 't3 is not one of the turns this task was shown: cite only those turns',
      }),
    ])
  })

  it("starts Identity in part 2 from part 2's scene characters only", async () => {
    __setCloseAgentSlots(IDENTITY_AND_THREADS)
    await putCharacter(TOBIN, 'Tobin')
    await setScene(f.entries[2]!.id, [WREN])
    await setScene(f.entries[7]!.id, [TOBIN])

    await drainApplying(partsCtx(), f)

    // Identity in parts 1 and 2; nobody is in part 3's scene, and no thread is open.
    expect(generateToolStep).toHaveBeenCalledTimes(2)
    expect(sentPrompt(0).user).toContain('## c1: Wren')
    expect(sentPrompt(0).user).not.toContain('Tobin')
    expect(sentPrompt(1).user).toContain('## c2: Tobin')
    expect(sentPrompt(1).user).not.toContain('Wren')
  })

  it('renders one system half for Identity and Threads in a part, and another in the next', async () => {
    __setCloseAgentSlots(IDENTITY_AND_THREADS)
    await putCharacter(TOBIN, 'Tobin')
    await setScene(f.entries[2]!.id, [WREN])
    await setScene(f.entries[7]!.id, [TOBIN])
    await putThread(LETTER, 'Deliver the letter')

    await drainApplying(partsCtx(), f)

    // Identity then Threads in parts 1 and 2; Threads alone in part 3.
    const systems = vi
      .mocked(generateToolStep)
      .mock.calls.map(([, request]) => request.prompt.system)
    expect(systems).toHaveLength(5)
    expect(systems[1]).toBe(systems[0])
    expect(systems[3]).toBe(systems[2])
    expect(systems[2]).not.toBe(systems[0])
    expect(systems[4]).not.toBe(systems[3])
    expect(systems[0]).toContain('## t5 (')
    expect(systems[0]).not.toContain('## t6 (')
    expect(systems[2]).toContain('## t6 (')
    expect(systems[2]).toContain('## t12 (')
    expect(systems[2]).not.toContain('## t5 (')
    expect(systems[2]).not.toContain('## t13 (')
  })
})

describe('closeAgentPhase over parts, with the real tasks', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
  })

  // The opening to the third reply (positions 1-7, t1-t7), cut at range indexes, first to last.
  function partsPhase(bounds: readonly (readonly [number, number])[]): PhaseContext {
    const range = fx.entries.slice(0, 7)
    return closePhaseContext(fx, {
      actionId: 'act_parts',
      range: { chapterId: 'chap_parts', startEntryId: range[0]!.id, endEntryId: range[6]!.id },
      // The agent loop reads a cut's ids; its token count is the metadata phase's.
      cuts: bounds.map(([first, last], index) => ({
        part: index + 1,
        startEntryId: range[first]!.id,
        endEntryId: range[last]!.id,
        tokens: 0,
      })),
    })
  }

  const createLore = (
    toolCallId: string,
    title: string,
    body: string,
    turn: string,
  ): ToolStepCall => ({
    toolCallId,
    toolName: 'create_lore',
    input: { title, body, turns: [turn], why: 'The innkeeper and the ferryman name it.' },
  })

  it('holds the lore cap across parts: a refused create spends none, three land, part 2 is refused', async () => {
    __setCloseAgentSlots({ before: [], perPart: [{ kind: 'task', def: loreTask }], after: [] })
    // Part 1 is t1-t4, part 2 t5-t7: each create cites its own part's turn, so k1 is refused for
    // its blank body and the part 2 create only by the cap.
    vi.mocked(generateToolStep)
      .mockResolvedValueOnce(
        okStep([
          createLore('k1', 'The empty toll', '   ', 't4'),
          createLore(
            'k2',
            'The ferry toll',
            'A courier pays twice the boat to cross at night.',
            't4',
          ),
          createLore('k3', 'The Harrow landing', 'A black line of planks over black water.', 't4'),
          createLore(
            'k4',
            'The Harrow inn',
            'Warm and loud with drovers; the innkeeper watches the road.',
            't3',
          ),
        ]),
      )
      .mockResolvedValueOnce(okStep([]))
      .mockResolvedValueOnce(
        okStep([
          createLore('k5', 'The night crossing', 'Tobin poles wide of the usual landing.', 't7'),
        ]),
      )
    const ctx = partsPhase([
      [0, 3],
      [4, 6],
    ])

    const { result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    const { calls } = closeLedgerOf(ctx.intermediates)!
    expect(calls.map((call) => [call.part, call.tool, call.result])).toEqual([
      [1, 'create_lore', 'rejected'],
      [1, 'create_lore', 'ok'],
      [1, 'create_lore', 'ok'],
      [1, 'create_lore', 'ok'],
      [2, 'create_lore', 'rejected'],
    ])
    const capped = calls[4]!
    expect(capped.reason).toBe('lore-cap')
    expect(capped.turns).toEqual([fx.entries[6]!.id])
    expect(capped.rows).toEqual([
      { table: 'lore', id: expect.stringMatching(/^lore_/), name: 'The night crossing' },
    ])
    const stored = await fx.ctx.db
      .select({ id: lore.id, title: lore.title })
      .from(lore)
      .where(eq(lore.branchId, fx.branchId))
    expect(stored.map(({ title }) => title).sort()).toEqual([
      'The Harrow inn',
      'The Harrow landing',
      'The ferry toll',
    ])
    // The refused create keeps its minted id, which names no row.
    expect(stored.map(({ id }) => id)).not.toContain(capped.rows[0]!.id)
  })

  it('starts Happenings, the five prose tasks in each of three parts, then Awareness: 17 of 17, in run order', async () => {
    __setCloseAgentSlots(undefined)
    const ctx = partsPhase([
      [0, 2],
      [3, 4],
      [5, 6],
    ])

    const { events, result } = await drainApplying(ctx, fx)

    expect(result).toEqual({ status: 'completed' })
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([
      { type: 'close_task_start', task: 'happenings', part: 0, index: 1, total: 17 },
      { type: 'close_task_start', task: 'lore', part: 1, index: 2, total: 17 },
      { type: 'close_task_start', task: 'identity', part: 1, index: 3, total: 17 },
      { type: 'close_task_start', task: 'threads', part: 1, index: 4, total: 17 },
      { type: 'close_task_start', task: 'upkeep', part: 1, index: 5, total: 17 },
      { type: 'close_task_start', task: 'lifecycle', part: 1, index: 6, total: 17 },
      { type: 'close_task_start', task: 'lore', part: 2, index: 7, total: 17 },
      { type: 'close_task_start', task: 'identity', part: 2, index: 8, total: 17 },
      { type: 'close_task_start', task: 'threads', part: 2, index: 9, total: 17 },
      { type: 'close_task_start', task: 'upkeep', part: 2, index: 10, total: 17 },
      { type: 'close_task_start', task: 'lifecycle', part: 2, index: 11, total: 17 },
      { type: 'close_task_start', task: 'lore', part: 3, index: 12, total: 17 },
      { type: 'close_task_start', task: 'identity', part: 3, index: 13, total: 17 },
      { type: 'close_task_start', task: 'threads', part: 3, index: 14, total: 17 },
      { type: 'close_task_start', task: 'upkeep', part: 3, index: 15, total: 17 },
      { type: 'close_task_start', task: 'lifecycle', part: 3, index: 16, total: 17 },
      { type: 'close_task_start', task: 'awareness', part: 0, index: 17, total: 17 },
    ])
    // The fixture holds no row: only Lore, which starts from the prose, makes a step, once a part.
    expect(
      vi.mocked(generateToolStep).mock.calls.map(([, request]) => Object.keys(request.tools)),
    ).toEqual([
      ['read_row', 'create_lore', 'update_lore'],
      ['read_row', 'create_lore', 'update_lore'],
      ['read_row', 'create_lore', 'update_lore'],
    ])
  })
})

describe('closeAgentPhase with the production slots: the chapter-wide entries', () => {
  const CROSSING = 'hap_00000000-0000-4000-8000-00000000c002'
  const TOLL_TALK = 'hap_00000000-0000-4000-8000-00000000c003'
  const DIM = 4
  const EMBED_MODEL = 'driver-range-embed'
  let fx: CloseFixture
  let timeline: string[]

  // Every happening the range embed embeds lies on one axis, so two with a shared cast and close
  // anchors cluster.
  const scriptedEmbedDeps = (): CloseEmbedDeps => ({
    queryAll: queryAllOn(fx.ctx.db),
    modelId: EMBED_MODEL,
    dim: DIM,
    revalidateRows: async (rows) => ({ staleRows: rows, freshOps: [] }),
    embedRows: async (rows) => {
      timeline.push('embed')
      return rows.flatMap((row) => [
        ...upsertVecOps(
          {
            kind: row.kind,
            id: row.id,
            branchId: row.branchId,
            modelId: EMBED_MODEL,
            dim: DIM,
            sourceHash: sourceHash(row.fields.join('\n')),
            vector: packFloat32(Float32Array.from([1, 0, 0, 0])),
          },
          { fields: row.fields },
        ),
        clearEmbeddingStaleOp(row),
      ])
    },
  })

  beforeEach(async () => {
    __setCloseAgentSlots(undefined)
    timeline = []
    fx = await openCloseFixture()
    __setCloseEmbedDepsForTest(scriptedEmbedDeps())
    // Only the chapter-wide tasks' calls join the timeline; the prose tasks' don't depend on it.
    vi.mocked(generateToolStep).mockImplementation(async (_target, request) => {
      const tools = Object.keys(request.tools)
      if (tools.includes('merge_happenings')) timeline.push('call:happenings')
      if (tools.includes('set_pin')) timeline.push('call:awareness')
      return okStep([])
    })
  })

  afterEach(() => {
    __setCloseEmbedDepsForTest(undefined)
    __setCloseAgentSlots(undefined)
  })

  async function apply(action: PipelineAction): Promise<void> {
    const result = await applyDeltaAction(
      { action, actionId: 'act_seed_world', branchId: fx.branchId, entryId: null },
      fx.ctx,
    )
    if (result.status !== 'ok') throw new Error(`seeding ${action.kind} refused: ${result.reason}`)
  }

  // Wren holds Gold and gold; two happenings of the range she was in, anchored at t3 and t5; her
  // awareness of the first, learned at t5 and retrieved three times since the last close.
  async function seedChapterWide(): Promise<void> {
    await apply({
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: WREN,
          branchId: fx.branchId,
          kind: 'character',
          name: 'Wren',
          description: 'A courier.',
          status: 'active',
          injectionMode: 'auto',
          state: { ...emptyEntityState('character'), stackables: { Gold: 5, gold: 3 } },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
    for (const [id, title, at] of [
      [CROSSING, 'The night crossing', 2],
      [TOLL_TALK, 'Talk of the toll', 4],
    ] as const) {
      await apply({
        kind: 'createHappening',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id,
            branchId: fx.branchId,
            title,
            occurredAtEntryId: fx.entries[at]!.id,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      })
      await apply({
        kind: 'createHappeningInvolvement',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: generateId('hinv'),
            branchId: fx.branchId,
            happeningId: id,
            entityId: WREN,
            role: null,
          },
        },
      })
    }
    await apply({
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: {
        branchId: fx.branchId,
        characterId: WREN,
        happeningId: CROSSING,
        learnedAtEntryId: fx.entries[4]!.id,
        decayResistance: 0.4,
        source: 'rode it',
        proseEntryId: null,
      },
    })
    await fx.ctx.db
      .update(happeningAwareness)
      .set({ retrievalCount: 3 })
      .where(eq(happeningAwareness.branchId, fx.branchId))
    for (const ddl of ensureVecTablesSql(DIM)) await fx.ctx.db.run(sql.raw(ddl))
  }

  // The opening to the third reply, t1–t7, cut at range indexes.
  function phaseOver(bounds: readonly (readonly [number, number])[]): PhaseContext {
    const range = fx.entries.slice(0, 7)
    return closePhaseContext(fx, {
      actionId: 'act_chapter_wide',
      range: {
        chapterId: 'chap_chapter_wide',
        startEntryId: range[0]!.id,
        endEntryId: range[6]!.id,
      },
      cuts: bounds.map(([first, last], index) => ({
        part: index + 1,
        startEntryId: range[first]!.id,
        endEntryId: range[last]!.id,
        tokens: 0,
      })),
    })
  }

  // As drainApplying, logging each task start and each group's kinds as the phase yields them,
  // among the embed's and the chapter-wide tasks' own entries.
  async function drainTimeline(
    ctx: PhaseContext,
  ): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
    const gen = closeAgentPhase(ctx)
    const events: PhaseEmittedEvent[] = []
    let reply: GroupOutcome | undefined
    for (;;) {
      const next = await gen.next(reply)
      if (next.done) return { events, result: next.value }
      const event = next.value
      events.push(event)
      reply = undefined
      if (event.type === 'close_task_start') timeline.push(`start:${event.task}@${event.part}`)
      if (event.type === 'delta_group_emitted') {
        timeline.push(`group:${[...new Set(event.actions.map(({ kind }) => kind))].join(',')}`)
        reply = await applyDeltaActionGroupWithOutcomes(
          event.actions,
          { actionId: ctx.actionId, branchId: ctx.branchId, entryId: event.entryId },
          fx.ctx,
        )
      }
    }
  }

  async function wrenStackables(): Promise<unknown> {
    const [row] = await fx.ctx.db
      .select({ state: entities.state })
      .from(entities)
      .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, WREN)))
    return (row?.state as { stackables?: unknown } | undefined)?.stackables
  }

  async function counts(): Promise<number[]> {
    const rows = await fx.ctx.db
      .select({ count: happeningAwareness.retrievalCount })
      .from(happeningAwareness)
      .where(eq(happeningAwareness.branchId, fx.branchId))
    return rows.map(({ count }) => count)
  }

  it('runs normalization, the range embed, Happenings, the prose tasks, Awareness and the reset, in that order', async () => {
    await seedChapterWide()

    const { events, result } = await drainTimeline(phaseOver([[0, 6]]))

    expect(result).toEqual({ status: 'completed' })
    expect(timeline).toEqual([
      'group:updateEntityStackables',
      'embed',
      'start:happenings@0',
      'call:happenings',
      'start:lore@1',
      'start:identity@1',
      'start:threads@1',
      'start:upkeep@1',
      'start:lifecycle@1',
      'start:awareness@0',
      'call:awareness',
      'group:resetAwarenessRetrieval',
    ])
    const starts = events.filter((event) => event.type === 'close_task_start')
    expect(starts[0]).toEqual({
      type: 'close_task_start',
      task: 'happenings',
      part: 0,
      index: 1,
      total: 7,
    })
    expect(starts.at(-1)).toEqual({
      type: 'close_task_start',
      task: 'awareness',
      part: 0,
      index: 7,
      total: 7,
    })
    // Both code steps' groups landed through the stand-in orchestrator.
    expect(await wrenStackables()).toEqual({ gold: 8 })
    expect(await counts()).toEqual([0])
  })

  it('runs neither chapter-wide task twice in a chapter of two parts', async () => {
    await seedChapterWide()

    const { result } = await drainTimeline(
      phaseOver([
        [0, 3],
        [4, 6],
      ]),
    )

    expect(result).toEqual({ status: 'completed' })
    expect(timeline).toEqual([
      'group:updateEntityStackables',
      'embed',
      'start:happenings@0',
      'call:happenings',
      'start:lore@1',
      'start:identity@1',
      'start:threads@1',
      'start:upkeep@1',
      'start:lifecycle@1',
      'start:lore@2',
      'start:identity@2',
      'start:threads@2',
      'start:upkeep@2',
      'start:lifecycle@2',
      'start:awareness@0',
      'call:awareness',
      'group:resetAwarenessRetrieval',
    ])
  })

  it('starts Happenings and Awareness with no cluster and no awareness row, and calls neither', async () => {
    const { events, result } = await drainTimeline(phaseOver([[0, 6]]))

    expect(result).toEqual({ status: 'completed' })
    expect(timeline).toEqual([
      'start:happenings@0',
      'start:lore@1',
      'start:identity@1',
      'start:threads@1',
      'start:upkeep@1',
      'start:lifecycle@1',
      'start:awareness@0',
    ])
    expect(events.filter((event) => event.type === 'delta_group_emitted')).toEqual([])
  })

  it("records both chapter-wide tasks' calls and stopped rows at part 0, and no code step", async () => {
    await seedChapterWide()
    let happeningsSteps = 0
    let awarenessSteps = 0
    vi.mocked(generateToolStep).mockImplementation(async (_target, request) => {
      const tools = Object.keys(request.tools)
      if (tools.includes('merge_happenings')) {
        happeningsSteps += 1
        return happeningsSteps === 1
          ? okStep([{ toolCallId: 'h1', toolName: 'read_turns', input: { turns: ['t3'] } }])
          : okStep([])
      }
      if (tools.includes('set_pin')) {
        awarenessSteps += 1
        return awarenessSteps === 1
          ? okStep([
              {
                toolCallId: 'a1',
                toolName: 'set_pin',
                input: {
                  id: 'aw1',
                  value: 0.9,
                  turns: ['t5'],
                  why: 'Wren rides the crossing again.',
                },
              },
            ])
          : okStep([
              {
                toolCallId: `a${awarenessSteps}`,
                toolName: 'read_turns',
                input: { turns: ['t5'] },
              },
            ])
      }
      return okStep([])
    })
    const ctx = phaseOver([[0, 6]])

    const { result } = await drainTimeline(ctx)

    expect(result).toEqual({ status: 'completed' })
    const ledger = closeLedgerOf(ctx.intermediates)!
    expect(ledger.calls.map((call) => [call.task, call.part, call.tool, call.result])).toEqual([
      ['happenings', 0, 'read_turns', 'ok'],
      ['awareness', 0, 'set_pin', 'ok'],
      ...Array.from({ length: CLOSE_TASK_STEP_BUDGET - 1 }, () => [
        'awareness',
        0,
        'read_turns',
        'ok',
      ]),
    ])
    expect(ledger.stopped).toEqual([{ task: 'awareness', part: 0, reason: 'budget' }])
    // Both code steps wrote, and neither left a call.
    expect(await wrenStackables()).toEqual({ gold: 8 })
    expect(await counts()).toEqual([0])
  })
})
