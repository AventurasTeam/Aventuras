import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { generationStore, resetAllStores } from '@/lib/stores'

import { openCloseFixture } from './__tests__/close-fixture'
import { createPhaseDb, hydrateEntries, resetPhaseDb, type PhaseDb } from './__tests__/phase-db'
import { closeBoundaryPhase } from './chapter-close-boundary'
import { CLOSE_PHASE, CLOSE_RANGE_INTERMEDIATE_KEY } from './intermediates'
import type { PhaseContext } from '../types'

let phaseDb: PhaseDb

beforeAll(async () => {
  phaseDb = await createPhaseDb()
})

beforeEach(() => {
  resetPhaseDb(phaseDb)
  resetAllStores()
})

function row(
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  chapterId: string | null = null,
): StoryEntry {
  return {
    id,
    branchId: 'b1',
    position,
    kind,
    content: `The crossing, part ${position}: reeds, black water and a lantern on the far bank.`,
    contentTokens: null,
    chapterId,
    metadata: null,
    createdAt: position,
  }
}

// A first chapter still open: the opening, two turns, a system row and a turn after it. With no
// pick the fallback ends it on e5, the latest reply before the head e8.
const FIRST_CHAPTER_OPEN = [
  row('e1', 1, 'opening'),
  row('e2', 2, 'user_action'),
  row('e3', 3, 'ai_reply'),
  row('e4', 4, 'user_action'),
  row('e5', 5, 'ai_reply'),
  row('s6', 6, 'system'),
  row('e7', 7, 'user_action'),
  row('e8', 8, 'ai_reply'),
]

// The branch's first chapter closed at e3, so e1..e3 carry its stamp.
const AFTER_A_CHAPTER = [
  row('e1', 1, 'opening', 'chap_first'),
  row('e2', 2, 'user_action', 'chap_first'),
  row('e3', 3, 'ai_reply', 'chap_first'),
  row('e4', 4, 'user_action'),
  row('e5', 5, 'ai_reply'),
]

// An open region with no reply to end on.
const NO_REPLY = [row('e1', 1, 'opening'), row('e2', 2, 'user_action')]

function phaseCtx(over: Partial<PhaseContext> = {}): PhaseContext {
  return {
    actionId: 'act_close',
    abortSignal: new AbortController().signal,
    intermediates: {},
    log: makeLogger('act_close'),
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
    ...over,
  }
}

async function drain(ctx: PhaseContext) {
  const gen = closeBoundaryPhase(ctx)
  const events: unknown[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const refused = {
  status: 'failed',
  error: {
    kind: 'phase-logic',
    phaseName: CLOSE_PHASE.boundary,
    detail: expect.stringContaining('chapter-close:'),
  },
}

const chapterRows = (): number =>
  (phaseDb.sqlite.prepare('SELECT COUNT(*) AS n FROM chapters').get() as { n: number }).n

const pickOn = (branchId: string) => generationStore.getTxState().pendingClose.get(branchId)

async function expectRefused(): Promise<void> {
  const ctx = phaseCtx()
  const { events, result } = await drain(ctx)
  expect(result).toEqual(refused)
  expect(events).toEqual([])
  expect(ctx.intermediates).toEqual({})
}

async function expectEndsOn(
  ctx: PhaseContext,
  range: { startEntryId: string; endEntryId: string },
): Promise<void> {
  const { events, result } = await drain(ctx)
  expect(result).toEqual({ status: 'completed' })
  expect(events).toEqual([])
  expect(ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY]).toEqual({
    chapterId: expect.stringMatching(/^chap_[0-9a-f-]{36}$/),
    ...range,
  })
}

describe('closeBoundaryPhase with a pick', () => {
  // Neither is the fallback's e5; e8 is the head, which a manual close may end on.
  it.each(['e3', 'e8'])('ends on the picked %s', async (endEntryId) => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId })
  })

  it('writes nothing, and leaves the pick for the commit to drop', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(chapterRows()).toBe(0)
    // finishRun drops it at the commit, not this phase.
    expect(pickOn('b1')).toEqual({ endEntryId: 'e5' })
  })

  it("starts the range after the last chapter's stamps", async () => {
    hydrateEntries(phaseDb, 'b1', AFTER_A_CHAPTER)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e4', endEntryId: 'e5' })
  })

  it('mints a new chapter id for each run', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    const first = phaseCtx()
    const second = phaseCtx()
    await drain(first)
    await drain(second)
    const idOf = (ctx: PhaseContext) =>
      (ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY] as { chapterId: string }).chapterId
    expect(idOf(first)).not.toBe(idOf(second))
  })

  // C10: a system entry hard-deletes with no delta, and a held entry is another chapter's.
  it.each([
    { name: 'a system entry', rows: FIRST_CHAPTER_OPEN, endEntryId: 's6' },
    { name: 'an entry a chapter already holds', rows: AFTER_A_CHAPTER, endEntryId: 'e3' },
    { name: 'an entry the branch does not have', rows: FIRST_CHAPTER_OPEN, endEntryId: 'e99' },
  ])(
    'drops a pick on $name and fails: it is not in the open region',
    async ({ rows, endEntryId }) => {
      hydrateEntries(phaseDb, 'b1', rows)
      generationStore.setPendingClose('b1', { endEntryId })
      await expectRefused()
      expect(pickOn('b1')).toBeUndefined()
    },
  )

  // C10: the opening is the rollback floor, and a user_action splits a turn.
  it.each([
    { kind: 'user_action', endEntryId: 'e4' },
    { kind: 'opening', endEntryId: 'e1' },
  ])(
    'drops a pick on an open-region $kind and fails, through canEndChapter',
    async ({ endEntryId }) => {
      hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
      generationStore.setPendingClose('b1', { endEntryId })
      await expectRefused()
      expect(pickOn('b1')).toBeUndefined()
    },
  )

  it("drops only its own branch's stale pick", async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e99' })
    generationStore.setPendingClose('b2', { endEntryId: 'e5' })
    await expectRefused()
    expect(pickOn('b1')).toBeUndefined()
    expect(pickOn('b2')).toEqual({ endEntryId: 'e5' })
  })
})

describe('closeBoundaryPhase with no pick', () => {
  it('ends on the latest reply before the head, past a system row', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(chapterRows()).toBe(0)
  })

  it('ends on the head when no reply comes before it', async () => {
    hydrateEntries(phaseDb, 'b1', AFTER_A_CHAPTER)
    await expectEndsOn(phaseCtx(), { startEntryId: 'e4', endEntryId: 'e5' })
  })

  it("reads its own branch's record, not another's", async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b2', { endEntryId: 'e3' })
    await expectEndsOn(phaseCtx(), { startEntryId: 'e1', endEntryId: 'e5' })
    expect(pickOn('b2')).toEqual({ endEntryId: 'e3' })
  })

  // closeOwed owes no close here (C10); the phase still refuses rather than end on a non-reply.
  it.each([
    { name: 'a region with no reply', rows: NO_REPLY },
    { name: 'an empty region', rows: [] as StoryEntry[] },
  ])('refuses $name', async ({ rows }) => {
    hydrateEntries(phaseDb, 'b1', rows)
    await expectRefused()
  })

  // A region written through the action layer, with real counts, as a chained close meets it.
  it('ends a written region on the reply before the newest', async () => {
    const f = await openCloseFixture()
    const ctx = phaseCtx({ db: f.ctx.db, storyId: f.storyId, branchId: f.branchId })
    await expectEndsOn(ctx, { startEntryId: f.entries[0]!.id, endEntryId: f.replyIds.at(-2)! })
  })
})
