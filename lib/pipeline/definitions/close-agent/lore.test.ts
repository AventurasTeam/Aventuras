import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateToolStep, type ResolveModelConfig, type ToolStepResult } from '@/lib/ai'
import { branches, entities, lore } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { CloseIds } from './ids'
import { LORE_READ_FIELDS, loreTask } from './lore'
import { __setCloseAgentSlots, type CloseAgentSlots } from './slots'
import type { TaskPromptContext } from './task'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import { closeLedgerOf, setCloseParts, setCloseRange } from '../close-intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const LORE_ROWS = {
  eldrin: 'lore_00000000-0000-4000-8000-00000000c001',
  aetherium: 'lore_00000000-0000-4000-8000-00000000c002',
  tides: 'lore_00000000-0000-4000-8000-00000000c003',
  eldrinTwin: 'lore_00000000-0000-4000-8000-00000000c004',
} as const
const SYNDICATE = 'fact_00000000-0000-4000-8000-00000000c005'

// Written with no delta, as an import or a hand edit leaves a row: a start reads rows, not history.
async function putLoreRow(
  fx: CloseFixture,
  row: { id: string; title: string; branchId?: string },
): Promise<void> {
  await fx.ctx.db.insert(lore).values({
    id: row.id,
    branchId: row.branchId ?? fx.branchId,
    title: row.title,
    body: 'How it works, at length.',
    category: null,
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

// As the agent phase does before any task: every chapter entry a turn, t1 the first.
function idsWithTurns(fx: CloseFixture): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(fx.entries.map((entry) => entry.id))
  return ids
}

// A start makes no call, so the config is only carried.
const START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

function promptContextFor(
  fx: CloseFixture,
  ids: CloseIds,
  opts: { taskEntryIds?: readonly string[]; landedCalls?: (tool: string) => number } = {},
): TaskPromptContext {
  const actionId = 'act_lore_start'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries.at(-1)!.id,
    task: 'lore',
    part: 1,
    ids,
    readFields: LORE_READ_FIELDS,
    survivorOf: () => undefined,
    landedCalls: opts.landedCalls ?? (() => 0),
    phase: {
      actionId,
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    taskEntryIds: opts.taskEntryIds ?? fx.entries.map((entry) => entry.id),
    config: START_CONFIG,
  }
}

describe('loreTask', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    fx = await openCloseFixture()
  })

  afterEach(() => {
    resetAllStores()
  })

  async function startOf(opts: Parameters<typeof promptContextFor>[2] = {}) {
    const ids = idsWithTurns(fx)
    const ctx = promptContextFor(fx, ids, opts)
    return { ctx, ids, start: await loreTask.start(ctx) }
  }

  it("lists canon's tools in order and reads a lore row's four fields", () => {
    expect(loreTask.task).toBe('lore')
    expect(loreTask.tools.map((tool) => tool.name)).toEqual([
      'read_row',
      'create_lore',
      'update_lore',
    ])
    expect(LORE_READ_FIELDS).toEqual({ lore: ['title', 'body', 'category', 'keywords'] })
    expect(loreTask.readFields).toBe(LORE_READ_FIELDS)
  })

  // Inserted out of order. Code units put "aether tides" last, where a locale sort puts it first.
  it('shows every lore row by title in code units, then by id, each under its short id', async () => {
    await putLoreRow(fx, { id: LORE_ROWS.tides, title: 'aether tides' })
    await putLoreRow(fx, { id: LORE_ROWS.aetherium, title: 'The Aetherium' })
    await putLoreRow(fx, { id: LORE_ROWS.eldrinTwin, title: 'House Eldrin' })
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })

    const { ids, start } = await startOf()

    expect(start?.show.lore).toEqual([
      { id: 'lo1', title: 'House Eldrin' },
      { id: 'lo2', title: 'House Eldrin' },
      { id: 'lo3', title: 'The Aetherium' },
      { id: 'lo4', title: 'aether tides' },
    ])
    expect(ids.idOf('lo1')).toBe(LORE_ROWS.eldrin)
    expect(ids.idOf('lo2')).toBe(LORE_ROWS.eldrinTwin)
    expect(ids.nameOf('lo3')).toBe('The Aetherium')
  })

  // C11: a title list shows no field update_lore writes whole, so its rows need a read_row.
  it('seeds no row as read, though it shows every title', async () => {
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })

    const { start } = await startOf()

    expect(start?.show.lore).toHaveLength(1)
    expect(start?.seeds).toEqual([])
  })

  it('starts on a part with turns and no lore at all, so a first row can be made', async () => {
    const { start } = await startOf()

    expect(start).not.toBeNull()
    expect(start?.show.lore).toEqual([])
    expect(start?.show.closeTurns).toHaveLength(fx.entries.length)
  })

  it('returns null for a task with no turns, lore or not', async () => {
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })

    expect((await startOf({ taskEntryIds: [] })).start).toBeNull()
  })

  it("shows the cap, the creates the ledger's landed create_lore calls leave, and the body limit", async () => {
    const landedCalls = vi.fn((tool: string) => (tool === 'create_lore' ? 2 : 7))

    const { start } = await startOf({ landedCalls })

    expect(start?.show.limits).toEqual({ creates: 3, left: 1, bodyChars: 1200 })
    expect(landedCalls).toHaveBeenCalledWith('create_lore')
    expect((await startOf()).start?.show.limits).toEqual({ creates: 3, left: 3, bodyChars: 1200 })
  })

  it("reads only the close's branch, where a fork holds a lore row of its own", async () => {
    const forkId = 'br_close_fork'
    await fx.ctx.db.insert(branches).values({
      id: forkId,
      storyId: fx.storyId,
      parentBranchId: fx.branchId,
      name: 'fork',
      createdAt: 2,
    })
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })
    await putLoreRow(fx, { id: LORE_ROWS.aetherium, title: 'The Aetherium', branchId: forkId })

    const { start } = await startOf()

    expect(start?.show.lore).toEqual([{ id: 'lo1', title: 'House Eldrin' }])
  })

  // A full id never reaches the prompt; the row it names is shown by name, so a write copying the
  // handle stores the name.
  it('shows a full id in a title as the short id of the row it names', async () => {
    await fx.ctx.db.insert(entities).values({
      id: SYNDICATE,
      branchId: fx.branchId,
      kind: 'faction',
      name: 'The Syndicate',
      description: null,
      status: 'active',
      retiredReason: null,
      injectionMode: 'auto',
      state: null,
      keywords: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: `The toll charter of ${SYNDICATE}` })

    const { ids, start } = await startOf()

    expect(start?.show.lore).toEqual([{ id: 'lo1', title: 'The toll charter of f1' }])
    expect(ids.nameOf('f1')).toBe('The Syndicate')
  })

  it('renders the titles and the limits in the user half, the turns in the system half', async () => {
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })
    await putLoreRow(fx, { id: LORE_ROWS.aetherium, title: 'The\nAetherium' })
    const { ctx, start } = await startOf({ landedCalls: () => 1 })

    const { system, user } = loreTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(user).toContain('# Lore rows\n- lo1: House Eldrin\n- lo2: The Aetherium')
    expect(user).toContain('At most 3 new lore rows per chapter, across all its parts; 2 left.')
    expect(user).toContain(
      "A new row's body holds at most 1200 characters, and an update may grow a body by at most 1200 characters.",
    )
    expect(user).not.toContain('# The turns')
    expect(user).not.toContain('# Writes so far')
    expect(system).toContain('## t3 (narration)\nThe inn is warm and loud with drovers.')
    expect(system).not.toContain('House Eldrin')
  })

  it('says so when the branch holds no lore', async () => {
    const { ctx, start } = await startOf()

    expect(loreTask.render(start!, { ...ctx, writesSoFar: '' }).user).toContain(
      '# Lore rows\nNone yet.',
    )
  })

  it('ends the user half with the writes so far', async () => {
    const { ctx, start } = await startOf()
    const writes = '- update_character Tobin (c1): state.traits'

    const { user } = loreTask.render(start!, { ...ctx, writesSoFar: writes })

    expect(
      user.endsWith(`# Writes so far\nWhat this close has written, in earlier tasks:\n${writes}`),
    ).toBe(true)
  })

  // memory/chapter-close.md → 3a.
  it.each([
    'Write lore only when the turns explain how something works or what it is, never when they only mention it',
    '"Aria visited the temple of Vael." is an event, not lore.',
    '"The temple of Vael is a relic of the Eldritch covenants, where blood-bound priests once communed with the Forgotten Hour through ritual exsanguination." explains a religious practice: lore.',
    '"The Aetherium was acting up again." mentions without explaining: not lore.',
    '"The Aetherium runs on the kinetic resonance of crystalline lattices; without daily harmonic tuning by the keepers, the entire grid faults within hours." explains a mechanism: lore.',
    "extend or correct that row with update_lore instead of creating a second, the user's rows included.",
    'call read_row on a row before update_lore',
    'Past the cap a create is rejected: extend a row instead.',
    "remove only one that no longer fits. A term the user added can't be removed.",
    'Never write a turn id such as t3 into a title, body, category or keyword: cite turns only in "turns".',
  ])('the Lore task states: %s', async (line) => {
    const { ctx, start } = await startOf()

    expect(loreTask.render(start!, { ...ctx, writesSoFar: '' }).user).toContain(line)
  })
})

const USAGE = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: 105,
}

// A reply with no tool call: the task ends after one step.
function noCallStep(): ToolStepResult {
  return {
    status: 'ok',
    step: {
      calls: [],
      invalidCalls: [],
      responseMessages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Nothing to change.' }] },
      ],
      text: 'Nothing to change.',
      finishReason: 'stop',
      usage: USAGE,
    },
    recoverable: [],
  }
}

// The opening through the third reply (positions 1-7), as one part.
function closePhaseFor(fx: CloseFixture): PhaseContext {
  const actionId = 'act_lore_close'
  const intermediates: Record<string, unknown> = {}
  const startEntryId = fx.entries[0]!.id
  const endEntryId = fx.replyIds[2]!
  setCloseRange(intermediates, { chapterId: 'chap_lore_close', startEntryId, endEntryId })
  setCloseParts(intermediates, [{ part: 1, startEntryId, endEntryId, tokens: 0 }])
  return {
    actionId,
    abortSignal: new AbortController().signal,
    intermediates,
    log: makeLogger(actionId),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
  }
}

// No step writes here, so no group outcome is ever owed back.
async function drainAgent(
  ctx: PhaseContext,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const next = await gen.next(undefined)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const LORE_ONLY: CloseAgentSlots = {
  before: [],
  perPart: [{ kind: 'task', def: loreTask }],
  after: [],
}

describe('Lore in a close', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(noCallStep())
    __setCloseAgentSlots(LORE_ONLY)
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  // C6: Lore is a part's first task, 2 of 7 on a one-part chapter.
  it("starts 2 of 7 and sends canon's Lore tools on a story with no lore yet", async () => {
    const ctx = closePhaseFor(fx)

    const { events, result } = await drainAgent(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([
      { type: 'close_task_start', task: 'lore', part: 1, index: 2, total: 7 },
    ])
    expect(generateToolStep).toHaveBeenCalledTimes(1)
    const [, request] = vi.mocked(generateToolStep).mock.calls[0]!
    expect(Object.keys(request.tools)).toEqual(['read_row', 'create_lore', 'update_lore'])
    expect(request.prompt.user).toContain('# Lore rows\nNone yet.')
    expect(request.prompt.user).toContain('across all its parts; 3 left.')
    expect(closeLedgerOf(ctx.intermediates)?.stopped).toEqual([])
  })
})
