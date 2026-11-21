import { and, asc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { chapterDraftFrom } from '@/lib/chapters'
import {
  characterRelationships,
  deltas,
  happeningInvolvements,
  happenings,
  packFloat32,
  parseRerunJournal,
  pipelineRuns,
  reversalJournals,
  SOURCE_TABLES,
  sourceHash,
  vecRowPk,
  vecTableName,
  type Delta,
  type NewEntity,
  type RerunJournal,
  type SqlOp,
} from '@/lib/db'
import { getDiagnosticsSnapshot } from '@/lib/diagnostics'
import { queryAllOn, type CloseFixture } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { entriesStore, happeningsStore, loreStore } from '@/lib/stores'

import { DeltaReplayError } from './replay-errors'
import {
  rerunWriteBack,
  reverseCloseForRerun,
  reverseRunGroup,
  type RerunWriteBack,
} from './rerun-journal'
import { describeDeltaReplayError, reverseAndPruneDeltaRows } from './reverse-replay'
import { selectReversalSet } from './row-closure'
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
  MERGED_HAPPENING,
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
const PASS_TOBIN = 'act_pass_tobin'

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

/** Every table a re-run's round trip touches, as a deep-equal snapshot of the branch. */
async function fullState(fx: CloseFixture) {
  const { db } = fx.ctx
  return {
    world: await worldRows(fx),
    happenings: await happeningRows(fx),
    involvements: await db
      .select()
      .from(happeningInvolvements)
      .where(eq(happeningInvolvements.branchId, fx.branchId))
      .orderBy(asc(happeningInvolvements.id)),
    pairs: await db
      .select()
      .from(characterRelationships)
      .where(eq(characterRelationships.branchId, fx.branchId))
      .orderBy(asc(characterRelationships.id)),
    chapters: await chapterRows(fx),
    entries: await entryRows(fx),
    log: await logRows(fx),
  }
}

// Every embedded row's flag as the drain leaves it (lesson: staleness flags are cleared by the drain).
async function drainByHand(fx: CloseFixture): Promise<void> {
  await fx.ctx.runInTransaction(
    Object.values(SOURCE_TABLES).map((table) => ({
      sql: `UPDATE ${table} SET embedding_stale = 0 WHERE branch_id = ?`,
      params: [fx.branchId],
    })),
  )
}

const VEC_DIM = 384 // the dim family the migrations create
const VEC_MODEL = 'test-embed-model'

// A happening's stored vector, as the close's range embed leaves one it found stale in the chapter.
function happeningVectorOp(branchId: string, id: string): SqlOp {
  return {
    sql: `INSERT INTO ${vecTableName('happening', VEC_DIM)} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
    params: [
      vecRowPk(branchId, id, VEC_MODEL),
      branchId,
      VEC_MODEL,
      id,
      sourceHash(id),
      packFloat32(new Float32Array(VEC_DIM)),
    ],
  }
}

async function happeningVectorIds(fx: CloseFixture): Promise<string[]> {
  const rows = await queryAllOn(fx.ctx.db)(
    `SELECT id FROM ${vecTableName('happening', VEC_DIM)} WHERE branch_id = ?`,
    [fx.branchId],
  )
  return rows.map(([id]) => String(id)).sort()
}

/** `rerunWrites` with the inn pair merged again between them, as a re-run's happenings task can. */
async function rerunWritesWithMerge(c: ClosedChapter, actionId = RERUN): Promise<void> {
  await writeUnderAction(c, actionId, [
    loreCreate(c.fx.branchId, rerunLoreId(actionId), 'The night ferry'),
  ])
  await writeHappeningMerge(c.fx, { actionId, entryId: c.endEntryId })
  await writeCloseReport(c, actionId)
}

// What each path reversing a re-run's group runs: the group, with the chapter's close groups on the
// fallback, then the write-back's ops after its prunes and its patches after the group's.
async function reverseWithWriteBack(
  fx: CloseFixture,
  actionId: string,
  rerunChapterId?: string,
): Promise<RerunWriteBack> {
  const group = await deltasOf(fx, actionId)
  const writeBack = await rerunWriteBack(
    { actionId, branchId: fx.branchId, group, rerunChapterId },
    fx.ctx,
  )
  const target = new Map(group.map((d) => [d.id, d]))
  if (writeBack.outcome === 'undone') for (const d of writeBack.seed) target.set(d.id, d)
  const set = await selectReversalSet(fx.ctx, {
    branchId: fx.branchId,
    target: [...target.values()].sort((a, b) => b.logPosition - a.logPosition),
  })
  await reverseAndPruneDeltaRows(
    set,
    fx.ctx,
    { keepRedoExact: false },
    writeBack.outcome === 'none' ? [] : writeBack.ops,
    undefined,
    writeBack.outcome === 'restored' ? { patchesAfter: writeBack.patches } : undefined,
  )
  return writeBack
}

const undoneLogLevels = (): string[] =>
  getDiagnosticsSnapshot()
    .logEntries.filter((e) => e.kind === 'action_layer.rerun_close_undone')
    .map((e) => e.level)

describe('rerunWriteBack', () => {
  it('restores every row and delta row the re-run’s reversal touched, positions included', async () => {
    const c = await workedClose()
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)

    expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({ outcome: 'restored' })

    expect(await fullState(c.fx)).toEqual(before)
    expect(await journalRows(c.fx)).toEqual([])
  })

  it('puts back the delta rows the reversal edited in place: a held delete and a re-owned create', async () => {
    const fx = await openSeeded()
    await seedHappeningPair(fx)
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeCloseWork(c)
    await writeUnderAction(c, c.actionId, [closePairView(fx.branchId)])
    await writeLater(fx, userPairView(fx.branchId), { actionId: USER_PAIR, entryId: null })
    await writeLater(fx, deleteKeptThread(fx.branchId), { actionId: USER_DELETE, entryId: null })
    const before = await fullState(fx)
    await reverseForRerun(c)
    await rerunWrites(c)

    expect(await reverseWithWriteBack(fx, RERUN)).toMatchObject({ outcome: 'restored' })

    expect(await fullState(fx)).toEqual(before)
  })

  it('deletes a row its reversal brought back and sweeps its vectors, before the first own write', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await c.fx.ctx.runInTransaction([happeningVectorOp(c.fx.branchId, ASKED.id)])
    expect(await happeningVectorIds(c.fx)).toEqual([ASKED.id])

    expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({ outcome: 'restored' })

    expect((await happeningRows(c.fx)).map((row) => row.id)).toEqual([TOLD.id])
    expect(await happeningVectorIds(c.fx)).toEqual([])
  })

  it('flags every restored embedded row stale over a drain that ran before the re-run and after it', async () => {
    const c = await workedClose()
    // Before the re-run, so its before-images read clean; after its commit, as every run_complete does.
    await drainByHand(c.fx)
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    await drainByHand(c.fx)

    await reverseWithWriteBack(c.fx, RERUN)

    const world = await worldRows(c.fx)
    expect({
      lore: world.lore.find((row) => row.id === CLOSE_LORE_ID)?.embeddingStale,
      entity: world.entities.find((row) => row.id === TOBIN.id)?.embeddingStale,
      thread: world.threads.find((row) => row.id === THREAD_KEPT.id)?.embeddingStale,
      happening: (await happeningRows(c.fx)).find((row) => row.id === TOLD.id)?.embeddingStale,
      store: loreStore.getById(CLOSE_LORE_ID)?.embeddingStale,
    }).toEqual({ lore: 1, entity: 1, thread: 1, happening: 1, store: 1 })
    // No drain runs after the write-back: it would clear the flag this reads.
  })

  it('emits its patches after the group’s, so a loser merged again ends absent from its store', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    expect(happeningsStore.getById(ASKED.id)).toBeUndefined()
    const patched = vi.spyOn(happeningsStore, 'patch')

    await reverseWithWriteBack(c.fx, RERUN)

    expect(
      patched.mock.calls.filter(([, patch]) => patch.id === ASKED.id).map(([, patch]) => patch.op),
    ).toEqual(['create', 'delete'])
    expect(happeningsStore.getById(ASKED.id)).toBeUndefined()
    expect(happeningsStore.getById(TOLD.id)?.description).toBe(MERGED_HAPPENING)
  })

  it('undoes the close altogether when a delta outside the group sits above the floor', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })

    const result = await reverseWithWriteBack(c.fx, RERUN)
    expect(result).toMatchObject({ outcome: 'undone', chapterNumber: c.chapter.sequenceNumber })
    // The caller holds the group itself, so the seed is the chapter's other close groups only.
    expect(result.outcome === 'undone' ? result.seed.map((d) => d.actionId) : []).not.toContain(
      RERUN,
    )

    expect(await chapterRows(c.fx)).toEqual([])
    expect((await entryRows(c.fx)).map((e) => e.chapterId)).toEqual(c.fx.entries.map(() => null))
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
    expect(await journalRows(c.fx)).toEqual([])
    expect(undoneLogLevels()).toEqual(['warn'])
  })

  it('undoes the close when the group’s positions skip one', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    const [report] = await deltasOf(c.fx, RERUN)
    expect(shapeOf(report)).toBe(`update chapters:${c.chapter.id}`)
    // A gap no writer leaves: the report moved one position up.
    await c.fx.ctx.db
      .update(deltas)
      .set({ logPosition: report.logPosition + 1 })
      .where(eq(deltas.id, report.id))

    expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({
      outcome: 'undone',
      chapterNumber: c.chapter.sequenceNumber,
    })

    expect(await chapterRows(c.fx)).toEqual([])
  })

  it('restores the first close’s lore after a divider-only removal, with no chapter row', async () => {
    const c = await workedClose()
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({ outcome: 'restored' })

    const after = await fullState(c.fx)
    expect({
      world: after.world,
      happenings: after.happenings,
      involvements: after.involvements,
    }).toEqual({
      world: before.world,
      happenings: before.happenings,
      involvements: before.involvements,
    })
    expect(after.chapters).toEqual([])
    expect(await deltasOf(c.fx, c.actionId)).toEqual(
      before.log.filter((d) => d.actionId === c.actionId && !DIVIDER_TABLES.has(d.targetTable)),
    )
    expect(await journalRows(c.fx)).toEqual([])
  })

  it('reports the chapter’s number from the journal on a fallback after a divider-only removal', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })

    expect(await reverseWithWriteBack(c.fx, RERUN)).toEqual({
      outcome: 'undone',
      seed: [],
      ops: [expect.anything()],
      chapterNumber: c.chapter.sequenceNumber,
    })

    expect(await deltasOf(c.fx, RERUN)).toEqual([])
    expect(await journalRows(c.fx)).toEqual([])
  })

  it('recognises a re-run by its shape once a sweep dropped its journal, and undoes the close', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)
    await rollBackTo(c.fx, actionOf(c.fx, lastReply(c.fx)))
    expect(await journalRows(c.fx)).toEqual([])

    expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({
      outcome: 'undone',
      ops: [],
      chapterNumber: c.chapter.sequenceNumber,
    })

    expect(await chapterRows(c.fx)).toEqual([])
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
  })

  it('reverses the group alone, with no number, when the marker names a chapter whose row and journal are gone', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)
    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    // As a sweep from below drops it once the divider is gone.
    await c.fx.ctx.db.delete(reversalJournals).where(eq(reversalJournals.actionId, RERUN))
    const group = await deltasOf(c.fx, RERUN)
    expect(
      await rerunWriteBack({ actionId: RERUN, branchId: c.fx.branchId, group }, c.fx.ctx),
    ).toEqual({ outcome: 'none' })

    expect(await reverseWithWriteBack(c.fx, RERUN, c.chapter.id)).toEqual({
      outcome: 'undone',
      seed: [],
      ops: [],
      chapterNumber: null,
    })

    expect(await deltasOf(c.fx, RERUN)).toEqual([])
    expect(undoneLogLevels()).toEqual(['warn'])
  })

  it('reads a close’s own group, a user’s edit and a pass on the end entry as no re-run', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })
    // Anchored where a re-run anchors, with no chapters create: only its source tells it apart.
    await writeLater(
      c.fx,
      describeTobin(c.fx.branchId, TOBIN_CLOSE_DESCRIPTION, 'per_turn_classifier'),
      { actionId: PASS_TOBIN, entryId: c.endEntryId },
    )
    expect((await deltasOf(c.fx, PASS_TOBIN)).map((d) => [d.source, d.entryId])).toEqual([
      ['per_turn_classifier', c.endEntryId],
    ])

    for (const actionId of [c.actionId, USER_TOBIN, PASS_TOBIN])
      expect(
        await rerunWriteBack(
          { actionId, branchId: c.fx.branchId, group: await deltasOf(c.fx, actionId) },
          c.fx.ctx,
        ),
        actionId,
      ).toEqual({ outcome: 'none' })
  })

  it.each([
    ['before its first own write', async (): Promise<void> => {}],
    ['after its report', (c: ClosedChapter) => writeCloseReport(c, RERUN)],
  ] as const)(
    'restores a close that changed nothing %s, leaving no journal',
    async (_when, work) => {
      const c = await openClosed()
      const before = await fullState(c.fx)
      await reverseForRerun(c)
      await work(c)

      expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({ outcome: 'restored' })

      expect(await fullState(c.fx)).toEqual(before)
      expect(await journalRows(c.fx)).toEqual([])
    },
  )

  it('puts back an earlier re-run’s journal it held', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await reverseForRerun(c)
    await rerunWrites(c)
    const afterFirst = await fullState(c.fx)
    const journals = await journalRows(c.fx)
    await reverseForRerun(c, RERUN_2)

    expect(await reverseWithWriteBack(c.fx, RERUN_2)).toMatchObject({ outcome: 'restored' })

    expect(await fullState(c.fx)).toEqual(afterFirst)
    expect(await journalRows(c.fx)).toEqual(journals)
  })

  it('stamps the executing branch on every row and delta it puts back, as a fork’s verbatim copy needs', async () => {
    const c = await workedClose()
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    const journal = await journalOf(c.fx, RERUN)
    // A fork copies a journal verbatim, so its rows and deltas still name the branch it came from.
    const copied: RerunJournal = {
      ...journal,
      rows: journal.rows.map((row) =>
        row.before === null ? row : { ...row, before: { ...row.before, branchId: 'br_parent' } },
      ),
      deltas: journal.deltas.map((delta) => ({ ...delta, branchId: 'br_parent' })),
    }
    await c.fx.ctx.db
      .update(reversalJournals)
      .set({ journal: copied })
      .where(eq(reversalJournals.actionId, RERUN))

    expect(await reverseWithWriteBack(c.fx, RERUN)).toMatchObject({ outcome: 'restored' })

    expect(await fullState(c.fx)).toEqual(before)
  })
})

// The marker's settle, as abortRun's rides the reversal's transaction.
const settleMarker = (fx: CloseFixture, actionId: string): SqlOp =>
  fx.ctx.db
    .update(pipelineRuns)
    .set({ finishedAt: CLOSED_AT + 2, outcome: 'aborted' })
    .where(eq(pipelineRuns.actionId, actionId))
    .toSQL()

describe('reverseRunGroup', () => {
  // A store spy that throws would otherwise outlive its test.
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores a journaled group with no delta of its own, telling the settle it reversed something', async () => {
    const c = await workedClose()
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    const heard: boolean[] = []

    expect(
      await reverseRunGroup({ actionId: RERUN, branchId: c.fx.branchId }, c.fx.ctx, (reversed) => {
        heard.push(reversed)
        return [settleMarker(c.fx, RERUN)]
      }),
    ).toEqual({ deltas: 0, journal: 'restored', chapterNumber: null })

    expect(heard).toEqual([true])
    expect(await fullState(c.fx)).toEqual(before)
    expect(await journalRows(c.fx)).toEqual([])
    const [marker] = await c.fx.ctx.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.actionId, RERUN))
    expect(marker?.outcome).toBe('aborted')
  })

  it('restores one with its own writes, counting them', async () => {
    const c = await workedClose()
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)

    expect(await reverseRunGroup({ actionId: RERUN, branchId: c.fx.branchId }, c.fx.ctx)).toEqual({
      deltas: 5,
      journal: 'restored',
      chapterNumber: null,
    })

    expect(await fullState(c.fx)).toEqual(before)
  })

  it('syncs the stores with the journal after the group, so a loser merged again ends absent', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    expect(happeningsStore.getById(ASKED.id)).toBeUndefined()

    await reverseRunGroup({ actionId: RERUN, branchId: c.fx.branchId }, c.fx.ctx)

    expect(happeningsStore.getById(ASKED.id)).toBeUndefined()
    expect(happeningsStore.getById(TOLD.id)?.description).toBe(MERGED_HAPPENING)
  })

  it('puts back the report of a close that changed nothing, aborted before its first write', async () => {
    const c = await openClosed()
    const before = await fullState(c.fx)
    await reverseForRerun(c)

    expect(await reverseRunGroup({ actionId: RERUN, branchId: c.fx.branchId }, c.fx.ctx)).toEqual({
      deltas: 0,
      journal: 'restored',
      chapterNumber: null,
    })

    expect(await fullState(c.fx)).toEqual(before)
    expect(await journalRows(c.fx)).toEqual([])
  })

  it('undoes the close when the check fails, naming the chapter', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })

    expect(
      await reverseRunGroup({ actionId: RERUN, branchId: c.fx.branchId }, c.fx.ctx),
    ).toMatchObject({ journal: 'undone', chapterNumber: c.chapter.sequenceNumber })

    expect(await chapterRows(c.fx)).toEqual([])
    expect(await journalRows(c.fx)).toEqual([])
  })

  it('reverses a group that is no re-run as reverseReplayDeltas does', async () => {
    const c = await openClosed()
    await writeLater(
      c.fx,
      describeTobin(c.fx.branchId, 'The ferryman, as the pass read him.', 'periodic_classifier'),
      { actionId: 'act_pass', entryId: c.fx.replyIds[1] },
    )

    expect(await reverseRunGroup({ actionId: 'act_pass', branchId: null }, c.fx.ctx)).toEqual({
      deltas: 1,
      journal: null,
      chapterNumber: null,
    })

    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(TOBIN.description)
    expect(await deltasOf(c.fx, 'act_pass')).toEqual([])
  })

  it('reads a group that is no re-run once, by its action id', async () => {
    const c = await openClosed()
    await writeLater(
      c.fx,
      describeTobin(c.fx.branchId, 'The ferryman, as the pass read him.', 'periodic_classifier'),
      { actionId: 'act_pass', entryId: c.fx.replyIds[1] },
    )
    const prepare = vi.spyOn(c.fx.sqlite, 'prepare')

    expect(await reverseRunGroup({ actionId: 'act_pass', branchId: null }, c.fx.ctx)).toMatchObject(
      { deltas: 1 },
    )

    expect(
      prepare.mock.calls.filter(([sql]) => sql.includes('where "deltas"."action_id" = ?')),
    ).toHaveLength(1)
  })

  it('tells the settle nothing was reversed for an action that left nothing', async () => {
    const c = await openClosed()
    await seedRunMarker(c.fx, {
      runId: 'run_empty',
      actionId: 'act_empty',
      startedAt: CLOSED_AT + 1,
    })
    const heard: boolean[] = []

    expect(
      await reverseRunGroup({ actionId: 'act_empty', branchId: null }, c.fx.ctx, (reversed) => {
        heard.push(reversed)
        return [
          c.fx.ctx.db.delete(pipelineRuns).where(eq(pipelineRuns.actionId, 'act_empty')).toSQL(),
        ]
      }),
    ).toEqual({ deltas: 0, journal: null, chapterNumber: null })

    expect(heard).toEqual([false])
    expect(
      await c.fx.ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.actionId, 'act_empty')),
    ).toEqual([])
  })

  it('carries a restored journal on the error when only the store sync after the commit fails', async () => {
    const c = await workedClose()
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    vi.spyOn(loreStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error: unknown = await reverseRunGroup(
      { actionId: RERUN, branchId: c.fx.branchId },
      c.fx.ctx,
    ).catch((e: unknown) => e)

    expect(describeDeltaReplayError(error)).toEqual({
      detail: 'Error: store sync boom',
      committed: true,
      refusal: null,
      journal: 'restored',
      chapterNumber: null,
    })
    expect(await fullState(c.fx)).toEqual(before)
  })

  it('carries an undone journal and its chapter on the error when only the store sync fails', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })
    vi.spyOn(entriesStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error: unknown = await reverseRunGroup(
      { actionId: RERUN, branchId: c.fx.branchId },
      c.fx.ctx,
    ).catch((e: unknown) => e)

    expect(describeDeltaReplayError(error)).toEqual({
      detail: 'Error: store sync boom',
      committed: true,
      refusal: null,
      journal: 'undone',
      chapterNumber: c.chapter.sequenceNumber,
    })
    expect(await chapterRows(c.fx)).toEqual([])
  })

  // A rolled-back write-back or undo must read as uncommitted: abortRun leaves it to recovery.
  const lockedCtx = (fx: CloseFixture): CloseFixture['ctx'] => ({
    ...fx.ctx,
    runInTransaction: async () => {
      throw new Error('database is locked')
    },
  })

  it('reports a restore whose transaction never committed as uncommitted, with no journal', async () => {
    const c = await workedClose()
    const before = await fullState(c.fx)
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    const held = await fullState(c.fx)
    expect(held).not.toEqual(before)

    const error: unknown = await reverseRunGroup(
      { actionId: RERUN, branchId: c.fx.branchId },
      lockedCtx(c.fx),
    ).catch((e: unknown) => e)

    expect(describeDeltaReplayError(error)).toEqual({
      detail: 'Error: database is locked',
      committed: false,
      refusal: null,
    })
    expect(await fullState(c.fx)).toEqual(held)
    expect(await journalRows(c.fx)).toHaveLength(1)
  })

  it('reports an undo of the close whose transaction never committed as uncommitted, with no journal', async () => {
    const c = await workedClose()
    await reverseForRerun(c)
    await rerunWritesWithMerge(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: USER_TOBIN,
      entryId: null,
    })
    const held = await fullState(c.fx)
    expect(held.chapters).toHaveLength(1)

    const error: unknown = await reverseRunGroup(
      { actionId: RERUN, branchId: c.fx.branchId },
      lockedCtx(c.fx),
    ).catch((e: unknown) => e)

    expect(describeDeltaReplayError(error)).toEqual({
      detail: 'Error: database is locked',
      committed: false,
      refusal: null,
    })
    expect(await fullState(c.fx)).toEqual(held)
    expect(await journalRows(c.fx)).toHaveLength(1)
  })
})
