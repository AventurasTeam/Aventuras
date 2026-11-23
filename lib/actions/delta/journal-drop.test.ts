import type { DatabaseSync } from 'node:sqlite'

import { and, desc, eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  chapters,
  deltas,
  entities,
  lore,
  pipelineRuns,
  reversalJournals,
  stories,
  storyEntries,
  type Delta,
  type NewChapter,
  type NewLore,
  type SqlOp,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  __resetDiagnosticsGate,
  clearBuffers,
  configureDiagnosticsGate,
  getDiagnosticsSnapshot,
} from '@/lib/diagnostics'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { journalsToDrop, type JournalHead } from './journal-drop'
import {
  buildReverseAndPrunePlan,
  DeltaReplayError,
  reverseAndPruneDeltaRows,
  reverseReplayDeltas,
} from './reverse-replay'
import { selectReversalSet } from './row-closure'
import type { DbCtx, PipelineAction } from '../types'

const delta = (id: string, logPosition: number, over: Partial<Delta> = {}): Delta => ({
  id,
  branchId: 'b1',
  entryId: null,
  actionId: 'act_other',
  logPosition,
  source: 'periodic_classifier',
  targetTable: 'lore',
  targetId: `lore_${id}`,
  op: 'create',
  undoPayload: null,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

// A re-run whose reversal left position 10 the branch's highest: its own writes start at 11.
const HEAD: JournalHead = { actionId: 'act_rerun', chapterId: 'ch_1', floor: 10 }
const RERUN_LORE = delta('r_lore', 11, { actionId: 'act_rerun', source: 'chapter_close' })
const RERUN_REPORT = delta('r_report', 12, {
  actionId: 'act_rerun',
  source: 'chapter_close',
  op: 'update',
  targetTable: 'chapters',
  targetId: 'ch_1',
  undoPayload: { closeReport: null },
})

type Args = Parameters<typeof journalsToDrop>[0]

const drops = (over: Partial<Args>) =>
  journalsToDrop({
    heads: [HEAD],
    removed: [],
    rewritten: [],
    groups: new Map([['act_rerun', [RERUN_REPORT, RERUN_LORE]]]),
    ...over,
  })

describe('journalsToDrop', () => {
  it('drops nothing for a reversal above the floor that spares the group', () => {
    expect(drops({ removed: [delta('late', 13)], rewritten: [delta('later', 14)] })).toEqual([])
  })

  describe('(a) the set takes a re-run delta outside chapters and story_entries', () => {
    it('drops the journal', () => {
      expect(drops({ removed: [RERUN_LORE] })).toEqual([HEAD])
    })

    it('keeps it when only the report goes and lore remains', () => {
      expect(drops({ removed: [RERUN_REPORT] })).toEqual([])
    })
  })

  describe('(b) the set removes or rewrites a delta at or below the floor', () => {
    it('drops it for a removed delta below the floor', () => {
      expect(drops({ removed: [delta('turn', 5)] })).toEqual([HEAD])
    })

    it('counts the floor itself as below, the position after it not', () => {
      expect(drops({ removed: [delta('at', 10)] })).toEqual([HEAD])
      expect(drops({ removed: [delta('after', 11)] })).toEqual([])
    })

    it('drops it for a held delete below the floor whose payload the set rewrites', () => {
      const holder = delta('holder', 4, { op: 'delete', source: 'user_edit' })
      expect(drops({ rewritten: [holder] })).toEqual([HEAD])
    })

    it('drops it for a survivor below the floor whose prior value the set rewrites', () => {
      const survivor = delta('survivor', 6, { op: 'update' })
      expect(drops({ rewritten: [survivor] })).toEqual([HEAD])
    })

    it("keeps it for any delta on the chapter's own row, a user rename included", () => {
      const rename = delta('rename', 8, {
        actionId: 'act_save',
        source: 'user_edit',
        op: 'update',
        targetTable: 'chapters',
        targetId: 'ch_1',
        undoPayload: { title: 'Chapter 1' },
      })
      const created = delta('created', 1, {
        actionId: 'act_close',
        source: 'chapter_close',
        targetTable: 'chapters',
        targetId: 'ch_1',
      })
      expect(drops({ removed: [rename, created] })).toEqual([])
    })

    it('keeps it for a close stamp on an entry', () => {
      const stamp = delta('stamp', 2, {
        actionId: 'act_close',
        source: 'chapter_close',
        op: 'update',
        targetTable: 'story_entries',
        targetId: 'e_40',
        undoPayload: { chapterId: null },
      })
      expect(drops({ removed: [stamp] })).toEqual([])
    })

    it("drops it for another chapter's row", () => {
      const other = delta('other', 7, {
        source: 'chapter_close',
        op: 'update',
        targetTable: 'chapters',
        targetId: 'ch_0',
      })
      expect(drops({ removed: [other] })).toEqual([HEAD])
    })

    it('drops it for an entry write that is not a stamp', () => {
      const edit = delta('edit', 9, {
        source: 'user_edit',
        op: 'update',
        targetTable: 'story_entries',
        targetId: 'e_40',
        undoPayload: { content: 'The ferry crossed.' },
      })
      expect(drops({ removed: [edit] })).toEqual([HEAD])
    })
  })

  describe('(c) the set takes the group’s last remaining delta', () => {
    it('drops a report-only re-run’s journal when its report goes', () => {
      const groups = new Map([['act_rerun', [RERUN_REPORT]]])
      expect(drops({ groups, removed: [RERUN_REPORT] })).toEqual([HEAD])
    })

    // On the divider tables, so (a) can't fire and only (c) sees it.
    it('drops it when the last delta leaves the log as a pruned holder', () => {
      const holder = delta('r_hold', 11, {
        actionId: 'act_rerun',
        source: 'chapter_close',
        op: 'delete',
        targetTable: 'story_entries',
        targetId: 'e_41',
      })
      expect(drops({ groups: new Map([['act_rerun', [holder]]]), removed: [holder] })).toEqual([
        HEAD,
      ])
    })

    it('drops it when the last delta leaves the log as a stranded write', () => {
      const stranded = delta('r_stranded', 11, {
        actionId: 'act_rerun',
        source: 'chapter_close',
        op: 'update',
        targetTable: 'story_entries',
        targetId: 'e_41',
      })
      expect(drops({ groups: new Map([['act_rerun', [stranded]]]), removed: [stranded] })).toEqual([
        HEAD,
      ])
    })

    it('keeps it when the last delta is only rewritten', () => {
      const groups = new Map([['act_rerun', [RERUN_REPORT]]])
      expect(drops({ groups, rewritten: [RERUN_REPORT] })).toEqual([])
    })

    it('matches nothing for a group already empty', () => {
      const removed = [delta('late', 13)]
      expect(drops({ groups: new Map([['act_rerun', []]]), removed })).toEqual([])
      expect(drops({ groups: new Map(), removed })).toEqual([])
    })
  })

  it('drops only the heads the set makes inexact', () => {
    const earlier: JournalHead = { actionId: 'act_rerun_0', chapterId: 'ch_0', floor: 3 }
    expect(drops({ heads: [earlier, HEAD], removed: [RERUN_LORE] })).toEqual([HEAD])
  })
})

describe('the planner drops a journal its reversal would make inexact', () => {
  let ctx: DbCtx
  let sqlite: DatabaseSync

  const CHAPTER: NewChapter = {
    id: 'ch_1',
    branchId: 'b1',
    sequenceNumber: 1,
    title: 'Chapter 1',
    summary: 'The ferry crosses at dusk.',
    theme: 'crossing',
    startEntryId: 'e1',
    endEntryId: 'e1',
    tokenCount: 10,
    closedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }

  const loreEntry = (id: string): NewLore => ({
    id,
    branchId: 'b1',
    title: id,
    body: 'ash',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })

  beforeEach(async () => {
    generationStore.__reset()
    const t = await createTestDb()
    ctx = { db: t.db, runInTransaction: t.runInTransaction }
    sqlite = t.sqlite
    await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await ctx.db.insert(storyEntries).values({
      id: 'e1',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'The ferry crossed.',
      createdAt: 1,
    })
  })

  afterEach(() => {
    entriesStore.__reset()
    undoRedoStore.__reset()
  })

  async function act(actionId: string, action: PipelineAction): Promise<void> {
    const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
    if (result.status !== 'ok')
      throw new Error(`${action.kind} did not land: ${JSON.stringify(result)}`)
  }

  // Chapter id and floor only: the planner reads no before-image.
  function plantJournal(branchId: string, actionId: string, floor: number): void {
    sqlite
      .prepare(
        'INSERT INTO reversal_journals (action_id, branch_id, journal, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(actionId, branchId, JSON.stringify({ chapterId: 'ch_1', floor }), 1)
  }

  async function deltasOf(...actionIds: string[]): Promise<Delta[]> {
    return (await ctx.db
      .select()
      .from(deltas)
      .where(and(eq(deltas.branchId, 'b1'), inArray(deltas.actionId, actionIds)))
      .orderBy(desc(deltas.logPosition))) as Delta[]
  }

  async function planFor(target: readonly Delta[]) {
    return buildReverseAndPrunePlan(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx, {
      keepRedoExact: false,
    })
  }

  async function reverse(target: readonly Delta[], extraOps: SqlOp[] = []): Promise<number> {
    return reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target }),
      ctx,
      { keepRedoExact: false },
      extraOps,
    )
  }

  async function journalIds(branchId = 'b1'): Promise<string[]> {
    const rows = await ctx.db
      .select({ actionId: reversalJournals.actionId })
      .from(reversalJournals)
      .where(eq(reversalJournals.branchId, branchId))
    return rows.map((r) => r.actionId)
  }

  /**
   * Close, a fact, the user's delete of a second stamped entry if `deletedEntry`, a card rename, a
   * re-run (lore create unless `rerunLore` is false, plus a chapter write as its report), a later
   * turn. The journal's floor is the rename's position.
   */
  async function seed({ rerunLore = true, deletedEntry = false } = {}): Promise<number> {
    if (deletedEntry)
      await ctx.db.insert(storyEntries).values({
        id: 'e2',
        branchId: 'b1',
        position: 2,
        kind: 'ai_reply',
        content: 'The far bank.',
        createdAt: 1,
      })
    await act('act_close', {
      kind: 'createChapter',
      source: 'chapter_close',
      payload: { entry: CHAPTER },
    })
    for (const id of deletedEntry ? ['e1', 'e2'] : ['e1'])
      await act('act_close', {
        kind: 'stampEntryChapter',
        source: 'chapter_close',
        payload: { branchId: 'b1', id, chapterId: 'ch_1' },
      })
    await act('act_turn', {
      kind: 'createLore',
      source: 'periodic_classifier',
      payload: { entry: loreEntry('lore_t') },
    })
    if (deletedEntry)
      await act('act_del', {
        kind: 'deleteStoryEntry',
        source: 'user_edit',
        payload: { branchId: 'b1', id: 'e2' },
      })
    await act('act_save', {
      kind: 'updateChapter',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'ch_1', patch: { title: 'Harrow' } },
    })
    const [rename] = await deltasOf('act_save')
    if (rerunLore)
      await act('act_rerun', {
        kind: 'createLore',
        source: 'chapter_close',
        payload: { entry: loreEntry('lore_r') },
      })
    await act('act_rerun', {
      kind: 'updateChapter',
      source: 'chapter_close',
      payload: { branchId: 'b1', id: 'ch_1', patch: { summary: 'The ferry, retold.' } },
    })
    await act('act_late', {
      kind: 'createLore',
      source: 'periodic_classifier',
      payload: { entry: loreEntry('lore_l') },
    })
    plantJournal('b1', 'act_rerun', rename.logPosition)
    return rename.logPosition
  }

  it('(a) drops it, whole, when the set takes the re-run’s lore', async () => {
    const floor = await seed()
    const rerunLore = (await deltasOf('act_rerun')).filter((d) => d.targetTable === 'lore')

    const plan = await planFor(rerunLore)

    expect(plan.droppedJournals).toEqual([
      {
        actionId: 'act_rerun',
        branchId: 'b1',
        journal: { chapterId: 'ch_1', floor },
        createdAt: 1,
      },
    ])
    await reverse(rerunLore)
    expect(await journalIds()).toEqual([])
    expect(await ctx.db.select().from(lore).where(eq(lore.id, 'lore_r'))).toEqual([])
  })

  it('(b) drops it when the set reverses a turn between the close and the re-run', async () => {
    await seed()
    const turn = await deltasOf('act_turn')

    expect((await planFor(turn)).droppedJournals.map((j) => j.actionId)).toEqual(['act_rerun'])
    await reverse(turn)
    expect(await journalIds()).toEqual([])
  })

  it("(b) keeps it when the set reverses only the card's rename of the chapter", async () => {
    await seed()
    const rename = await deltasOf('act_save')

    expect((await planFor(rename)).droppedJournals).toEqual([])
    await reverse(rename)
    expect(await journalIds()).toEqual(['act_rerun'])
    const [chapter] = await ctx.db.select().from(chapters).where(eq(chapters.id, 'ch_1'))
    expect(chapter.title).toBe('Chapter 1')
  })

  it('(b) keeps it through a divider-only removal that takes the rename and the report', async () => {
    await seed()
    const divider = await deltasOf('act_close')

    const plan = await planFor(divider)

    expect(plan.prunedDeltas.map((d) => d.actionId).sort()).toEqual([
      'act_close',
      'act_close',
      'act_rerun',
      'act_save',
    ])
    expect(plan.droppedJournals).toEqual([])
    await reverse(divider)
    expect(await journalIds()).toEqual(['act_rerun'])
  })

  it("(b) drops it when a divider-only removal rewrites a delete's held entry below the floor", async () => {
    const floor = await seed({ deletedEntry: true })
    const [deleted] = await deltasOf('act_del')
    const divider = await deltasOf('act_close')

    const plan = await planFor(divider)

    expect(deleted.logPosition).toBeLessThan(floor)
    expect(plan.rewrittenHolders).toEqual([deleted])
    // Below the floor it removes only the chapter's own row and the close's stamps.
    expect(plan.prunedDeltas.map((d) => d.actionId).sort()).toEqual([
      'act_close',
      'act_close',
      'act_close',
      'act_rerun',
      'act_save',
    ])
    expect(plan.droppedJournals.map((j) => j.actionId)).toEqual(['act_rerun'])
    await reverse(divider)
    expect(await journalIds()).toEqual([])
  })

  it("(c) drops a report-only re-run's journal when a divider-only removal empties its group", async () => {
    await seed({ rerunLore: false })
    const divider = await deltasOf('act_close')

    const plan = await planFor(divider)

    expect(plan.prunedDeltas.map((d) => d.actionId)).toContain('act_rerun')
    expect(plan.droppedJournals.map((j) => j.actionId)).toEqual(['act_rerun'])
    await reverse(divider)
    expect(await journalIds()).toEqual([])
  })

  it("(a) drops it when the set re-owns a re-run create the user's later view keeps", async () => {
    const character = (id: string) => ({
      id,
      branchId: 'b1',
      kind: 'character' as const,
      name: id,
      status: 'active' as const,
      injectionMode: 'auto' as const,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert(entities).values([character('char_x'), character('char_y')])
    await seed()
    await act('act_rerun', {
      kind: 'upsertCharacterRelationship',
      source: 'chapter_close',
      payload: {
        branchId: 'b1',
        subjectId: 'char_x',
        objectId: 'char_y',
        kind: 'rival',
        proseEntryId: null,
      },
    })
    await act('act_user', {
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        subjectId: 'char_x',
        objectId: 'char_y',
        kind: 'rival',
        inverseKind: 'mentor',
      },
    })
    const created = (await deltasOf('act_rerun')).filter(
      (d) => d.targetTable === 'character_relationships',
    )

    const plan = await planFor(created)

    expect(plan.reownedDeltas).toEqual(created)
    expect(plan.prunedDeltas).toEqual([])
    expect(plan.droppedJournals.map((j) => j.actionId)).toEqual(['act_rerun'])
  })

  it('keeps it when the set reverses a turn after the re-run', async () => {
    await seed()
    const late = await deltasOf('act_late')

    expect((await planFor(late)).droppedJournals).toEqual([])
    await reverse(late)
    expect(await journalIds()).toEqual(['act_rerun'])
  })

  it('drops it in an action replay too', async () => {
    await seed()

    expect(await reverseReplayDeltas('act_turn', ctx)).toBe(1)

    expect(await journalIds()).toEqual([])
    expect(await ctx.db.select().from(lore).where(eq(lore.id, 'lore_t'))).toEqual([])
  })

  describe("reads a journal's group only for a reversal that takes a delta of it", () => {
    // The planner's group read, the one statement it runs on deltas.action_id.
    async function planCountingGroupReads(target: readonly Delta[]) {
      const set = await selectReversalSet(ctx, { branchId: 'b1', target })
      const prepare = vi.spyOn(sqlite, 'prepare')
      try {
        const plan = await buildReverseAndPrunePlan(set, ctx, { keepRedoExact: false })
        const groupReads = prepare.mock.calls.filter(([sql]) =>
          sql.includes('"deltas"."action_id" in ('),
        ).length
        return { dropped: plan.droppedJournals.map((j) => j.actionId), groupReads }
      } finally {
        prepare.mockRestore()
      }
    }

    it('reads none for a turn below the floor, still dropping the journal', async () => {
      await seed()

      expect(await planCountingGroupReads(await deltasOf('act_turn'))).toEqual({
        dropped: ['act_rerun'],
        groupReads: 0,
      })
    })

    it('reads none for a turn after the re-run, keeping the journal', async () => {
      await seed()

      expect(await planCountingGroupReads(await deltasOf('act_late'))).toEqual({
        dropped: [],
        groupReads: 0,
      })
    })

    it('reads it once for a divider-only removal that takes the report', async () => {
      await seed({ rerunLore: false })

      expect(await planCountingGroupReads(await deltasOf('act_close'))).toEqual({
        dropped: ['act_rerun'],
        groupReads: 1,
      })
    })
  })

  it("drops only the reversing branch's journal", async () => {
    await seed()
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 2 })
    plantJournal('b2', 'act_rerun', 100)

    await reverse(await deltasOf('act_turn'))

    expect(await journalIds()).toEqual([])
    expect(await journalIds('b2')).toEqual(['act_rerun'])
  })

  it('keeps it when the reversal does not commit', async () => {
    await seed()
    const marker = (runId: string): SqlOp =>
      ctx.db
        .insert(pipelineRuns)
        .values({ runId, kind: 'chapter-close', actionId: `act_${runId}`, startedAt: 1 })
        .toSQL()
    await ctx.runInTransaction([marker('run_taken')])

    await expect(reverse(await deltasOf('act_turn'), [marker('run_taken')])).rejects.toBeInstanceOf(
      DeltaReplayError,
    )

    expect(await journalIds()).toEqual(['act_rerun'])
    expect(await ctx.db.select().from(lore).where(eq(lore.id, 'lore_t'))).toHaveLength(1)
  })

  // Tells a later rerun_close_undone {journal: 'missing'} a designed drop from a lost journal.
  describe('logs the drop once its reversal commits', () => {
    beforeEach(() => {
      clearBuffers()
      configureDiagnosticsGate({ isEnabled: () => true, isDebugEnabled: () => true })
    })

    afterEach(() => __resetDiagnosticsGate())

    const dropLogs = () =>
      getDiagnosticsSnapshot()
        .logEntries.filter((e) => e.kind === 'action_layer.rerun_journal_dropped')
        .map(({ level, fields, actionId }) => ({ level, fields, actionId }))

    const DROPPED = {
      level: 'debug',
      fields: { branchId: 'b1', journals: ['act_rerun'] },
      actionId: 'act_turn',
    }

    // A second insert of a taken run id fails the reversal's transaction.
    const taken = (): SqlOp =>
      ctx.db
        .insert(pipelineRuns)
        .values({ runId: 'run_taken', kind: 'chapter-close', actionId: 'act_x', startedAt: 1 })
        .toSQL()

    it('from a set reversal', async () => {
      await seed()

      await reverse(await deltasOf('act_turn'))

      expect(dropLogs()).toEqual([DROPPED])
    })

    it('from an action replay', async () => {
      await seed()

      await reverseReplayDeltas('act_turn', ctx)

      expect(dropLogs()).toEqual([DROPPED])
    })

    it('and not for a set reversal that rolls back', async () => {
      await seed()
      await ctx.runInTransaction([taken()])

      await expect(reverse(await deltasOf('act_turn'), [taken()])).rejects.toBeInstanceOf(
        DeltaReplayError,
      )

      expect(await journalIds()).toEqual(['act_rerun'])
      expect(dropLogs()).toEqual([])
    })

    it('and not for an action replay that rolls back', async () => {
      await seed()
      await ctx.runInTransaction([taken()])

      await expect(reverseReplayDeltas('act_turn', ctx, () => [taken()])).rejects.toBeInstanceOf(
        DeltaReplayError,
      )

      expect(await journalIds()).toEqual(['act_rerun'])
      expect(dropLogs()).toEqual([])
    })

    it('and not for a reversal that drops none', async () => {
      await seed()

      await reverse(await deltasOf('act_late'))

      expect(await journalIds()).toEqual(['act_rerun'])
      expect(dropLogs()).toEqual([])
    })
  })
})
