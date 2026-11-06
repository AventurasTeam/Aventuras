import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { generationStore, resetAllStores } from '@/lib/stores'

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

// A first chapter still open: the opening, two turns, a system row and a turn after it.
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

function phaseCtx(): PhaseContext {
  return {
    actionId: 'act_close',
    abortSignal: new AbortController().signal,
    intermediates: {},
    log: makeLogger('act_close'),
    db: phaseDb.db,
    runInTransaction: async () => undefined,
    storyId: 's1',
    branchId: 'b1',
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

async function expectRefused(): Promise<void> {
  const ctx = phaseCtx()
  const { events, result } = await drain(ctx)
  expect(result).toEqual(refused)
  expect(events).toEqual([])
  expect(ctx.intermediates).toEqual({})
}

describe('closeBoundaryPhase', () => {
  it('refuses when no close is pending on the branch', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    await expectRefused()
  })

  it("reads its own branch's record, not another's", async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b2', { endEntryId: 'e5' })
    await expectRefused()
  })

  // A null end asks for boundary selection, which this phase can't do yet.
  it('refuses a record that names no end entry', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: null })
    await expectRefused()
  })

  // C10: a system entry hard-deletes with no delta, and a held entry is another chapter's.
  it.each([
    { name: 'a system entry', rows: FIRST_CHAPTER_OPEN, endEntryId: 's6' },
    { name: 'an entry a chapter already holds', rows: AFTER_A_CHAPTER, endEntryId: 'e3' },
    { name: 'an entry the branch does not have', rows: FIRST_CHAPTER_OPEN, endEntryId: 'e99' },
  ])('refuses $name as the end: it is not in the open region', async ({ rows, endEntryId }) => {
    hydrateEntries(phaseDb, 'b1', rows)
    generationStore.setPendingClose('b1', { endEntryId })
    await expectRefused()
  })

  // C10: the opening is the rollback floor, and a user_action splits a turn.
  it.each([
    { kind: 'user_action', endEntryId: 'e4' },
    { kind: 'opening', endEntryId: 'e1' },
  ])('refuses an open-region $kind end through canEndChapter', async ({ endEntryId }) => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId })
    await expectRefused()
  })

  it('parks the range from the opening through an ai_reply end, and writes nothing', async () => {
    hydrateEntries(phaseDb, 'b1', FIRST_CHAPTER_OPEN)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    const ctx = phaseCtx()

    const { events, result } = await drain(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    expect(ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY]).toEqual({
      chapterId: expect.stringMatching(/^chap_[0-9a-f-]{36}$/),
      startEntryId: 'e1',
      endEntryId: 'e5',
    })
    expect(chapterRows()).toBe(0)
    // The commit drops the record (finishRun), not this phase.
    expect(generationStore.getTxState().pendingClose.get('b1')).toEqual({ endEntryId: 'e5' })
  })

  it("starts the range after the last chapter's stamps", async () => {
    hydrateEntries(phaseDb, 'b1', AFTER_A_CHAPTER)
    generationStore.setPendingClose('b1', { endEntryId: 'e5' })
    const ctx = phaseCtx()

    expect((await drain(ctx)).result).toEqual({ status: 'completed' })
    expect(ctx.intermediates[CLOSE_RANGE_INTERMEDIATE_KEY]).toMatchObject({
      startEntryId: 'e4',
      endEntryId: 'e5',
    })
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
})
