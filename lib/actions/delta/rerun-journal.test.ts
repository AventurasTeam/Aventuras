import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { chapterDraftFrom } from '@/lib/chapters'
import {
  happeningInvolvements,
  happenings,
  parseRerunJournal,
  pipelineRuns,
  reversalJournals,
  type Delta,
  type NewEntity,
  type RerunJournal,
} from '@/lib/db'
import type { CloseFixture } from '@/lib/pipeline/definitions/__tests__/close-fixture'

import { DeltaReplayError } from './replay-errors'
import { reverseCloseForRerun } from './rerun-journal'
import { reverseAndPruneDeltaRows } from './reverse-replay'
import {
  ASKED,
  ASKED_CAST,
  chapterRows,
  CLOSE_LORE_ID,
  CLOSED_AT,
  closeOn,
  deltasOf,
  describeTobin,
  editLore,
  END_REPLY,
  entityOf,
  entryRows,
  installChapterDeleteHooks,
  LATER_DESCRIPTION,
  logRows,
  loreCreate,
  MERGED_DESCRIPTION,
  mergeCopyId,
  openClosed,
  openSeeded,
  seedHappeningPair,
  seedRunMarker,
  SEEDED_AT,
  THREAD_ABSORBED,
  THREAD_KEPT,
  TOBIN,
  TOBIN_CLOSE_DESCRIPTION,
  TOLD,
  worldRows,
  WREN,
  writeCloseReport,
  writeCloseWork,
  writeHappeningMerge,
  writeLater,
  writeUnderAction,
  type ClosedChapter,
} from '../chapters/__tests__/chapter-delete-fixture'
import { removeChapter } from '../chapters/remove-chapter'
import { saveChapter } from '../chapters/save-chapter'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import { resolveSweep, rollbackToEntry } from '../story-entries/operational'
import type { PipelineAction } from '../types'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

installChapterDeleteHooks(generateStructuredMock)

const RERUN = 'act_rerun'
const RERUN_2 = 'act_rerun_2'
const USER_LORE = 'act_user_lore'
const USER_TOBIN = 'act_user_tobin'
const USER_PAIR = 'act_user_pair'
const USER_DELETE = 'act_user_delete'

// C1: a close writes no entries, so its deltas there are the chapter row, the report and the stamps.
const DIVIDER_TABLES: ReadonlySet<string> = new Set(['chapters', 'story_entries'])

// A row only the turns after E know: turn 4's classifier creates her before any close.
const MIRA: Omit<NewEntity, 'branchId'> = {
  id: 'char_mira',
  kind: 'character',
  name: 'Mira',
  description: 'The toll guard at the far bank.',
  status: 'active',
  injectionMode: 'auto',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
}

const closePairView = (branchId: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'chapter_close',
  payload: {
    branchId,
    subjectId: TOBIN.id,
    objectId: WREN.id,
    kind: 'ferries',
    proseEntryId: null,
  },
})

const userPairView = (branchId: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'user_edit',
  payload: { branchId, subjectId: TOBIN.id, objectId: WREN.id, kind: 'trusts', inverseKind: null },
})

const deleteKeptThread = (branchId: string): PipelineAction => ({
  kind: 'deleteThread',
  source: 'user_edit',
  payload: { branchId, id: THREAD_KEPT.id },
})

const shapeOf = (d: Delta): string => `${d.op} ${d.targetTable}:${d.targetId}`
const keyOf = (row: { table: string; id: string }): string => `${row.table}:${row.id}`
const sortedById = <T extends Record<string, unknown>>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
const rerunLoreId = (actionId: string): string => `lore_${actionId}`

/** The close's tool work, a merge_happenings beside it, and the user's later edit of its lore row. */
async function workedClose(): Promise<ClosedChapter> {
  const fx = await openSeeded()
  await seedHappeningPair(fx)
  const c = await closeOn(fx, fx.replyIds[END_REPLY])
  await writeCloseWork(c)
  await writeHappeningMerge(fx, { actionId: c.actionId, entryId: c.endEntryId })
  await writeLater(
    fx,
    editLore(
      fx.branchId,
      CLOSE_LORE_ID,
      'The Harrow ferry runs only on Tobin’s word.',
      'user_edit',
    ),
    { actionId: USER_LORE, entryId: null },
  )
  return c
}

/** The re-run's `reversal` phase: the run's open marker, then the journaled reversal. */
async function reverseForRerun(c: ClosedChapter, actionId = RERUN): Promise<number> {
  await seedRunMarker(c.fx, { runId: `run_${actionId}`, actionId, startedAt: CLOSED_AT + 1 })
  const { floor } = await reverseCloseForRerun(
    { branchId: c.fx.branchId, chapterId: c.chapter.id, actionId },
    c.fx.ctx,
  )
  return floor
}

/** A re-run's own lore row, then its report, its last write. */
async function rerunWrites(c: ClosedChapter, actionId = RERUN): Promise<void> {
  await writeUnderAction(c, actionId, [
    loreCreate(c.fx.branchId, rerunLoreId(actionId), 'The night ferry'),
  ])
  await writeCloseReport(c, actionId)
}

async function journalRows(fx: CloseFixture) {
  return fx.ctx.db
    .select()
    .from(reversalJournals)
    .where(eq(reversalJournals.branchId, fx.branchId))
    .orderBy(asc(reversalJournals.actionId))
}

async function journalOf(fx: CloseFixture, actionId: string): Promise<RerunJournal> {
  const [row] = await fx.ctx.db
    .select()
    .from(reversalJournals)
    .where(and(eq(reversalJournals.branchId, fx.branchId), eq(reversalJournals.actionId, actionId)))
  if (!row) throw new Error(`no journal for ${actionId}`)
  return parseRerunJournal(row.journal)
}

async function happeningRows(fx: CloseFixture) {
  return fx.ctx.db
    .select()
    .from(happenings)
    .where(eq(happenings.branchId, fx.branchId))
    .orderBy(asc(happenings.id))
}

/** Every row a close's lore work can write here, keyed `table:id` as the journal keys them. */
async function rowsByKey(fx: CloseFixture): Promise<Map<string, unknown>> {
  const world = await worldRows(fx)
  const involvements = await fx.ctx.db
    .select()
    .from(happeningInvolvements)
    .where(eq(happeningInvolvements.branchId, fx.branchId))
  const keyed = (table: string, rows: readonly { id: string }[]) =>
    rows.map((row) => [`${table}:${row.id}`, row] as const)
  return new Map<string, unknown>([
    ...keyed('entities', world.entities),
    ...keyed('lore', world.lore),
    ...keyed('threads', world.threads),
    ...keyed('happenings', await happeningRows(fx)),
    ...keyed('happening_involvements', involvements),
  ])
}

/** The close's update of the chapter row with its report: its group's only `chapters` update. */
async function reportOf(c: ClosedChapter): Promise<Delta> {
  const report = (await deltasOf(c.fx, c.actionId)).find(
    (d) => d.targetTable === 'chapters' && d.op === 'update',
  )
  if (!report) throw new Error('the close logged no report')
  return report
}

function actionOf(fx: CloseFixture, replyId: string): string {
  const action = fx.entries[fx.entries.findIndex((e) => e.id === replyId) - 1]
  if (!action || action.kind !== 'user_action') throw new Error(`no action before ${replyId}`)
  return action.id
}

const lastReply = (fx: CloseFixture): string => fx.replyIds[fx.replyIds.length - 1]

async function rollBackTo(fx: CloseFixture, targetId: string): Promise<void> {
  const counts = await shownCounts(fx.branchId, targetId, fx.ctx)
  expect(await rollbackToEntry(fx.branchId, targetId, fx.ctx, { expectedCounts: counts })).toEqual({
    status: 'ok',
    counts,
  })
}

describe('reverseCloseForRerun', () => {
  it('reverses the lore work, leaves the chapter, its report and stamps, and journals each before-image', async () => {
    const c = await workedClose()
    const { fx } = c
    const rowsBefore = await rowsByKey(fx)
    const logBefore = await logRows(fx)
    const entriesBefore = await entryRows(fx)
    const pruned = logBefore.filter(
      (d) =>
        (d.actionId === c.actionId && !DIVIDER_TABLES.has(d.targetTable)) ||
        d.actionId === USER_LORE,
    )
    expect(pruned.map(shapeOf)).toEqual([
      `update lore:${CLOSE_LORE_ID}`,
      `delete happenings:${ASKED.id}`,
      `create happening_involvements:${mergeCopyId(c.actionId)}`,
      `update happenings:${TOLD.id}`,
      `delete threads:${THREAD_ABSORBED.id}`,
      `update threads:${THREAD_KEPT.id}`,
      `update entities:${TOBIN.id}`,
      `create lore:${CLOSE_LORE_ID}`,
    ])

    await reverseForRerun(c)

    const world = await worldRows(fx)
    expect(world.lore).toEqual([])
    expect(world.entities.find((row) => row.id === TOBIN.id)?.description).toBe(TOBIN.description)
    expect(world.threads.map((row) => row.id)).toEqual([THREAD_KEPT.id, THREAD_ABSORBED.id])
    expect((await happeningRows(fx)).map((row) => [row.id, row.description])).toEqual([
      [ASKED.id, ASKED.description],
      [TOLD.id, TOLD.description],
    ])
    const askedCast = await fx.ctx.db
      .select({ id: happeningInvolvements.id })
      .from(happeningInvolvements)
      .where(
        and(
          eq(happeningInvolvements.branchId, fx.branchId),
          eq(happeningInvolvements.happeningId, ASKED.id),
        ),
      )
    expect(askedCast.map((row) => row.id).sort()).toEqual(ASKED_CAST.map((cast) => cast.id).sort())
    expect(await logRows(fx)).toEqual(logBefore.filter((d) => !pruned.includes(d)))
    expect(await chapterRows(fx)).toEqual([c.chapter])
    expect(await entryRows(fx)).toEqual(entriesBefore)

    const journal = await journalOf(fx, RERUN)
    expect({
      version: journal.version,
      chapterId: journal.chapterId,
      chapterNumber: journal.chapterNumber,
      journals: journal.journals,
    }).toEqual({
      version: 1,
      chapterId: c.chapter.id,
      chapterNumber: c.chapter.sequenceNumber,
      journals: [],
    })
    expect(journal.rows.map(keyOf).sort()).toEqual(
      [
        `entities:${TOBIN.id}`,
        `happening_involvements:${mergeCopyId(c.actionId)}`,
        ...ASKED_CAST.map((cast) => `happening_involvements:${cast.id}`),
        `happenings:${ASKED.id}`,
        `happenings:${TOLD.id}`,
        `lore:${CLOSE_LORE_ID}`,
        `threads:${THREAD_ABSORBED.id}`,
        `threads:${THREAD_KEPT.id}`,
      ].sort(),
    )
    for (const row of journal.rows)
      expect(row.before, keyOf(row)).toEqual(rowsBefore.get(keyOf(row)) ?? null)
    expect(sortedById(journal.deltas)).toEqual(sortedById(pruned))
  })

  it('records the report as the floor over a pruned edit above it, so the next write lands one above', async () => {
    const c = await workedClose()
    const report = await reportOf(c)
    expect((await logRows(c.fx))[0]?.actionId).toBe(USER_LORE)

    const floor = await reverseForRerun(c)

    expect(floor).toBe(report.logPosition)
    expect((await journalOf(c.fx, RERUN)).floor).toBe(report.logPosition)
    await writeUnderAction(c, RERUN, [
      loreCreate(c.fx.branchId, rerunLoreId(RERUN), 'The night ferry'),
    ])
    expect((await deltasOf(c.fx, RERUN)).map((d) => d.logPosition)).toEqual([
      report.logPosition + 1,
    ])
  })

  it('marks the run as a re-run whose reversal committed', async () => {
    const c = await openClosed()
    await writeCloseWork(c)

    await reverseForRerun(c)

    const [marker] = await c.fx.ctx.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.actionId, RERUN))
    expect(marker?.rerunChapterId).toBe(c.chapter.id)
  })

  it('commits nothing when its journal cannot be written', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await seedRunMarker(c.fx, { runId: `run_${RERUN}`, actionId: RERUN, startedAt: CLOSED_AT + 1 })
    // A row already under the action: the journal's insert, leading the transaction, refuses.
    await c.fx.ctx.db.insert(reversalJournals).values({
      actionId: RERUN,
      branchId: c.fx.branchId,
      journal: {
        version: 1,
        chapterId: c.chapter.id,
        chapterNumber: c.chapter.sequenceNumber,
        floor: 0,
        rows: [],
        deltas: [],
        journals: [],
      },
      createdAt: CLOSED_AT,
    })
    const log = await logRows(c.fx)
    const world = await worldRows(c.fx)

    await expect(
      reverseCloseForRerun(
        { branchId: c.fx.branchId, chapterId: c.chapter.id, actionId: RERUN },
        c.fx.ctx,
      ),
    ).rejects.toBeInstanceOf(DeltaReplayError)

    expect(await logRows(c.fx)).toEqual(log)
    expect(await worldRows(c.fx)).toEqual(world)
    const [marker] = await c.fx.ctx.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.actionId, RERUN))
    expect(marker?.rerunChapterId).toBeNull()
  })

  it('journals a close that changed nothing with its chapter, number and floor alone', async () => {
    const c = await openClosed()
    const report = await reportOf(c)
    const log = await logRows(c.fx)

    expect(await reverseForRerun(c)).toBe(report.logPosition)

    expect(await journalOf(c.fx, RERUN)).toEqual({
      version: 1,
      chapterId: c.chapter.id,
      chapterNumber: c.chapter.sequenceNumber,
      floor: report.logPosition,
      rows: [],
      deltas: [],
      journals: [],
    })
    expect(await logRows(c.fx)).toEqual(log)
  })

  it('journals a surviving later edit as logged before the reversal rewrote it', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })
    const [edit] = await deltasOf(c.fx, USER_TOBIN)
    expect(edit.undoPayload?.description).toBe(TOBIN_CLOSE_DESCRIPTION)

    await reverseForRerun(c)

    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(LATER_DESCRIPTION)
    const [rewritten] = await deltasOf(c.fx, USER_TOBIN)
    expect(rewritten.undoPayload?.description).toBe(TOBIN.description)
    expect((await journalOf(c.fx, RERUN)).deltas).toContainEqual(edit)
  })

  it('journals a held delete as logged before the reversal rewrote its payload', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await writeLater(c.fx, deleteKeptThread(c.fx.branchId), {
      actionId: USER_DELETE,
      entryId: null,
    })
    const [held] = await deltasOf(c.fx, USER_DELETE)
    expect(held.undoPayload?.description).toBe(MERGED_DESCRIPTION)

    await reverseForRerun(c)

    const [rewritten] = await deltasOf(c.fx, USER_DELETE)
    expect(rewritten.undoPayload?.description).toBe(THREAD_KEPT.description)
    expect((await journalOf(c.fx, RERUN)).deltas).toContainEqual(held)
  })

  it('journals a create it re-owns as logged before', async () => {
    const fx = await openSeeded()
    await seedHappeningPair(fx)
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderAction(c, c.actionId, [closePairView(fx.branchId)])
    const [create] = await deltasOf(fx, c.actionId)
    expect(shapeOf(create)).toMatch(/^create character_relationships:/)
    await writeLater(fx, userPairView(fx.branchId), { actionId: USER_PAIR, entryId: null })

    await reverseForRerun(c)

    expect((await logRows(fx)).find((d) => d.id === create.id)).toMatchObject({
      source: 'user_edit',
      entryId: null,
      actionId: USER_PAIR,
    })
    expect((await journalOf(fx, RERUN)).deltas).toContainEqual(create)
  })

  it("drops an earlier re-run's journal and holds it whole", async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)
    const [first] = await journalRows(c.fx)

    await reverseForRerun(c, RERUN_2)

    expect((await journalRows(c.fx)).map((row) => row.actionId)).toEqual([RERUN_2])
    expect((await journalOf(c.fx, RERUN_2)).journals).toEqual([
      { actionId: RERUN, journal: first.journal, createdAt: first.createdAt },
    ])
  })
})

describe("the planner and a re-run's journal", () => {
  it('drops it with a rollback past E whose closure takes a write of the re-run', async () => {
    const fx = await openSeeded()
    await writeLater(
      fx,
      {
        kind: 'createEntity',
        source: 'ai_classifier',
        payload: { entry: { ...MIRA, branchId: fx.branchId } },
      },
      { actionId: 'act_close_turn_4', entryId: fx.replyIds[3] },
    )
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeCloseWork(c)
    await reverseForRerun(c)
    await writeUnderAction(c, RERUN, [
      {
        kind: 'updateEntity',
        source: 'chapter_close',
        payload: {
          branchId: fx.branchId,
          id: MIRA.id,
          patch: { description: 'The toll guard, who reads every letter twice.' },
        },
      },
    ])
    await writeCloseReport(c, RERUN)

    await rollBackTo(fx, actionOf(fx, fx.replyIds[3]))

    expect((await deltasOf(fx, RERUN)).map(shapeOf)).toEqual([`update chapters:${c.chapter.id}`])
    expect(await journalRows(fx)).toEqual([])
  })

  it('drops it with a rollback of a turn between E and the re-run', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)
    const rerun = await deltasOf(c.fx, RERUN)

    await rollBackTo(c.fx, actionOf(c.fx, lastReply(c.fx)))

    expect(await deltasOf(c.fx, RERUN)).toEqual(rerun)
    expect(await journalRows(c.fx)).toEqual([])
  })

  it('drops it with a regenerate’s sweep, which reverses outside commitNewAction', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)

    // As regenerateTurn's sweepFrom runs it: the resolved sweep straight into the shared reversal.
    const swept = await resolveSweep(c.fx.branchId, actionOf(c.fx, lastReply(c.fx)), c.fx.ctx)
    if ('status' in swept) throw new Error(`sweep refused: ${swept.reason}`)
    await reverseAndPruneDeltaRows(swept.set, c.fx.ctx, { keepRedoExact: false }, swept.clampOps)

    expect(await journalRows(c.fx)).toEqual([])
  })

  it('keeps it through a divider-only removal', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)
    const journals = await journalRows(c.fx)

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await chapterRows(c.fx)).toEqual([])
    expect(await journalRows(c.fx)).toEqual(journals)
  })

  it('keeps it through a divider-only removal that prunes a card Save’s rename below the floor', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const draft = { ...chapterDraftFrom(c.chapter), title: 'The Ferry at Night' }
    expect(await saveChapter({ row: c.chapter, draft }, c.fx.ctx)).toEqual({
      status: 'ok',
      id: c.chapter.id,
    })
    const [rename] = (await logRows(c.fx)).filter((d) => d.source === 'user_edit')
    expect(shapeOf(rename)).toBe(`update chapters:${c.chapter.id}`)
    expect(rename.logPosition).toBeLessThanOrEqual(await reverseForRerun(c))
    await rerunWrites(c)
    const journals = await journalRows(c.fx)

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await deltasOf(c.fx, rename.actionId)).toEqual([])
    expect(await journalRows(c.fx)).toEqual(journals)
  })

  it('drops a report-only re-run’s journal once a divider-only removal takes its last delta', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await writeCloseReport(c, RERUN)
    expect(await journalRows(c.fx)).toHaveLength(1)

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await deltasOf(c.fx, RERUN)).toEqual([])
    expect(await journalRows(c.fx)).toEqual([])
  })
})
