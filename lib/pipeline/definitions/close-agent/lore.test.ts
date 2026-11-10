import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateToolStep, type ResolveModelConfig, type ToolStepResult } from '@/lib/ai'
import { branches, entities, lore, stories, storyEntries, type StoryMode } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import { LORE_READ_FIELDS, loreTask } from './lore'
import { createLoreTool } from './lore-tools'
import { __setCloseAgentSlots, type CloseAgentSlots } from './slots'
import type { TaskPromptContext } from './task'
import type { CloseTool, ToolContext } from './tool'
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
const KAEL = 'char_00000000-0000-4000-8000-00000000c006'

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

// Identity starts only on a scene character; the system-half tests compare against its render.
async function putSceneCharacter(fx: CloseFixture): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id: KAEL,
    branchId: fx.branchId,
    kind: 'character',
    name: 'Kael',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  const where = and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, fx.entries[2]!.id))
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error('putSceneCharacter: the entry has no metadata')
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, sceneEntities: [KAEL] } })
    .where(where)
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
  opts: { taskEntryIds?: readonly string[]; landedCalls?: ToolContext['landedCalls'] } = {},
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

  // Code units put "aether tides" last, where a locale sort puts it first.
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

  // C11: titles alone are not every field update_lore writes, so a row takes a read_row first.
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
    const landedCalls = vi.fn((tool: Pick<CloseTool, 'name'>) => (tool === createLoreTool ? 2 : 7))

    const { start } = await startOf({ landedCalls })

    expect(start?.show.limits).toEqual({ creates: 3, left: 1, bodyChars: 1200 })
    expect(landedCalls).toHaveBeenCalledWith(createLoreTool)
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

  // A title naming another row must not take that row's handle ahead of its place in the list.
  it("keeps a row's handle at its place in the list when an earlier title names it", async () => {
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: `A rule tied to ${LORE_ROWS.tides}` })
    await putLoreRow(fx, { id: LORE_ROWS.tides, title: 'Tides' })

    const { ids, start } = await startOf()

    expect(start?.show.lore).toEqual([
      { id: 'lo1', title: 'A rule tied to lo2' },
      { id: 'lo2', title: 'Tides' },
    ])
    expect(ids.idOf('lo2')).toBe(LORE_ROWS.tides)
  })

  it('renders the titles and the limits in the user half, the turns in the system half', async () => {
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })
    await putLoreRow(fx, { id: LORE_ROWS.aetherium, title: 'The\nAetherium' })
    const { ctx, start } = await startOf({ landedCalls: () => 1 })

    const { system, user } = loreTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(user).toContain('# Lore rows\n- lo1: House Eldrin\n- lo2: The Aetherium')
    expect(user).toContain('At most 3 new lore rows per chapter, across all its parts; 2 left.')
    expect(user).toContain(
      "A new row's body holds at most 1200 characters, and updates may grow a body by at most 1200 characters in all, across this chapter's calls.",
    )
    expect(user).not.toContain('# The turns')
    expect(user).not.toContain('# Writes so far')
    expect(system).toContain('## t3 (narration)\nThe inn is warm and loud with drovers.')
    expect(system).not.toContain('House Eldrin')
  })

  // memory/chapter-close.md → Conversations: a part's tasks reuse the chapter's cached prefix.
  it("renders a system half byte-identical to Identity's for the same turns and mode", async () => {
    await putLoreRow(fx, { id: LORE_ROWS.eldrin, title: 'House Eldrin' })
    await putSceneCharacter(fx)
    const ids = idsWithTurns(fx)
    const ctx = promptContextFor(fx, ids)
    const identityStart = await identityTask.start({
      ...ctx,
      task: 'identity',
      readFields: IDENTITY_READ_FIELDS,
    })
    const loreStart = await loreTask.start(ctx)

    const identityPrompt = identityTask.render(identityStart!, { ...ctx, writesSoFar: '' })
    const lorePrompt = loreTask.render(loreStart!, { ...ctx, writesSoFar: '' })

    expect(lorePrompt.system).toBe(identityPrompt.system)
    expect(lorePrompt.system).toContain('## t3 (narration)\nThe inn is warm and loud with drovers.')
    expect(lorePrompt.user).not.toBe(identityPrompt.user)
  })

  it("puts the story mode's rule in the system half, the same as Identity's", async () => {
    await putSceneCharacter(fx)
    const render = async (mode: StoryMode) => {
      const [story] = await fx.ctx.db
        .select({ definition: stories.definition })
        .from(stories)
        .where(eq(stories.id, fx.storyId))
      await fx.ctx.db
        .update(stories)
        .set({ definition: { ...story!.definition!, mode } })
        .where(eq(stories.id, fx.storyId))
      const ctx = promptContextFor(fx, idsWithTurns(fx))
      const identityStart = await identityTask.start({
        ...ctx,
        task: 'identity',
        readFields: IDENTITY_READ_FIELDS,
      })
      const loreStart = await loreTask.start(ctx)
      return {
        identity: identityTask.render(identityStart!, { ...ctx, writesSoFar: '' }).system,
        lore: loreTask.render(loreStart!, { ...ctx, writesSoFar: '' }).system,
      }
    }

    const creative = await render('creative')
    expect(creative.lore).toContain('Each is a direction or prose')
    expect(creative.lore).not.toContain('Each is what the lead does, says or attempts')
    expect(creative.lore).toBe(creative.identity)

    const adventure = await render('adventure')
    expect(adventure.lore).toContain('Each is what the lead does, says or attempts')
    expect(adventure.lore).not.toContain('Each is a direction or prose')
    expect(adventure.lore).toBe(adventure.identity)
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
    "Not lore: what one character, place, item or faction is like; that is the row's own, kept by other tasks. A faction's charter, the rules it is founded on, is lore.",
    'Before creating, call read_row on any row whose title may cover the same thing.',
    'call read_row on a row before update_lore, so you see its body and keywords as they stand.',
    'A body explains the rule in plain prose, stated as a standing fact of the world, not as what happened in the scene.',
    'Past the cap a create is rejected: extend a row instead.',
    "remove only one that no longer fits. You can't see who added a term; removing one the user added is refused, and that call's keyword adds with it.",
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
