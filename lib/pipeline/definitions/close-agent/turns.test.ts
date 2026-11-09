import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { PromptHalves, ResolveModelConfig } from '@/lib/ai'
import { __clearPromptCountCache, countPromptTokens } from '@/lib/ai/context-window'
import { entities, storyEntries, threads } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { TEMPLATE_IDS } from '@/lib/prompts'
import { countTokens } from '@/lib/tokens'

import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import type { CloseTaskDef, TaskPromptContext } from './task'
import { threadsTask } from './threads'
import {
  blankTurns,
  hasTurns,
  primeCloseSystemCount,
  readTaskTurns,
  renderClosePrompt,
} from './turns'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'

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

// As the agent phase does before any task: every fixture entry a turn, t1 the first.
function taskContextFor(
  fx: CloseFixture,
  chapterEntryIds: readonly string[] = fx.entries.map(({ id }) => id),
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
    chapterEntryIds,
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
  const wren = 'char_00000000-0000-4000-8000-00000000c001'
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
    .set({ metadata: { ...row!.metadata!, sceneEntities: [wren] } })
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

describe('primeCloseSystemCount', () => {
  it("primes the system half at the blank half's count plus the prose count, never encoding the system half", () => {
    __clearPromptCountCache()
    countTokensSpy.mockClear()
    const system = 'The rules.\n\n# The turns\n\nRain on the river, and the ferry late.'
    const blank = 'The rules.\n\n# The turns\n\n'

    primeCloseSystemCount(system, blank, 40)
    const total = countPromptTokens([{ role: 'system', content: system }])

    expect(encodedTexts()).not.toContain(system)
    expect(total).toBe(countTokens(blank) + 40)
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
})
