import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { PromptHalves, ResolveModelConfig } from '@/lib/ai'
import { __clearPromptCountCache, countPromptTokens } from '@/lib/ai/context-window'
import { entities, storyEntries, threads } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { TEMPLATE_IDS } from '@/lib/prompts'
import { resetAllStores } from '@/lib/stores'
import { countTokens } from '@/lib/tokens'

import {
  ARIA as AWARENESS_ARIA,
  promptContextFor as awarenessContextFor,
  seedAwarenessWorld,
} from './__tests__/close-awareness-fixture'
import { seedCharacter, seedHappening } from './__tests__/happening-tools-fixture'
import { awarenessTask } from './close-awareness'
import { happeningsTask } from './happenings'
import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import { lifecycleTask } from './lifecycle'
import { loreTask } from './lore'
import type { CloseTaskDef, TaskPromptContext } from './task'
import { threadsTask } from './threads'
import { blankTurns, hasTurns, readTaskTurns, renderClosePrompt } from './turns'
import { upkeepTask } from './upkeep'
import {
  flagLead,
  openCloseFixture,
  putEntityRow,
  setSceneOf,
  stampLead,
  type CloseFixture,
} from '../__tests__/close-fixture'
import { setCloseClusters } from '../close-intermediates'

const { countTokensSpy } = vi.hoisted(() => ({
  countTokensSpy: vi.fn<(text: string) => number>(),
}))

// Counts as the real encoder does; the spy records which texts reached it.
vi.mock('@/lib/tokens', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  countTokensSpy.mockImplementation(actual.countTokens as (text: string) => number)
  return { ...actual, countTokens: countTokensSpy }
})

// A task's start and render make no call, so the config is only carried.
const NO_MODELS: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

const WREN = 'char_00000000-0000-4000-8000-00000000c001'
const ARIA = 'char_00000000-0000-4000-8000-00000000c00a'
// Stamped on entries, never written as a row: a character since deleted.
const GONE = 'char_00000000-0000-4000-8000-00000000c0ff'
const MARA = 'char_00000000-0000-4000-8000-00000000c003'
const LIGHT = 'hap_00000000-0000-4000-8000-00000000c101'
const SIGNAL = 'hap_00000000-0000-4000-8000-00000000c102'

// Two of Mara's happenings in one cluster, as the range embed leaves them for Happenings.
async function happeningsContextFor(fx: CloseFixture): Promise<TaskPromptContext> {
  await seedCharacter(fx, MARA, 'Mara')
  await seedHappening(fx, { id: LIGHT, title: 'A light on the far bank', at: 2, cast: [MARA] })
  await seedHappening(fx, { id: SIGNAL, title: 'Mara signals from the bank', at: 4, cast: [MARA] })
  const ctx = taskContextFor(fx)
  setCloseClusters(ctx.phase.intermediates, [[LIGHT, SIGNAL]])
  return ctx
}

const idsOf = (fx: CloseFixture, from: number, to?: number): string[] =>
  fx.entries.slice(from, to).map(({ id }) => id)

// The prose tasks of a part, in canon's run order (close-agent/slots.ts).
const PROSE_TASKS: readonly (readonly [string, CloseTaskDef])[] = [
  ['Lore', loreTask],
  ['Identity', identityTask],
  ['Threads', threadsTask],
  ['Upkeep', upkeepTask],
  ['Lifecycle', lifecycleTask],
]

// As the agent phase does before any task: every fixture entry a turn, t1 the first.
function taskContextFor(
  fx: CloseFixture,
  taskEntryIds: readonly string[] = fx.entries.map(({ id }) => id),
): TaskPromptContext {
  const ids = new CloseIds()
  ids.showTurns(fx.entries.map(({ id }) => id))
  const actionId = 'act_turns_test'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries.at(-1)!.id,
    task: 'identity',
    part: 1,
    ids,
    readFields: IDENTITY_READ_FIELDS,
    survivorOf: () => undefined,
    clusterOf: () => undefined,
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
    config: NO_MODELS,
  }
}

async function setEntry(
  fx: CloseFixture,
  id: string,
  set: { contentTokens: number | null; content?: string },
): Promise<void> {
  await fx.ctx.db
    .update(storyEntries)
    .set(set)
    .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, id)))
}

const encodedTexts = (): string[] => countTokensSpy.mock.calls.map(([text]) => text)

// Rows for both starts: Wren in the first turn's scene for Identity, an open thread for Threads.
async function seedStartRows(fx: CloseFixture): Promise<void> {
  const wren = WREN
  await fx.ctx.db.insert(entities).values({
    id: wren,
    branchId: fx.branchId,
    kind: 'character',
    name: 'Wren',
    description: 'A courier.',
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    state: null,
    keywords: [],
    createdAt: 1,
    updatedAt: 1,
  })
  // A bare place in the scene, so Upkeep has a row to show.
  const ford = 'loc_00000000-0000-4000-8000-00000000c002'
  await fx.ctx.db.insert(entities).values({
    id: ford,
    branchId: fx.branchId,
    kind: 'location',
    name: 'The ford',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await fx.ctx.db.insert(threads).values({
    id: 'thr_00000000-0000-4000-8000-000000000001',
    branchId: fx.branchId,
    title: 'Deliver the letter',
    description: 'Wren carries a sealed letter to the reeve.',
    status: 'active',
    category: 'quest',
    icon: 'scroll',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  const first = fx.entries[0]!.id
  const where = and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, first))
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row!.metadata!, sceneEntities: [wren, ford] } })
    .where(where)
}

describe('readTaskTurns → proseTokens', () => {
  it("sums each entry's stored count, and counts a null one from its prose without its blocks", async () => {
    const fx = await openCloseFixture()
    const [action, reply, uncounted] = [fx.entries[1]!.id, fx.entries[2]!.id, fx.entries[4]!.id]
    // Counts no encoder gives these entries, so a sum that counts them again misses.
    await setEntry(fx, action, { contentTokens: 5 })
    await setEntry(fx, reply, { contentTokens: 7 })
    await setEntry(fx, uncounted, {
      contentTokens: null,
      content: 'Tobin poles faster.\n<state><summary>A crossing</summary></state>',
    })

    const { proseTokens } = await readTaskTurns(taskContextFor(fx, [action, reply, uncounted]))

    expect(proseTokens).toBe(5 + 7 + countTokens('Tobin poles faster.'))
  })
})

// data-model.md → The lead: a close reads the flag and the stamps from the table, no store loaded.
describe('readTaskTurns → lead marks', () => {
  it("marks the first turn of each lead's run under its close handle, from the lead the table flags", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria\nof the Ford' })
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 2), ARIA)
    await stampLead(fx, idsOf(fx, 2, 4), WREN)
    resetAllStores()
    const ctx = taskContextFor(fx, idsOf(fx, 0, 4))

    const { closeTurns, lead } = await readTaskTurns(ctx)

    expect(closeTurns.map((turn) => turn.leadMark)).toEqual([
      { id: 'c1', name: 'Aria of the Ford' },
      undefined,
      { id: 'c2', name: 'Wren' },
      undefined,
    ])
    expect(closeTurns.map((turn) => 'leadMark' in turn)).toEqual([true, false, true, false])
    expect(ctx.ids.idOf('c1')).toBe(ARIA)
    expect(ctx.ids.idOf('c2')).toBe(WREN)
    expect(lead).toEqual({ id: WREN, name: 'Wren' })
  })

  it('marks a run under a character the branch no longer holds as gone, with no handle', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 2), GONE)
    await stampLead(fx, idsOf(fx, 2, 4), WREN)
    resetAllStores()
    const ctx = taskContextFor(fx, idsOf(fx, 0, 4))

    const { closeTurns } = await readTaskTurns(ctx)

    expect(closeTurns.map((turn) => turn.leadMark)).toEqual([
      { gone: true },
      undefined,
      { id: 'c1', name: 'Wren' },
      undefined,
    ])
    expect(ctx.ids.handleOf(GONE)).toBeUndefined()
  })

  it('marks a run written with no lead as none', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 2, 4), WREN)
    resetAllStores()

    const { closeTurns } = await readTaskTurns(taskContextFor(fx, idsOf(fx, 0, 4)))

    expect(closeTurns.map((turn) => turn.leadMark)).toEqual([
      { none: true },
      undefined,
      { id: 'c1', name: 'Wren' },
      undefined,
    ])
  })

  it("marks no turn when every stamp is the lead's, and gives the lead its name on one line", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren\nthe Courier' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 4), WREN)
    resetAllStores()
    const ctx = taskContextFor(fx, idsOf(fx, 0, 4))

    const { closeTurns, lead } = await readTaskTurns(ctx)

    expect(closeTurns.some((turn) => 'leadMark' in turn)).toBe(false)
    expect(ctx.ids.handleOf(WREN)).toBeUndefined()
    expect(lead).toEqual({ id: WREN, name: 'Wren the Courier' })
  })

  it('walks from no lead on a branch with none, marking its first stamped turn', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await stampLead(fx, idsOf(fx, 0, 4), ARIA)
    resetAllStores()

    const { closeTurns, lead } = await readTaskTurns(taskContextFor(fx, idsOf(fx, 0, 4)))

    expect(lead).toBeNull()
    expect(closeTurns.map((turn) => turn.leadMark)).toEqual([
      { id: 'c1', name: 'Aria' },
      undefined,
      undefined,
      undefined,
    ])
  })

  it('marks no turn and reads no lead on a branch with none whose turns carry no stamp', async () => {
    const fx = await openCloseFixture()

    const { closeTurns, lead } = await readTaskTurns(taskContextFor(fx, idsOf(fx, 0, 4)))

    expect(lead).toBeNull()
    expect(closeTurns.some((turn) => 'leadMark' in turn)).toBe(false)
  })
})

describe('hasTurns', () => {
  it('holds for one turn or more, and not for none', () => {
    expect(hasTurns([])).toBe(false)
    expect(hasTurns([{ handle: 't1', kind: 'opening', content: 'Rain on the river.' }])).toBe(true)
  })
})

describe('CloseTurns (checked by tsc)', () => {
  it('takes no empty list into a close prompt', () => {
    const render = (): PromptHalves =>
      // @ts-expect-error an empty list renders an empty "# The turns"
      renderClosePrompt(TEMPLATE_IDS.closeThreads, [], {}, 0)
    expect(render).toBeTypeOf('function')
  })
})

describe('blankTurns', () => {
  it("blanks every turn's content and keeps its handle and kind", () => {
    expect(
      blankTurns([
        { handle: 't1', kind: 'opening', content: 'Rain on the river.' },
        { handle: 't2', kind: 'user_action', content: 'I wait for the ferry.' },
      ]),
    ).toEqual([
      { handle: 't1', kind: 'opening', content: '' },
      { handle: 't2', kind: 'user_action', content: '' },
    ])
  })
})

// The task's own start, then its own render: nothing is built by hand between them.
async function expectSystemHalfPrimed<Show extends { closeTurns: readonly { content: string }[] }>(
  def: CloseTaskDef<Show>,
): Promise<void> {
  const fx = await openCloseFixture()
  await seedStartRows(fx)
  const ctx = taskContextFor(fx)
  const start = await def.start(ctx)
  expect(start).not.toBeNull()
  __clearPromptCountCache()
  countTokensSpy.mockClear()

  const halves = def.render(start!, { ...ctx, writesSoFar: '' })
  const total = countPromptTokens([
    { role: 'system', content: halves.system },
    { role: 'user', content: [{ type: 'text', text: halves.user }] },
  ])

  const texts = encodedTexts()
  expect(texts).not.toContain(halves.system)
  expect(
    texts.filter((text) => start!.show.closeTurns.some(({ content }) => text.includes(content))),
  ).toEqual([])
  // Exact for this English fixture: its stored counts are accurate and o200k merges nothing across
  // its turns' edges. A CJK chapter's can merge, and its half primes a little low.
  expect(total).toBe(countTokens(halves.system) + countTokens(halves.user))
}

describe("the close tasks' starts and renders", () => {
  it("prime Identity's system half at its encoded count, so counting its prompt encodes no turn", () =>
    expectSystemHalfPrimed(identityTask))
  it("prime Threads' system half at its encoded count, so counting its prompt encodes no turn", () =>
    expectSystemHalfPrimed(threadsTask))
  it("prime Lore's system half at its encoded count, so counting its prompt encodes no turn", () =>
    expectSystemHalfPrimed(loreTask))
  it("prime Upkeep's system half at its encoded count, so counting its prompt encodes no turn", () =>
    expectSystemHalfPrimed(upkeepTask))
  it("prime Lifecycle's system half at its encoded count, so counting its prompt encodes no turn", () =>
    expectSystemHalfPrimed(lifecycleTask))

  // memory/chapter-close.md → Conversations: the handle is fixed as the turns are built, so a
  // part's tasks share their system half; a gone mark takes no handle.
  it("render one system half across a part's tasks when its turns carry marks, a gone one among them", async () => {
    const fx = await openCloseFixture()
    await seedStartRows(fx)
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 2), ARIA)
    await stampLead(fx, idsOf(fx, 2, 4), GONE)
    await stampLead(fx, idsOf(fx, 4), WREN)
    const ctx = taskContextFor(fx)

    const systems: string[] = []
    for (const [, def] of PROSE_TASKS) {
      const start = await def.start(ctx)
      expect(start).not.toBeNull()
      systems.push(def.render(start!, { ...ctx, writesSoFar: '' }).system)
    }

    expect(new Set(systems).size).toBe(1)
    expect(systems[0]).toContain('Aria (c1)')
    expect(systems[0]).toContain('Wren (c2)')
    expect(ctx.ids.handleOf(GONE)).toBeUndefined()
  })

  // memory/chapter-close.md → Conversations: each task's user half names the lead by handle and
  // name, read from the table; a close loads no story's stores.
  it.each(PROSE_TASKS)(
    '%s names the lead by handle and name in its user half, read from the table with no store loaded',
    async (_name, def) => {
      const fx = await openCloseFixture()
      await seedStartRows(fx)
      await flagLead(fx, WREN)
      await stampLead(fx, idsOf(fx, 0), WREN)
      resetAllStores()
      const ctx = taskContextFor(fx)

      const start = await def.start(ctx)
      expect(start).not.toBeNull()
      const { system, user } = def.render(start!, { ...ctx, writesSoFar: '' })

      expect(user).toContain(
        'The story\'s lead is Wren (c1). Outside quoted speech, "I" and "you" in the turns are the lead.',
      )
      expect(user).not.toContain('except where a turn names another')
      expect(system).not.toContain("The story's lead")
      expect(ctx.ids.idOf('c1')).toBe(WREN)
    },
  )

  it.each(PROSE_TASKS)(
    '%s names no lead on a branch with none, and still starts',
    async (_name, def) => {
      const fx = await openCloseFixture()
      await seedStartRows(fx)
      const ctx = taskContextFor(fx)

      const start = await def.start(ctx)

      expect(start).not.toBeNull()
      expect(def.render(start!, { ...ctx, writesSoFar: '' }).user).not.toContain("The story's lead")
    },
  )

  it('shows the lead after the rows, so Identity keeps its characters in their numbering', async () => {
    const fx = await openCloseFixture()
    await seedStartRows(fx)
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await setSceneOf(fx, fx.entries[0]!.id, [WREN, ARIA])
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0), WREN)
    const ctx = taskContextFor(fx)

    const start = await identityTask.start(ctx)
    const { user } = identityTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(user).toContain('## c1: Aria')
    expect(user).toContain('## c2: Wren')
    expect(user).toContain(
      'The story\'s lead is Wren (c2). Outside quoted speech, "I" and "you" in the turns are the lead.',
    )
  })

  it("adds the clause to a prose task's lead line when its part's turns are marked", async () => {
    const fx = await openCloseFixture()
    await seedStartRows(fx)
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 2), ARIA)
    await stampLead(fx, idsOf(fx, 2), WREN)
    const ctx = taskContextFor(fx)

    const start = await loreTask.start(ctx)
    const { user } = loreTask.render(start!, { ...ctx, writesSoFar: '' })

    // The marks show Aria c1 and Wren c2 as the turns are built, before the lead line.
    expect(user).toContain(
      'The story\'s lead is Wren (c2). Outside quoted speech, "I" and "you" in the turns are the lead, except where a turn names another.',
    )
  })

  it('Happenings names the lead in its user half, read from the table with no store loaded', async () => {
    const fx = await openCloseFixture()
    const ctx = await happeningsContextFor(fx)
    await flagLead(fx, MARA)
    resetAllStores()

    const start = await happeningsTask.start(ctx)
    expect(start).not.toBeNull()
    const { system, user } = happeningsTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(user).toContain(
      'The story\'s lead is Mara (c1). Outside quoted speech, "I" and "you" in the turns are the lead.',
    )
    expect(system).not.toContain("The story's lead")
  })

  it('Happenings names no lead on a branch with none, and still starts', async () => {
    const fx = await openCloseFixture()
    const ctx = await happeningsContextFor(fx)

    const start = await happeningsTask.start(ctx)

    expect(start).not.toBeNull()
    expect(happeningsTask.render(start!, { ...ctx, writesSoFar: '' }).user).not.toContain(
      "The story's lead",
    )
  })

  it('Awareness names the lead in its user half, read from the table with no store loaded', async () => {
    const fx = await openCloseFixture()
    await seedAwarenessWorld(fx)
    await flagLead(fx, AWARENESS_ARIA)
    resetAllStores()
    const ctx = awarenessContextFor(fx)

    const start = await awarenessTask.start(ctx)
    expect(start).not.toBeNull()
    const { system, user } = awarenessTask.render(start!, { ...ctx, writesSoFar: '' })

    expect(user).toContain(
      'The story\'s lead is Aria (c1). Outside quoted speech, "I" and "you" in the turns are the lead.',
    )
    expect(system).not.toContain("The story's lead")
  })

  it('Awareness names no lead on a branch with none, and still starts', async () => {
    const fx = await openCloseFixture()
    await seedAwarenessWorld(fx)
    const ctx = awarenessContextFor(fx)

    const start = await awarenessTask.start(ctx)

    expect(start).not.toBeNull()
    expect(awarenessTask.render(start!, { ...ctx, writesSoFar: '' }).user).not.toContain(
      "The story's lead",
    )
  })
})
