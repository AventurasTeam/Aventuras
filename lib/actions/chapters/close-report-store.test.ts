import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { chapters, type CloseReport } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { expectRan, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { __setCloseAgentSlots, NO_CLOSE_TASKS } from '@/lib/pipeline/definitions/close-agent/slots'
import { chaptersStore, generationStore, type StoreChapter } from '@/lib/stores'

import { startCloseChain } from './close-chain'
import { startManualClose } from './start-manual-close'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { loadOpenStory } from '../stories/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

beforeEach(() => {
  resetSingletons()
  __setCloseAgentSlots(NO_CLOSE_TASKS)
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue(metadataReplyResult())
})

afterEach(() => {
  __setCloseAgentSlots(undefined)
  resetSingletons()
  vi.restoreAllMocks()
})

type Reading = { patched: StoreChapter | undefined; hydrated: StoreChapter | undefined }

// The row the patches left beside a fresh hydrate's; the patched rows go back after, so the
// next step of the walk starts from patches alone.
async function readBoth(fx: CloseFixture, chapterId: string): Promise<Reading> {
  const patchedRows = [...chaptersStore.getChapters(fx.branchId).values()]
  const patched = chaptersStore.getById(fx.branchId, chapterId)
  expect(await loadOpenStory(fx.branchId, fx.ctx)).toMatchObject({ status: 'ok' })
  const hydrated = chaptersStore.getById(fx.branchId, chapterId)
  chaptersStore.hydrate(fx.branchId, patchedRows)
  return { patched, hydrated }
}

function expectFlag({ patched, hydrated }: Reading, flag: boolean): void {
  expect(patched).toBeDefined()
  expect(Object.keys(patched ?? {})).not.toContain('closeReport')
  expect(Object.keys(hydrated ?? {})).not.toContain('closeReport')
  expect(patched?.hasCloseReport).toBe(flag)
  // The whole row, so a 0/1 flag from the hydrate or a column the projection lost shows here.
  expect(patched).toEqual(hydrated)
}

// C4: the action beside the flag, on the patched row; expectFlag holds the hydrate to the same row.
function expectReport(reading: Reading, actionId: string): void {
  expectFlag(reading, true)
  expect(reading.patched?.closeReportActionId).toBe(actionId)
}

describe('close_report through chaptersStore (C4)', () => {
  it('keeps the report out of the store through commit, a title save, its undo, CTRL-Z and redo', async () => {
    const fx = await openCloseFixture()
    const tx = expectRan(await startManualClose(fx.branchId, fx.replyIds[2], fx.ctx))
    expect(tx.outcome).toBe('completed')
    const [closed] = await fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, fx.branchId))
    // The flag's true is the column's: the report the close wrote last.
    expect(closed.closeReport).toEqual({
      version: 1,
      actionId: tx.actionId,
      calls: [],
      stopped: [],
      noToolCalls: true,
    })
    expectFlag(await readBoth(fx, closed.id), true)

    const renamed = `${closed.title} (revised)`
    const save = await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: { branchId: fx.branchId, id: closed.id, patch: { title: renamed } },
        },
        actionId: generateId('act'),
        branchId: fx.branchId,
        entryId: null,
      },
      fx.ctx,
    )
    expect(save.status).toBe('ok')
    const saved = await readBoth(fx, closed.id)
    expect(saved.patched?.title).toBe(renamed)
    expectFlag(saved, true)

    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    const unsaved = await readBoth(fx, closed.id)
    expect(unsaved.patched?.title).toBe(closed.title)
    expectFlag(unsaved, true)

    // CTRL-Z of the close reverses its create, so no row is left holding a null report.
    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect(await readBoth(fx, closed.id)).toEqual({ patched: undefined, hydrated: undefined })

    expect(await redoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expectFlag(await readBoth(fx, closed.id), true)
  })

  // A close's create carries no report, so the walk above can't see fullRow lose the column.
  it('lands a report a create carries, in the column and as the store flag', async () => {
    const fx = await openCloseFixture()
    const actionId = generateId('act')
    const id = generateId('chap')
    const report: CloseReport = {
      version: 1,
      actionId,
      calls: [],
      stopped: [],
      noToolCalls: true,
    }
    const created = await applyDeltaAction(
      {
        action: {
          kind: 'createChapter',
          source: 'chapter_close',
          payload: {
            entry: {
              id,
              branchId: fx.branchId,
              sequenceNumber: 1,
              title: 'The Old Sea-dog at the Admiral Benbow',
              summary:
                'A scarred seaman takes a room at the inn and pays Jim to watch for a one-legged sailor.',
              theme: 'Dread arriving at a quiet coast',
              keywords: ['Admiral Benbow', 'Billy Bones'],
              startEntryId: fx.entries[0].id,
              endEntryId: fx.replyIds[0],
              tokenCount: 120,
              closedAt: 1,
              createdAt: 1,
              updatedAt: 1,
              closeReport: report,
            },
          },
        },
        actionId,
        branchId: fx.branchId,
        entryId: fx.replyIds[0],
      },
      fx.ctx,
    )
    expect(created.status).toBe('ok')

    const [row] = await fx.ctx.db.select().from(chapters).where(eq(chapters.id, id))
    expect(row.closeReport).toEqual(report)
    expectFlag(await readBoth(fx, id), true)
  })

  it("follows the report's action through a re-run's commit, its CTRL-Z, a title save and its undo", async () => {
    const fx = await openCloseFixture()
    const close = expectRan(await startManualClose(fx.branchId, fx.replyIds[2], fx.ctx))
    expect(close.outcome).toBe('completed')
    const [chapter] = await fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, fx.branchId))
    expectReport(await readBoth(fx, chapter.id), close.actionId)

    generationStore.setPendingRerun(fx.branchId, { chapterId: chapter.id })
    const end = await startCloseChain(fx.branchId, fx.ctx)
    if ('outcome' in end) throw new Error(`the re-run was refused: ${end.blockedBy}`)
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    const rerun = end.result.actionId
    expect(rerun).not.toBe(close.actionId)
    const committed = await readBoth(fx, chapter.id)
    expectReport(committed, rerun)
    // The story-open hydrate reads it off the column, not a patch.
    expect(committed.hydrated?.closeReportActionId).toBe(rerun)

    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expectReport(await readBoth(fx, chapter.id), close.actionId)

    const save = await applyDeltaAction(
      {
        action: {
          kind: 'updateChapter',
          source: 'user_edit',
          payload: {
            branchId: fx.branchId,
            id: chapter.id,
            patch: { title: `${chapter.title} (revised)` },
          },
        },
        actionId: generateId('act'),
        branchId: fx.branchId,
        entryId: null,
      },
      fx.ctx,
    )
    expect(save.status).toBe('ok')
    expectReport(await readBoth(fx, chapter.id), close.actionId)

    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expectReport(await readBoth(fx, chapter.id), close.actionId)
  })
})
