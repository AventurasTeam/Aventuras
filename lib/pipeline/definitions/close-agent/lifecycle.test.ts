import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome } from '@/lib/actions/types'
import {
  generateToolStep,
  type ResolveModelConfig,
  type ToolStepCall,
  type ToolStepResult,
} from '@/lib/ai'
import {
  branches,
  emptyEntityState,
  entities,
  stories,
  storyEntries,
  type CollisionReason,
  type EntityState,
  type NewEntity,
  type StoryMode,
} from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import { LIFECYCLE_READ_FIELDS, lifecycleTask, type LifecycleRow } from './lifecycle'
import { __setCloseAgentSlots } from './slots'
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
const ROWS = {
  tobin: 'char_00000000-0000-4000-8000-00000000f001',
  wren: 'char_00000000-0000-4000-8000-00000000f002',
  pew: 'char_00000000-0000-4000-8000-00000000f003',
  bess: 'char_00000000-0000-4000-8000-00000000f004',
  ansel: 'char_00000000-0000-4000-8000-00000000f005',
  stranger: 'char_00000000-0000-4000-8000-00000000f006',
  lantern: 'item_00000000-0000-4000-8000-00000000f007',
  satchel: 'item_00000000-0000-4000-8000-00000000f008',
  drovers: 'fact_00000000-0000-4000-8000-00000000f009',
  blindMen: 'fact_00000000-0000-4000-8000-00000000f00a',
  harrow: 'loc_00000000-0000-4000-8000-00000000f00b',
  // Never written: a partner that's gone.
  gone: 'item_00000000-0000-4000-8000-00000000f00c',
} as const

type RowSpec = {
  id: string
  kind: NewEntity['kind']
  name: string
  status?: NewEntity['status']
  keywords?: string[]
  /** Merged over the kind's empty state. */
  state?: Readonly<Record<string, unknown>>
  flag?: { partnerId: string; reason: CollisionReason }
}

/** A row a pass created before the chapter: unanchored, through the action layer. */
async function seedRow(fx: CloseFixture, spec: RowSpec): Promise<void> {
  const status = spec.status ?? 'active'
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: spec.id,
            branchId: fx.branchId,
            kind: spec.kind,
            name: spec.name,
            description: null,
            status,
            retiredReason: status === 'retired' ? 'Left the story.' : null,
            injectionMode: 'auto',
            keywords: spec.keywords ?? [],
            state: { ...emptyEntityState(spec.kind), ...spec.state } as EntityState,
            ...(spec.flag === undefined
              ? {}
              : {
                  nameCollisionFlag: 1,
                  nameCollisionPartnerId: spec.flag.partnerId,
                  nameCollisionReason: spec.flag.reason,
                }),
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: fx.branchId,
      entryId: null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${spec.name} refused: ${result.reason}`)
}

async function setSceneOf(
  fx: CloseFixture,
  entryId: string,
  ids: readonly string[],
): Promise<void> {
  const where = and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId))
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error(`setSceneOf: entry ${entryId} has no metadata`)
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, sceneEntities: [...ids] } })
    .where(where)
}

// The fixture's entries by index: 0-6 the chapter (positions 1-7, t1-t7), 6 is E, 7 the action
// after it, 8 the reply after that.
const chapterIds = (fx: CloseFixture): string[] => fx.entries.slice(0, 7).map((entry) => entry.id)

// A start makes no call, so the config is only carried.
const START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

function promptContextFor(
  fx: CloseFixture,
  ids: CloseIds,
  taskEntryIds: readonly string[],
): TaskPromptContext {
  const actionId = 'act_lifecycle_start'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries[6]!.id,
    task: 'lifecycle',
    part: 1,
    ids,
    readFields: LIFECYCLE_READ_FIELDS,
    survivorOf: () => undefined,
    landedCalls: () => 0,
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
    taskEntryIds,
    config: START_CONFIG,
  }
}

// As the agent phase does before any task: the chapter's turns shown first, t1-t7.
async function startOf(fx: CloseFixture, taskEntryIds: readonly string[] = chapterIds(fx)) {
  const ids = new CloseIds()
  ids.showTurns(chapterIds(fx))
  const ctx = promptContextFor(fx, ids, taskEntryIds)
  return { ids, ctx, start: await lifecycleTask.start(ctx) }
}

const OTHER_BRANCH = 'br_close_other'

async function insertOtherBranch(fx: CloseFixture): Promise<void> {
  await fx.ctx.db
    .insert(branches)
    .values({ id: OTHER_BRANCH, storyId: fx.storyId, name: 'other', createdAt: 1 })
}

const otherBranchRow = (id: string, name: string): NewEntity => ({
  id,
  branchId: OTHER_BRANCH,
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const shown = (
  id: string,
  kind: LifecycleRow['kind'],
  name: string,
  collision = '',
): LifecycleRow => ({ id, kind, name, status: 'active', retiredReason: '', collision })

const seedsOf = (...ids: string[]) => ids.map((id) => ({ table: 'entities', id }))

afterEach(() => {
  resetAllStores()
})

describe('lifecycleTask', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    fx = await openCloseFixture()
  })

  it("lists canon's tools and reads status, reason, description, keywords and the flag on every kind", () => {
    const paths = [
      'status',
      'retiredReason',
      'description',
      'keywords',
      'nameCollisionFlag',
      'nameCollisionPartnerId',
      'nameCollisionReason',
    ]
    expect(lifecycleTask.task).toBe('lifecycle')
    expect(lifecycleTask.tools.map((tool) => tool.name)).toEqual([
      'search_world',
      'read_row',
      'retire_entity',
      'flag_duplicate',
    ])
    expect(LIFECYCLE_READ_FIELDS).toEqual({
      character: paths,
      location: paths,
      item: paths,
      faction: paths,
    })
    expect(lifecycleTask.readFields).toBe(LIFECYCLE_READ_FIELDS)
  })

  it("starts from the part's active characters and items in scene and the rows its prose names, never a place", async () => {
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    await seedRow(fx, { id: ROWS.lantern, kind: 'item', name: 'Lantern' })
    // The opening carries "her satchel"; the third entry "loud with drovers".
    await seedRow(fx, { id: ROWS.satchel, kind: 'item', name: 'Satchel' })
    await seedRow(fx, {
      id: ROWS.drovers,
      kind: 'faction',
      name: "Drovers' Guild",
      keywords: ['drovers'],
    })
    await seedRow(fx, { id: ROWS.harrow, kind: 'location', name: 'Harrow' })
    await seedRow(fx, { id: ROWS.bess, kind: 'character', name: 'Bess', status: 'staged' })
    await seedRow(fx, { id: ROWS.ansel, kind: 'character', name: 'Ansel', status: 'retired' })
    await seedRow(fx, { id: ROWS.pew, kind: 'character', name: 'Pew' })
    // Neither named in the prose nor joined by a character: a faction id in a scene is no start.
    await seedRow(fx, { id: ROWS.blindMen, kind: 'faction', name: 'The Blind Men' })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])
    await setSceneOf(fx, fx.entries[2]!.id, [
      ROWS.lantern,
      ROWS.harrow,
      ROWS.bess,
      ROWS.ansel,
      ROWS.blindMen,
    ])

    const { ids, start } = await startOf(fx)

    expect(start?.show.rows).toEqual([
      shown('c1', 'character', 'Tobin'),
      shown('i1', 'item', 'Lantern'),
      shown('i2', 'item', 'Satchel'),
      shown('f1', 'faction', "Drovers' Guild"),
    ])
    expect(start?.seeds).toEqual(seedsOf(ROWS.tobin, ROWS.lantern, ROWS.satchel, ROWS.drovers))
    for (const absent of [ROWS.harrow, ROWS.bess, ROWS.ansel, ROWS.pew, ROWS.blindMen])
      expect(ids.handleOf(absent), absent).toBeUndefined()
  })

  it("takes a faction through a member, kept when a later reply's scene removes the member", async () => {
    await seedRow(fx, { id: ROWS.blindMen, kind: 'faction', name: 'The Blind Men' })
    await seedRow(fx, {
      id: ROWS.pew,
      kind: 'character',
      name: 'Pew',
      state: { faction_id: ROWS.blindMen },
    })
    await setSceneOf(fx, fx.entries[2]!.id, [ROWS.pew])

    const before = (await startOf(fx)).start
    await setSceneOf(fx, fx.entries[8]!.id, [ROWS.pew])
    const after = (await startOf(fx)).start

    expect(before?.show.rows).toEqual([
      shown('c1', 'character', 'Pew'),
      shown('f1', 'faction', 'The Blind Men'),
    ])
    expect(after?.show.rows).toEqual([shown('f1', 'faction', 'The Blind Men')])
    expect(after?.seeds).toEqual(seedsOf(ROWS.blindMen))
  })

  it('keeps a character only the action after E has in scene, which carries E forward', async () => {
    await seedRow(fx, { id: ROWS.pew, kind: 'character', name: 'Pew' })
    await setSceneOf(fx, fx.entries[2]!.id, [ROWS.pew])
    await setSceneOf(fx, fx.entries[7]!.id, [ROWS.pew])

    const { start } = await startOf(fx)

    expect(start?.show.rows).toEqual([shown('c1', 'character', 'Pew')])
  })

  it("reads only the part's turns: a row outside them is not started from", async () => {
    // Wren: in the third entry's scene and named only in the opening, both outside t5-t7.
    await seedRow(fx, { id: ROWS.wren, kind: 'character', name: 'Wren' })
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    await setSceneOf(fx, fx.entries[2]!.id, [ROWS.wren])

    const { ids, start } = await startOf(fx, chapterIds(fx).slice(4))

    expect(start?.show.rows).toEqual([shown('c1', 'character', 'Tobin')])
    expect(start?.show.closeTurns.map((turn) => turn.handle)).toEqual(['t5', 't6', 't7'])
    expect(ids.handleOf(ROWS.wren)).toBeUndefined()
  })

  it('starts nothing with no row to show, or with no turn', async () => {
    expect((await startOf(fx)).start).toBeNull()

    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    expect((await startOf(fx, [])).start).toBeNull()
    // Control: the same row starts the task over the chapter's turns.
    expect((await startOf(fx)).start).not.toBeNull()
  })

  it('keeps an item a later reply has in scene: only a character is subtracted', async () => {
    await seedRow(fx, { id: ROWS.lantern, kind: 'item', name: 'Lantern' })
    await seedRow(fx, { id: ROWS.pew, kind: 'character', name: 'Pew' })
    await setSceneOf(fx, fx.entries[2]!.id, [ROWS.lantern, ROWS.pew])
    await setSceneOf(fx, fx.entries[8]!.id, [ROWS.lantern, ROWS.pew])

    const { start } = await startOf(fx)

    expect(start?.show.rows).toEqual([shown('i1', 'item', 'Lantern')])
  })

  it('takes a faction only through a selected member, and only an active one', async () => {
    // Pew is neither in scene nor named, so his faction isn't started from.
    await seedRow(fx, { id: ROWS.blindMen, kind: 'faction', name: 'The Blind Men' })
    await seedRow(fx, {
      id: ROWS.pew,
      kind: 'character',
      name: 'Pew',
      state: { faction_id: ROWS.blindMen },
    })
    // Tobin is in scene and Drovers' keyword is in the prose, but the faction is retired.
    await seedRow(fx, {
      id: ROWS.drovers,
      kind: 'faction',
      name: "Drovers' Guild",
      status: 'retired',
      keywords: ['drovers'],
    })
    await seedRow(fx, {
      id: ROWS.tobin,
      kind: 'character',
      name: 'Tobin',
      state: { faction_id: ROWS.drovers },
    })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])

    const { ids, start } = await startOf(fx)

    expect(start?.show.rows).toEqual([shown('c1', 'character', 'Tobin')])
    expect(ids.handleOf(ROWS.blindMen)).toBeUndefined()
    expect(ids.handleOf(ROWS.drovers)).toBeUndefined()
  })

  it('leaves out a retired or staged row the prose names, as one the scene holds', async () => {
    await seedRow(fx, { id: ROWS.wren, kind: 'character', name: 'Wren', status: 'retired' })
    await seedRow(fx, { id: ROWS.satchel, kind: 'item', name: 'Satchel', status: 'staged' })
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })

    const { ids, start } = await startOf(fx)

    expect(start?.show.rows).toEqual([shown('c1', 'character', 'Tobin')])
    expect(ids.handleOf(ROWS.wren)).toBeUndefined()
    expect(ids.handleOf(ROWS.satchel)).toBeUndefined()
  })

  it("reads this branch's rows only, a partner the other branch alone holds counting as gone", async () => {
    await insertOtherBranch(fx)
    await seedRow(fx, {
      id: ROWS.tobin,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: ROWS.stranger, reason: 'duplicate' },
    })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])
    // The sibling branch keeps a stranger the prose could name, and a namesake of Tobin's.
    await fx.ctx.db
      .insert(entities)
      .values([otherBranchRow(ROWS.stranger, 'Tobin'), otherBranchRow(ROWS.pew, 'Tobin')])

    const { ids, start } = await startOf(fx)

    expect(start?.show.rows).toEqual([
      shown('c1', 'character', 'Tobin', 'a row that no longer exists (duplicate, dormant)'),
    ])
    expect(ids.handleOf(ROWS.pew)).toBeUndefined()
  })

  it("shows each row's flag: its partner by handle and reason, dormant when it no longer holds", async () => {
    await seedRow(fx, { id: ROWS.stranger, kind: 'character', name: 'the hooded stranger' })
    await seedRow(fx, {
      id: ROWS.tobin,
      kind: 'character',
      name: 'Tobin',
      flag: { partnerId: ROWS.stranger, reason: 'duplicate' },
    })
    await seedRow(fx, {
      id: ROWS.satchel,
      kind: 'item',
      name: 'Satchel',
      flag: { partnerId: ROWS.gone, reason: 'alike' },
    })
    // Lantern and Satchel are no namesakes, so this flag no longer holds.
    await seedRow(fx, {
      id: ROWS.lantern,
      kind: 'item',
      name: 'Lantern',
      flag: { partnerId: ROWS.satchel, reason: 'alike' },
    })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin, ROWS.lantern])

    const { ids, start } = await startOf(fx)

    expect(start?.show.rows).toEqual([
      shown('c1', 'character', 'Tobin', 'c2 (duplicate)'),
      shown('i1', 'item', 'Lantern', 'i2 (alike, dormant)'),
      shown('i2', 'item', 'Satchel', 'a row that no longer exists (alike, dormant)'),
    ])
    expect(ids.nameOf('c2')).toBe('the hooded stranger')
    // A partner is named, not shown with its fields: it is no seed.
    expect(start?.seeds).toEqual(seedsOf(ROWS.tobin, ROWS.lantern, ROWS.satchel))
  })

  it("renders its rows and the writes so far in the user half, the part's turns in the system half", async () => {
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])
    const { ctx, start } = await startOf(fx)
    if (start === null) throw new Error('Tobin should start the task')

    const prompt = lifecycleTask.render(start, {
      ...ctx,
      writesSoFar: '- update_character Tobin (c1): description',
    })

    expect(prompt.user).toContain(
      '## c1: Tobin (character)\n- status: "active"\n- retiredReason: ""\n- flag: none',
    )
    expect(prompt.user).toContain(
      '# Writes so far\nWhat this close has written, in earlier tasks:\n- update_character Tobin (c1): description',
    )
    expect(prompt.user).toContain('Never a place.')
    expect(prompt.user).not.toContain('# The turns')
    expect(prompt.system).toContain('# The turns')
    expect(prompt.system).toContain('## t5 (narration)')
    expect(prompt.system).not.toContain('Tobin (character)')
  })

  // memory/chapter-close.md → Conversations: a part's tasks reuse the chapter's cached prefix.
  it("renders a system half byte-identical to Identity's for the same turns and mode", async () => {
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])
    const { ctx, start } = await startOf(fx)
    const identityStart = await identityTask.start({
      ...ctx,
      task: 'identity',
      readFields: IDENTITY_READ_FIELDS,
    })

    const identityPrompt = identityTask.render(identityStart!, { ...ctx, writesSoFar: '' })
    const lifecyclePrompt = lifecycleTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(lifecyclePrompt.system).toBe(identityPrompt.system)
    expect(lifecyclePrompt.system).toContain(
      '## t3 (narration)\nThe inn is warm and loud with drovers.',
    )
    expect(lifecyclePrompt.user).not.toBe(identityPrompt.user)
  })

  it("puts the story mode's rule in the system half, the same as Identity's", async () => {
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])
    const render = async (mode: StoryMode) => {
      const [story] = await fx.ctx.db
        .select({ definition: stories.definition })
        .from(stories)
        .where(eq(stories.id, fx.storyId))
      await fx.ctx.db
        .update(stories)
        .set({ definition: { ...story!.definition!, mode } })
        .where(eq(stories.id, fx.storyId))
      const { ctx, start } = await startOf(fx)
      const identityStart = await identityTask.start({
        ...ctx,
        task: 'identity',
        readFields: IDENTITY_READ_FIELDS,
      })
      return {
        identity: identityTask.render(identityStart!, { ...ctx, writesSoFar: '' }).system,
        lifecycle: lifecycleTask.render(start!, { ...ctx, writesSoFar: '' }).system,
      }
    }

    const creative = await render('creative')
    expect(creative.lifecycle).toContain('Each is a direction or prose')
    expect(creative.lifecycle).not.toContain('Each is what the lead does, says or attempts')
    expect(creative.lifecycle).toBe(creative.identity)

    const adventure = await render('adventure')
    expect(adventure.lifecycle).toContain('Each is what the lead does, says or attempts')
    expect(adventure.lifecycle).not.toContain('Each is a direction or prose')
    expect(adventure.lifecycle).toBe(adventure.identity)
  })
})

// ---- In the agent phase ----

const USAGE: Extract<ToolStepResult, { status: 'ok' }>['step']['usage'] = {
  inputTokens: 100,
  inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: 105,
}

function stepWith(calls: readonly ToolStepCall[]): ToolStepResult {
  const done = calls.length === 0
  return {
    status: 'ok',
    step: {
      calls: [...calls],
      invalidCalls: [],
      responseMessages: [
        {
          role: 'assistant',
          content: done
            ? [{ type: 'text', text: 'Nothing to change.' }]
            : calls.map((call) => ({ type: 'tool-call' as const, ...call })),
        },
      ],
      text: done ? 'Nothing to change.' : '',
      finishReason: done ? 'stop' : 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

// The opening to the third reply as one part.
function closePhase(fx: CloseFixture): PhaseContext {
  const actionId = 'act_lifecycle_close'
  const chapter = fx.entries.slice(0, 7)
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, {
    chapterId: 'chap_lifecycle',
    startEntryId: chapter[0]!.id,
    endEntryId: chapter[6]!.id,
  })
  // The agent loop reads a cut's ids; its token count is the metadata phase's.
  setCloseParts(intermediates, [
    { part: 1, startEntryId: chapter[0]!.id, endEntryId: chapter[6]!.id, tokens: 0 },
  ])
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

// Stands in for the orchestrator: each group lands and its outcome goes back.
async function drainLanding(
  fx: CloseFixture,
  ctx: PhaseContext,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  let reply: GroupOutcome | undefined
  for (;;) {
    const next = await gen.next(reply)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
    reply =
      next.value.type === 'delta_group_emitted'
        ? await applyDeltaActionGroupWithOutcomes(
            next.value.actions,
            { actionId: ctx.actionId, branchId: ctx.branchId, entryId: next.value.entryId },
            fx.ctx,
          )
        : undefined
  }
}

describe('Lifecycle in the agent phase', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(stepWith([]))
    __setCloseAgentSlots({ before: [], perPart: [{ kind: 'task', def: lifecycleTask }], after: [] })
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
  })

  it('starts with nothing to show, makes no step and still counts (C6)', async () => {
    const { events, result } = await drainLanding(fx, closePhase(fx))

    expect(result).toEqual({ status: 'completed' })
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([
      { type: 'close_task_start', task: 'lifecycle', part: 1, index: 6, total: 7 },
    ])
    expect(generateToolStep).not.toHaveBeenCalled()
  })

  it('retires a starting row with no read_row: the start showed the fields retire_entity writes', async () => {
    await seedRow(fx, { id: ROWS.tobin, kind: 'character', name: 'Tobin' })
    await setSceneOf(fx, fx.entries[4]!.id, [ROWS.tobin])
    vi.mocked(generateToolStep).mockResolvedValueOnce(
      stepWith([
        {
          toolCallId: 'k1',
          toolName: 'retire_entity',
          input: {
            id: 'c1',
            turns: ['t7'],
            why: 'Tobin goes into the black water at the landing.',
          },
        },
      ]),
    )
    const ctx = closePhase(fx)

    const { result } = await drainLanding(fx, ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(closeLedgerOf(ctx.intermediates)?.calls).toMatchObject([
      { task: 'lifecycle', part: 1, tool: 'retire_entity', result: 'ok' },
    ])
    const [tobin] = await fx.ctx.db
      .select({ status: entities.status })
      .from(entities)
      .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, ROWS.tobin)))
    expect(tobin?.status).toBe('retired')
  })
})
