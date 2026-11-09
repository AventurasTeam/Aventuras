import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { PromptHalves, ResolveModelConfig } from '@/lib/ai'
import { __clearPromptCountCache, countPromptTokens } from '@/lib/ai/context-window'
import { storyEntries } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'
import { countTokens } from '@/lib/tokens'
import { CAST_SOFT_CAPS } from '@/lib/wizard'

import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { CloseIds } from './ids'
import type { TaskPromptContext } from './task'
import { threadsTask } from './threads'
import { blankTurns, primeCloseSystemCount, readTaskTurns, type TaskTurns } from './turns'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import type { CloseTurn } from '../chapter-context'

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

// Each task's halves over the turns its start read; its rows don't reach the system half.
const RENDER: Record<
  'identity' | 'threads',
  (turns: TaskTurns, ctx: TaskPromptContext) => PromptHalves
> = {
  identity: ({ closeTurns, proseTokens }, ctx) =>
    identityTask.render(
      {
        show: { mode: 'creative', closeTurns, proseTokens, characters: [], factions: [] },
        seeds: [],
      },
      { ...ctx, writesSoFar: '' },
    ),
  threads: ({ closeTurns, proseTokens }, ctx) =>
    threadsTask.render(
      { show: { mode: 'creative', closeTurns, proseTokens, threads: [] }, seeds: [] },
      { ...ctx, writesSoFar: '' },
    ),
}

const BLANK_SYSTEM: Record<'identity' | 'threads', (closeTurns: readonly CloseTurn[]) => string> = {
  identity: (closeTurns) =>
    renderTemplate(TEMPLATE_IDS.closeIdentity, {
      mode: 'creative',
      closeTurns,
      closeCharacters: [],
      closeFactions: [],
      closeWritesSoFar: '',
      closeSoftCaps: { ...CAST_SOFT_CAPS },
    }).system,
  threads: (closeTurns) =>
    renderTemplate(TEMPLATE_IDS.closeThreads, {
      mode: 'creative',
      closeTurns,
      closeThreads: [],
      closeWritesSoFar: '',
    }).system,
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

describe("the close tasks' renders", () => {
  it.each(['identity', 'threads'] as const)(
    "prime %s's system half, so counting its prompt encodes no turn",
    async (task) => {
      const fx = await openCloseFixture()
      const ctx = taskContextFor(fx)
      const turns = await readTaskTurns(ctx)
      const blanked = turns.closeTurns.map((turn) => ({ ...turn, content: '' }))
      const primed = countTokens(BLANK_SYSTEM[task](blanked)) + turns.proseTokens
      __clearPromptCountCache()
      countTokensSpy.mockClear()

      const halves = RENDER[task](turns, ctx)
      const total = countPromptTokens([
        { role: 'system', content: halves.system },
        { role: 'user', content: [{ type: 'text', text: halves.user }] },
      ])

      const texts = encodedTexts()
      expect(texts).not.toContain(halves.system)
      expect(
        texts.filter((text) => turns.closeTurns.some(({ content }) => text.includes(content))),
      ).toEqual([])
      expect(total).toBe(primed + countTokens(halves.user))
    },
  )
})
