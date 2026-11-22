import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRegistrationGuard, DeltaReplayError, registerAllDomains } from '@/lib/actions'
import {
  chapterRows,
  CLOSE_LORE_ID,
  CLOSED_AT,
  deltasOf,
  describeTobin,
  editLore,
  entityOf,
  entryRows,
  installChapterDeleteHooks,
  LATER_DESCRIPTION,
  logRows,
  loreCreate,
  openClosed,
  seedRunMarker,
  TOBIN,
  worldRows,
  writeCloseWork,
  writeLater,
  writeUnderAction,
  type ClosedChapter,
  type WorldRows,
} from '@/lib/actions/chapters/__tests__/chapter-delete-fixture'
import { reverseCloseForRerun } from '@/lib/actions/delta/rerun-journal'
import type { generateStructured } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { deltas, pipelineRuns, reversalJournals, storyEntries } from '@/lib/db'
import { branchSnapshot, cloneBranch } from '@/lib/db/__tests__/two-branch'
import { getDiagnosticsSnapshot } from '@/lib/diagnostics'
import { PER_TURN_KIND, recoverInFlightRuns } from '@/lib/pipeline'
import type { CloseFixture } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { loreStore } from '@/lib/stores'

import { makeHarness, resetSingletons } from './harness'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

async function seedOrphan(
  db: Awaited<ReturnType<typeof makeHarness>>['db'],
  o: { runId: string; actionId: string; startedAt: number },
): Promise<void> {
  await db.insert(pipelineRuns).values({
    runId: o.runId,
    kind: 'per-turn',
    actionId: o.actionId,
    storyId: 's1',
    branchId: 'b1',
    startedAt: o.startedAt,
  })
}

describe('recoverInFlightRuns', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('reverses dirty orphans, deletes clean ones, and reports failures', async () => {
    const { db, ctx } = await makeHarness()

    // dirty orphan A: one create delta on a real row → reverse-replay deletes it
    await seedOrphan(db, { runId: 'run_a', actionId: 'act_a', startedAt: 1 })
    await db.insert(storyEntries).values({
      id: 'entry_a',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'a',
      createdAt: 1,
    })
    await db.insert(deltas).values({
      id: 'delta_a',
      branchId: 'b1',
      entryId: 'entry_a',
      actionId: 'act_a',
      logPosition: 1,
      source: 'ai_classifier',
      targetTable: 'story_entries',
      targetId: 'entry_a',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    // clean orphan B: no deltas → row deleted
    await seedOrphan(db, { runId: 'run_b', actionId: 'act_b', startedAt: 2 })

    // failing orphan C: a delta on an unknown target_table → DeltaReplayError
    await seedOrphan(db, { runId: 'run_c', actionId: 'act_c', startedAt: 3 })
    await db.insert(deltas).values({
      id: 'delta_c',
      branchId: 'b1',
      entryId: null,
      actionId: 'act_c',
      logPosition: 2,
      source: 'ai_classifier',
      targetTable: 'bogus_table',
      targetId: 'x',
      op: 'create',
      undoPayload: null,
      encodingVersion: 1,
      createdAt: 1,
    })

    const report = await recoverInFlightRuns(ctx)

    expect(report.reversed).toEqual([
      { runId: 'run_a', kind: 'per-turn', actionId: 'act_a', storyId: 's1', deltas: 1 },
    ])
    expect(report.failures.map((f) => f.runId)).toEqual(['run_c'])

    // A recovered, its entry reversed
    const [a] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, 'run_a'))
    expect(a.outcome).toBe('recovered')
    expect(a.finishedAt).not.toBeNull()
    expect(
      (await db.select().from(storyEntries).where(eq(storyEntries.id, 'entry_a'))).length,
    ).toBe(0)

    // B deleted
    expect(
      (await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, 'run_b'))).length,
    ).toBe(0)

    // C retained for next boot
    const [c] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, 'run_c'))
    expect(c.finishedAt).toBeNull()

    const logs = getDiagnosticsSnapshot().logEntries
    expect(logs.some((e) => e.kind === 'pipeline.recovered')).toBe(true)
    expect(logs.some((e) => e.kind === 'pipeline.recovery_failed')).toBe(true)
  })

  it('a non-DeltaReplayError during marker cleanup is caught — boot is not blocked', async () => {
    const { db, ctx } = await makeHarness()
    // clean orphan (0 deltas) → triggers the DELETE path
    await seedOrphan(db, { runId: 'run_x', actionId: 'act_x', startedAt: 1 })

    const throwingDb = new Proxy(ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'delete') {
          return () => {
            throw new Error('transient db failure')
          }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })

    const report = await recoverInFlightRuns({ ...ctx, db: throwingDb })

    expect(report.failures.map((f) => f.runId)).toContain('run_x')
    expect(report.reversed).toEqual([])
  })
})

const RERUN = 'act_rerun'
const RERUN_RUN = 'run_rerun'

/** A re-run whose `reversal` phase committed, then the process died: its marker stays open. */
async function crashedRerun(c: ClosedChapter, startedAt = CLOSED_AT + 2): Promise<void> {
  await seedRunMarker(c.fx, { runId: RERUN_RUN, actionId: RERUN, startedAt })
  await reverseCloseForRerun(
    { branchId: c.fx.branchId, chapterId: c.chapter.id, actionId: RERUN },
    c.fx.ctx,
  )
}

async function markerOf(c: ClosedChapter, runId: string) {
  const [marker] = await c.fx.ctx.db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.runId, runId))
  return marker
}

describe('recoverInFlightRuns over a close’s re-run', () => {
  installChapterDeleteHooks(generateStructuredMock)

  it.each([
    ['before its first own write', async (): Promise<void> => {}, 0],
    [
      'after its first own write',
      (c: ClosedChapter) =>
        writeUnderAction(c, RERUN, [
          loreCreate(c.fx.branchId, 'lore_act_rerun', 'The night ferry'),
        ]),
      1,
    ],
  ] as const)(
    'restores the close a re-run left %s, reporting it and marking it recovered',
    async (_when, work, own) => {
      const c = await openClosed()
      await writeCloseWork(c)
      const world = await worldRows(c.fx)
      const log = await logRows(c.fx)
      await crashedRerun(c)
      await work(c)

      // A restart: memory gone, the real port back.
      resetSingletons()
      expect(await recoverInFlightRuns(c.fx.ctx)).toEqual({
        reversed: [
          {
            runId: RERUN_RUN,
            kind: CHAPTER_CLOSE_KIND,
            actionId: RERUN,
            storyId: c.fx.storyId,
            deltas: own,
          },
        ],
        failures: [],
      })

      expect(await worldRows(c.fx)).toEqual(world)
      expect(await logRows(c.fx)).toEqual(log)
      expect(await c.fx.ctx.db.select().from(reversalJournals)).toEqual([])
      expect(await markerOf(c, RERUN_RUN)).toMatchObject({
        outcome: 'recovered',
        rerunChapterId: c.chapter.id,
      })
    },
  )

  it.each([
    ['a later start', CLOSED_AT + 1, CLOSED_AT + 2],
    ['one start, the re-run inserted after', CLOSED_AT + 1, CLOSED_AT + 1],
  ])(
    'restores a re-run before the older pass it journaled, then reverses that pass whole (%s)',
    async (_order, passAt, rerunAt) => {
      const c = await openClosed()
      await writeCloseWork(c)
      const world = await worldRows(c.fx)
      const log = await logRows(c.fx)
      // A pass whose writes committed and whose marker didn't: an orphan, its edit on the close's lore.
      await seedRunMarker(c.fx, {
        runId: 'run_pass',
        actionId: 'act_pass',
        startedAt: passAt,
        kind: PERIODIC_CLASSIFIER_KIND,
      })
      await writeLater(
        c.fx,
        editLore(
          c.fx.branchId,
          CLOSE_LORE_ID,
          'The Harrow ferry, as the pass read it.',
          'periodic_classifier',
        ),
        { actionId: 'act_pass', entryId: c.fx.replyIds[1] },
      )
      await crashedRerun(c, rerunAt)
      expect(await deltasOf(c.fx, 'act_pass')).toEqual([])

      resetSingletons()
      const report = await recoverInFlightRuns(c.fx.ctx)

      expect(report.failures).toEqual([])
      expect(report.reversed.map((run) => [run.runId, run.deltas])).toEqual([
        [RERUN_RUN, 0],
        ['run_pass', 1],
      ])
      expect(await worldRows(c.fx)).toEqual(world)
      expect(await logRows(c.fx)).toEqual(log)
      expect(await markerOf(c, 'run_pass')).toMatchObject({ outcome: 'recovered' })
    },
  )

  it('undoes the close when the check fails, and reports it closeUndone', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await crashedRerun(c)
    await writeUnderAction(c, RERUN, [
      loreCreate(c.fx.branchId, 'lore_act_rerun', 'The night ferry'),
    ])
    // Something outside the re-run logged above its floor before the crash.
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'user_edit'), {
      actionId: 'act_user_tobin',
      entryId: null,
    })

    resetSingletons()
    const { reversed, failures } = await recoverInFlightRuns(c.fx.ctx)

    expect(failures).toEqual([])
    expect(reversed).toEqual([expect.objectContaining({ runId: RERUN_RUN, closeUndone: true })])
    expect(await chapterRows(c.fx)).toEqual([])
    expect((await entryRows(c.fx)).map((e) => e.chapterId)).toEqual(c.fx.entries.map(() => null))
    expect(await c.fx.ctx.db.select().from(reversalJournals)).toEqual([])
  })

  it('undoes the close from the marker when neither journal nor delta is left', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await crashedRerun(c)
    // As a sweep from below the re-run drops its journal after an abort that couldn't commit.
    await c.fx.ctx.db.delete(reversalJournals).where(eq(reversalJournals.actionId, RERUN))
    expect(await deltasOf(c.fx, RERUN)).toEqual([])

    resetSingletons()
    const { reversed, failures } = await recoverInFlightRuns(c.fx.ctx)

    expect(failures).toEqual([])
    expect(reversed).toEqual([expect.objectContaining({ runId: RERUN_RUN, closeUndone: true })])
    expect(await chapterRows(c.fx)).toEqual([])
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
    expect(await markerOf(c, RERUN_RUN)).toMatchObject({ outcome: 'recovered' })
  })

  it('reverses a marked group alone, with no fallback line, when no journal or chapter is left', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const world = await worldRows(c.fx)
    await seedRunMarker(c.fx, { runId: RERUN_RUN, actionId: RERUN, startedAt: CLOSED_AT + 2 })
    await c.fx.ctx.db
      .update(pipelineRuns)
      .set({ rerunChapterId: 'chap_gone' })
      .where(eq(pipelineRuns.runId, RERUN_RUN))
    await writeUnderAction(c, RERUN, [
      loreCreate(c.fx.branchId, 'lore_act_rerun', 'The night ferry'),
    ])
    expect(await c.fx.ctx.db.select().from(reversalJournals)).toEqual([])
    expect(await chapterRows(c.fx)).toHaveLength(1)

    resetSingletons()
    const { reversed, failures } = await recoverInFlightRuns(c.fx.ctx)

    expect(failures).toEqual([])
    expect(reversed).toEqual([
      {
        runId: RERUN_RUN,
        kind: CHAPTER_CLOSE_KIND,
        actionId: RERUN,
        storyId: c.fx.storyId,
        deltas: 1,
      },
    ])
    expect(await worldRows(c.fx)).toEqual(world)
    expect(await chapterRows(c.fx)).toHaveLength(1)
    expect(await markerOf(c, RERUN_RUN)).toMatchObject({ outcome: 'recovered' })
  })

  // The reversal committed and only the store sync threw: the marker is settled, so no later boot
  // reports the run, and this report is the only word of what the failure did.
  describe('when only the store sync after the reversal commits throws', () => {
    // Boot registers the domains before it recovers, and their patchers are what sync the stores.
    const bootWithFailingSync = () => {
      resetSingletons()
      __resetRegistrationGuard()
      registerAllDomains()
      return vi.spyOn(loreStore, 'patch').mockImplementation(() => {
        throw new Error('store sync boom')
      })
    }

    it('reports the failure closeUndone when the close was undone, and no later boot reports it', async () => {
      const c = await openClosed()
      await writeCloseWork(c)
      await crashedRerun(c)
      await writeUnderAction(c, RERUN, [
        loreCreate(c.fx.branchId, 'lore_act_rerun', 'The night ferry'),
      ])
      await c.fx.ctx.db.delete(reversalJournals).where(eq(reversalJournals.actionId, RERUN))

      const sync = bootWithFailingSync()
      const first = await recoverInFlightRuns(c.fx.ctx)

      expect(first.reversed).toEqual([])
      expect(first.failures).toStrictEqual([
        {
          runId: RERUN_RUN,
          kind: CHAPTER_CLOSE_KIND,
          actionId: RERUN,
          storyId: c.fx.storyId,
          error: expect.any(DeltaReplayError),
          committed: true,
          refusal: null,
          closeUndone: true,
        },
      ])
      expect(await chapterRows(c.fx)).toEqual([])
      expect(await markerOf(c, RERUN_RUN)).toMatchObject({ outcome: 'recovered' })

      sync.mockRestore()
      expect(await recoverInFlightRuns(c.fx.ctx)).toEqual({ reversed: [], failures: [] })
    })

    // The marker names a chapter that is gone: the group reverses alone, and no line claims a close.
    it('reports no close undone when the marker names a chapter that is gone', async () => {
      const c = await openClosed()
      await writeCloseWork(c)
      await seedRunMarker(c.fx, { runId: RERUN_RUN, actionId: RERUN, startedAt: CLOSED_AT + 2 })
      await c.fx.ctx.db
        .update(pipelineRuns)
        .set({ rerunChapterId: 'chap_gone' })
        .where(eq(pipelineRuns.runId, RERUN_RUN))
      await writeUnderAction(c, RERUN, [
        loreCreate(c.fx.branchId, 'lore_act_rerun', 'The night ferry'),
      ])

      bootWithFailingSync()
      const { reversed, failures } = await recoverInFlightRuns(c.fx.ctx)

      expect(reversed).toEqual([])
      expect(failures).toStrictEqual([
        {
          runId: RERUN_RUN,
          kind: CHAPTER_CLOSE_KIND,
          actionId: RERUN,
          storyId: c.fx.storyId,
          error: expect.any(DeltaReplayError),
          committed: true,
          refusal: null,
        },
      ])
      expect(await chapterRows(c.fx)).toHaveLength(1)
      expect(await markerOf(c, RERUN_RUN)).toMatchObject({ outcome: 'recovered' })
    })

    it('reports a restored journal as a committed failure, with no close undone', async () => {
      const c = await openClosed()
      await writeCloseWork(c)
      await crashedRerun(c)

      bootWithFailingSync()
      const { reversed, failures } = await recoverInFlightRuns(c.fx.ctx)

      expect(reversed).toEqual([])
      expect(failures).toStrictEqual([
        {
          runId: RERUN_RUN,
          kind: CHAPTER_CLOSE_KIND,
          actionId: RERUN,
          storyId: c.fx.storyId,
          error: expect.any(DeltaReplayError),
          committed: true,
          refusal: null,
        },
      ])
      expect(await chapterRows(c.fx)).toHaveLength(1)
    })
  })

  it('reports no close undone for a failure that never committed, and keeps its marker open', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await crashedRerun(c)
    await c.fx.ctx.db.delete(reversalJournals).where(eq(reversalJournals.actionId, RERUN))
    const locked = {
      ...c.fx.ctx,
      runInTransaction: async () => {
        throw new Error('database is locked')
      },
    }

    resetSingletons()
    const { reversed, failures } = await recoverInFlightRuns(locked)

    expect(reversed).toEqual([])
    expect(failures).toStrictEqual([
      {
        runId: RERUN_RUN,
        kind: CHAPTER_CLOSE_KIND,
        actionId: RERUN,
        storyId: c.fx.storyId,
        error: expect.any(DeltaReplayError),
        refusal: null,
      },
    ])
    expect(await chapterRows(c.fx)).toHaveLength(1)
    expect(await markerOf(c, RERUN_RUN)).toMatchObject({ finishedAt: null })
  })
})

const COPY = 'br_copy'

/** The close fixture's branch copied onto COPY, so one delta id, journal and chapter repeat. */
function cloneToCopy(c: ClosedChapter): void {
  cloneBranch(c.fx.sqlite, c.fx.branchId, COPY)
}

/** The run's marker records COPY, as `beginRun` records the branch a run starts on. */
async function markOnCopy(c: ClosedChapter, runId: string): Promise<void> {
  await c.fx.ctx.db
    .update(pipelineRuns)
    .set({ branchId: COPY })
    .where(eq(pipelineRuns.runId, runId))
}

const onCopy = (c: ClosedChapter): CloseFixture => ({ ...c.fx, branchId: COPY })

const onBranch = (world: WorldRows, branchId: string): WorldRows => ({
  entities: world.entities.map((row) => ({ ...row, branchId })),
  lore: world.lore.map((row) => ({ ...row, branchId })),
  threads: world.threads.map((row) => ({ ...row, branchId })),
})

describe('recoverInFlightRuns on two branches holding one run’s ids', () => {
  installChapterDeleteHooks(generateStructuredMock)

  it('reverses the marker branch’s copy of a turn’s group and leaves the other branch’s', async () => {
    const c = await openClosed()
    const prior = (await entityOf(c.fx, TOBIN.id))?.description
    await seedRunMarker(c.fx, {
      runId: 'run_turn',
      actionId: 'act_turn',
      startedAt: CLOSED_AT + 2,
      kind: PER_TURN_KIND,
    })
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'per_turn_classifier'), {
      actionId: 'act_turn',
      entryId: c.fx.replyIds.at(-1) ?? null,
    })
    cloneToCopy(c)
    await markOnCopy(c, 'run_turn')
    expect((await entityOf(onCopy(c), TOBIN.id))?.description).toBe(LATER_DESCRIPTION)
    const parent = branchSnapshot(c.fx.sqlite, c.fx.branchId)

    resetSingletons()
    expect(await recoverInFlightRuns(c.fx.ctx)).toEqual({
      reversed: [
        {
          runId: 'run_turn',
          kind: PER_TURN_KIND,
          actionId: 'act_turn',
          storyId: c.fx.storyId,
          deltas: 1,
        },
      ],
      failures: [],
    })

    expect((await entityOf(onCopy(c), TOBIN.id))?.description).toBe(prior)
    expect(await deltasOf(onCopy(c), 'act_turn')).toEqual([])
    expect(await markerOf(c, 'run_turn')).toMatchObject({ outcome: 'recovered', branchId: COPY })
    expect(branchSnapshot(c.fx.sqlite, c.fx.branchId)).toEqual(parent)
  })

  it('writes the marker branch’s journal back, though the other branch’s copy sorts first', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const world = await worldRows(c.fx)
    const log = await logRows(c.fx)
    await crashedRerun(c)
    cloneToCopy(c)
    await markOnCopy(c, RERUN_RUN)
    // First by rowid and by branch id: a journal read by action id alone takes the parent's.
    expect(c.fx.branchId < COPY).toBe(true)
    const parent = branchSnapshot(c.fx.sqlite, c.fx.branchId)

    resetSingletons()
    expect(await recoverInFlightRuns(c.fx.ctx)).toEqual({
      reversed: [
        {
          runId: RERUN_RUN,
          kind: CHAPTER_CLOSE_KIND,
          actionId: RERUN,
          storyId: c.fx.storyId,
          deltas: 0,
        },
      ],
      failures: [],
    })

    expect(await worldRows(onCopy(c))).toEqual(onBranch(world, COPY))
    expect(await logRows(onCopy(c))).toEqual(log.map((delta) => ({ ...delta, branchId: COPY })))
    expect(
      await c.fx.ctx.db.select().from(reversalJournals).where(eq(reversalJournals.branchId, COPY)),
    ).toEqual([])
    expect(branchSnapshot(c.fx.sqlite, c.fx.branchId)).toEqual(parent)
  })

  it('undoes the marker branch’s close from its chapter alone and leaves the other branch’s', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await crashedRerun(c)
    // As a sweep from below the re-run drops its journal after an abort that couldn't commit.
    await c.fx.ctx.db.delete(reversalJournals).where(eq(reversalJournals.actionId, RERUN))
    expect(await deltasOf(c.fx, RERUN)).toEqual([])
    cloneToCopy(c)
    await markOnCopy(c, RERUN_RUN)
    expect(await markerOf(c, RERUN_RUN)).toMatchObject({ rerunChapterId: c.chapter.id })
    const parent = branchSnapshot(c.fx.sqlite, c.fx.branchId)

    resetSingletons()
    const { reversed, failures } = await recoverInFlightRuns(c.fx.ctx)

    expect(failures).toEqual([])
    expect(reversed).toEqual([expect.objectContaining({ runId: RERUN_RUN, closeUndone: true })])
    expect(await chapterRows(onCopy(c))).toEqual([])
    expect(await deltasOf(onCopy(c), c.actionId)).toEqual([])
    expect(await chapterRows(c.fx)).toHaveLength(1)
    expect(branchSnapshot(c.fx.sqlite, c.fx.branchId)).toEqual(parent)
  })

  it('deletes a marker that records no branch and has nothing to reverse', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await seedRunMarker(c.fx, {
      runId: 'run_empty',
      actionId: 'act_empty',
      startedAt: CLOSED_AT + 2,
      kind: PER_TURN_KIND,
      branchId: null,
    })
    cloneToCopy(c)
    expect(await markerOf(c, 'run_empty')).toMatchObject({ branchId: null, finishedAt: null })
    const parent = branchSnapshot(c.fx.sqlite, c.fx.branchId)
    const copy = branchSnapshot(c.fx.sqlite, COPY)

    resetSingletons()
    expect(await recoverInFlightRuns(c.fx.ctx)).toEqual({ reversed: [], failures: [] })

    expect(await markerOf(c, 'run_empty')).toBeUndefined()
    expect(branchSnapshot(c.fx.sqlite, c.fx.branchId)).toEqual(parent)
    expect(branchSnapshot(c.fx.sqlite, COPY)).toEqual(copy)
  })
})
