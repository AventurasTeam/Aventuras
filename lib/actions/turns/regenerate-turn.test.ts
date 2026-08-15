import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, deltas, happenings, storyEntries, type Delta, type StoryEntry } from '@/lib/db'
import { PER_TURN_KIND } from '@/lib/pipeline'
import {
  awaitRunTerminal,
  currentStoryStore,
  entriesStore,
  generationStore,
  hydrateAppSettings,
  undoRedoStore,
} from '@/lib/stores'

import { branchEntries, openStory, sseFetch, WORKING_CONFIG } from './__tests__/fixtures'
import { regenerateTurn } from './regenerate-turn'
import { expectRan, makeHarness, resetSingletons } from '../../pipeline/__tests__/harness'
import { DeltaReplayError, type reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import { undoLastAction } from '../story-entries/undo'

vi.mock('@/lib/retrieval', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { retrievalSuccess } = await import('@/lib/retrieval/__tests__/outcome')
  return { ...actual, runRetrieval: vi.fn(async () => retrievalSuccess()) }
})
vi.mock('../embedder-swap/engine', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, startSwap: vi.fn(async () => 'completed' as const) }
})

// A seam into an individual sweep from inside the real regenerateTurn control
// flow — the only way to observe sweep ordering, or to fail one sweep and not
// the other, without reimplementing the action. `rows` identifies which sweep
// is running; abortRun's unwind goes through reverseReplayDeltas, a different
// export, so it never reaches this one.
const sweepHook = vi.hoisted(() => ({
  onSweep: null as ((rows: readonly { id: string }[]) => void) | null,
}))
// Armed only across the call under test: undo / redo / rollback sweep through
// the same function, so a hook left live would fire on those too.
async function withSweepHook<T>(
  onSweep: NonNullable<typeof sweepHook.onSweep>,
  body: () => Promise<T>,
): Promise<T> {
  sweepHook.onSweep = onSweep
  try {
    return await body()
  } finally {
    sweepHook.onSweep = null
  }
}
vi.mock('../delta/reverse-replay', async (importOriginal) => {
  const actual = await importOriginal<
    Record<string, unknown> & { reverseAndPruneDeltaRows: typeof reverseAndPruneDeltaRows }
  >()
  const hooked: typeof reverseAndPruneDeltaRows = (rows, ctx, extraOps) => {
    sweepHook.onSweep?.(rows)
    return actual.reverseAndPruneDeltaRows(rows, ctx, extraOps)
  }
  return { ...actual, reverseAndPruneDeltaRows: hooked }
})

const ENTRY = (
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  content: string,
): StoryEntry => ({
  id,
  branchId: 'b1',
  position,
  kind,
  content,
  chapterId: null,
  metadata: null,
  createdAt: position,
})

const DELTA = (
  id: string,
  actionId: string,
  targetTable: string,
  targetId: string,
  entryId: string | null,
  source: Delta['source'],
  logPosition: number,
): Delta => ({
  id,
  branchId: 'b1',
  actionId,
  op: 'create' as const,
  targetTable,
  targetId,
  entryId,
  source,
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
})

// opening(1) u1(2) r1(3) u2(4) r2(5); log: turn deltas 1-4, then a catch-up
// classifier pass at 5-6 whose facts anchor to r1 (survives) and r2 (goes).
async function seedTwoTurnsWithCatchUp(ctx: Awaited<ReturnType<typeof makeHarness>>['ctx']) {
  const rows = [
    ENTRY('e_opening', 1, 'opening', 'once upon a time'),
    ENTRY('e_u1', 2, 'user_action', 'I water the horse.'),
    ENTRY('e_r1', 3, 'ai_reply', 'The horse drinks.'),
    ENTRY('e_u2', 4, 'user_action', 'I cross the bridge.'),
    ENTRY('e_r2', 5, 'ai_reply', 'The bridge groans.'),
  ]
  for (const row of rows) await ctx.db.insert(storyEntries).values(row)
  await ctx.db.insert(happenings).values([
    { id: 'h_a', branchId: 'b1', title: 'Horse watered', createdAt: 6, updatedAt: 6 },
    { id: 'h_b', branchId: 'b1', title: 'Bridge crossed', createdAt: 6, updatedAt: 6 },
  ])
  await ctx.db
    .insert(deltas)
    .values([
      DELTA('d_u1', 'act_t1', 'story_entries', 'e_u1', null, 'user_edit', 1),
      DELTA('d_r1', 'act_t1', 'story_entries', 'e_r1', null, 'ai_classifier', 2),
      DELTA('d_u2', 'act_t2', 'story_entries', 'e_u2', null, 'user_edit', 3),
      DELTA('d_r2', 'act_t2', 'story_entries', 'e_r2', null, 'ai_classifier', 4),
      DELTA('d_fa', 'act_cls', 'happenings', 'h_a', 'e_r1', 'periodic_classifier', 5),
      DELTA('d_fb', 'act_cls', 'happenings', 'h_b', 'e_r2', 'periodic_classifier', 6),
    ])
  await ctx.db
    .update(branches)
    .set({
      classifierStatus: {
        state: 'idle',
        lastSuccessAt: 6,
        lastError: null,
        retryCount: 0,
        processedThrough: 5,
      },
    })
    .where(eq(branches.id, 'b1'))
  entriesStore.hydrate('b1', rows)
}

async function watermark(ctx: Awaited<ReturnType<typeof makeHarness>>['ctx']) {
  const [row] = await ctx.db.select().from(branches).where(eq(branches.id, 'b1'))
  return row.classifierStatus?.processedThrough
}

describe('regenerateTurn', () => {
  beforeEach(() => {
    resetSingletons()
    vi.stubGlobal('fetch', sseFetch(['A new take.']))
  })
  afterEach(() => {
    sweepHook.onSweep = null
    vi.unstubAllGlobals()
    resetSingletons()
  })

  it('terminal reply: reverses the take + anchored facts, keeps the user action, streams a fresh-action_id reply', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(expectRan(regen.result).outcome).toBe('completed')

    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => ({ id: r.id, kind: r.kind }))).toEqual([
      { id: 'e_opening', kind: 'opening' },
      { id: 'e_u1', kind: 'user_action' },
      { id: 'e_r1', kind: 'ai_reply' },
      { id: 'e_u2', kind: 'user_action' },
      { id: rows[4].id, kind: 'ai_reply' },
    ])
    expect(rows[4].id).not.toBe('e_r2')
    expect(rows[4].content).toBe('A new take.')
    expect(rows[4].position).toBe(5)

    // Survival anchor: the fact about the surviving turn stays, r2's goes.
    const facts = await ctx.db.select().from(happenings)
    expect(facts.map((f) => f.id)).toEqual(['h_a'])

    // Watermark clamped to position(B) - 1 = position(e_u2).
    expect(await watermark(ctx)).toBe(4)

    // Fresh action_id on the new take; the user action keeps its old group.
    const [newCreate] = await ctx.db
      .select()
      .from(deltas)
      .where(and(eq(deltas.targetId, rows[4].id), eq(deltas.op, 'create')))
    expect(newCreate.actionId).not.toBe('act_t2')
    const [uaCreate] = await ctx.db.select().from(deltas).where(eq(deltas.targetId, 'e_u2'))
    expect(uaCreate.actionId).toBe('act_t2')

    // What the host re-submits on Retry / restores as a draft.
    expect(regen.userActionContent).toBe('I cross the bridge.')
  })

  it('older reply: deeper cascade through the same sweep, regenerating from that action', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r1', ctx)

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(expectRan(regen.result).outcome).toBe('completed')

    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => r.id)).toEqual(['e_opening', 'e_u1', rows[2].id])
    expect(rows[2].kind).toBe('ai_reply')
    expect(rows[2].content).toBe('A new take.')
    expect(await ctx.db.select().from(happenings)).toEqual([])
    // Clamped to position(e_r1) - 1, one turn deeper than the terminal case.
    expect(await watermark(ctx)).toBe(2)
  })

  it('mid-stream failure: follow-up sweep unwinds the standing user action (M2 contract)', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(expectRan(regen.result).outcome).toBe('failed')
    expect(regen.userActionContent).toBe('I cross the bridge.')
    // The unwind landed, so the text is safe to offer as a retryable submission.
    expect(regen.converged).toBe(true)

    // No orphan placeholder, no stranded user action: log at the fully unwound
    // state — turn 1 intact, its catch-up fact spared.
    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => r.id)).toEqual(['e_opening', 'e_u1', 'e_r1'])
    const facts = await ctx.db.select().from(happenings)
    expect(facts.map((f) => f.id)).toEqual(['h_a'])
    // First sweep clamps to 4 (pos(e_r2)-1); follow-up clamps to 3 (pos(e_u2)-1).
    expect(await watermark(ctx)).toBe(3)
  })

  it('cancel mid-regen: aborted outcome also unwinds the standing user action', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    let callStarted!: () => void
    const started = new Promise<void>((r) => {
      callStarted = r
    })
    // The composer's Send -> Cancel as it actually lands: the provider request
    // hangs until the run's own signal aborts it. createFetchWithCapture folds
    // init into a Request before delegating, so any stub here reads the signal
    // off the request and never off an init bag.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const signal = new Request(input, init).signal
        return new Promise<Response>((_resolve, reject) => {
          const fail = () => reject(new DOMException('Aborted', 'AbortError'))
          if (signal.aborted) return fail()
          signal.addEventListener('abort', fail, { once: true })
          callStarted()
        })
      }) as unknown as typeof fetch,
    )

    const regen = regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)
    await started
    await awaitRunTerminal(PER_TURN_KIND, 'b1', 'cancel')
    const settled = await regen

    expect(settled.status).toBe('ran')
    if (settled.status !== 'ran') return
    expect(expectRan(settled.result).outcome).toBe('aborted')
    expect(settled.userActionContent).toBe('I cross the bridge.')
    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => r.id)).toEqual(['e_opening', 'e_u1', 'e_r1'])
  })

  it('drains an in-flight classifier before the sweep (C3 bracket)', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const order: string[] = []
    let resolveTerminal!: () => void
    const terminal = new Promise<void>((r) => {
      resolveTerminal = r
    })
    const abortController = new AbortController()
    abortController.signal.addEventListener('abort', () => {
      order.push('classifier-aborted')
      // The orchestrator deregisters the run and resolves its terminal only
      // after its own unwind, so a bracket that aborted without AWAITING the
      // terminal would reach the sweep before 'classifier-drained' lands.
      setTimeout(() => {
        order.push('classifier-drained')
        generationStore.abortRun('run_c')
        resolveTerminal()
      }, 0)
    })
    generationStore.startRun({
      runId: 'run_c',
      kind: PERIODIC_CLASSIFIER_KIND,
      gateBehavior: 'no-gate',
      actionId: 'act_live',
      storyId: 's1',
      branchId: 'b1',
      abortController,
      currentPhase: '',
      intermediates: {},
      terminal,
      resolveTerminal,
    })

    const regen = await withSweepHook(
      () => order.push('swept'),
      () => regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx),
    )
    order.push('regen-settled')

    expect(order).toEqual(['classifier-aborted', 'classifier-drained', 'swept', 'regen-settled'])
    expect(regen.status).toBe('ran')
    // Committed catch-up facts about surviving turns are untouched by the drain.
    const facts = await ctx.db.select().from(happenings)
    expect(facts.map((f) => f.id)).toEqual(['h_a'])
  })

  it('rejects a non-AI target without destroying anything', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_u2', ctx)

    expect(regen).toEqual({ status: 'rejected', reason: 'target is not an AI reply' })
    expect(branchEntries('b1')).toHaveLength(5)
  })

  it('refuses while a swap is pending, before any reversal', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    const open = currentStoryStore.getCurrentStory()
    if (open == null) throw new Error('story not open')
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, embedding_swap_target: 'bge-m3' },
    })

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    expect(regen).toEqual({ status: 'rejected', reason: 'embedder-swap' })
    expect(entriesStore.getById('e_r2')).toBeDefined()
  })

  it('clears the redo stack (a regenerate is a new unrelated action)', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    undoRedoStore.pushRedoGroup([])
    expect(undoRedoStore.hasRedo()).toBe(true)

    await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  // Where clearing eagerly earns its keep: a failed run writes no delta, so
  // applyDeltaAction's choke-point clear never fires — yet the sweep has already
  // pruned the rows a stale redo snapshot would try to re-apply.
  it('clears the redo stack even when the regenerate fails', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    undoRedoStore.pushRedoGroup([])

    const regen = await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(expectRan(regen.result).outcome).toBe('failed')
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('CTRL-Z after a completed regenerate undoes the new take, keeping the user action', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    await regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx)

    const undo = await undoLastAction('b1', ctx)

    expect(undo.status).toBe('ok')
    const rows = branchEntries('b1').sort((a, b) => a.position - b.position)
    expect(rows.map((r) => r.id)).toEqual(['e_opening', 'e_u1', 'e_r1', 'e_u2'])
  })

  // d_u2 — the surviving user_action's create delta — appears only in the
  // FOLLOW-UP sweep's row set; the first sweep never reaches back past the reply.
  const isFollowUpSweep = (rows: readonly { id: string }[]) => rows.some((r) => r.id === 'd_u2')

  async function regenerateWithFailingUnwind(error: Error) {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const attempted: boolean[] = []
    const regen = withSweepHook(
      (rows) => {
        attempted.push(isFollowUpSweep(rows))
        if (isFollowUpSweep(rows)) throw error
      },
      () => regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx),
    )
    return { attempted, regen }
  }

  it('keeps the run result and the user text when the follow-up unwind fails', async () => {
    const { attempted, regen } = await regenerateWithFailingUnwind(
      new DeltaReplayError('Reverse-and-prune failed', {
        cause: new Error('database is locked'),
        actionId: 'act_t2',
      }),
    )

    const settled = await regen

    // Attempted and thrown, not skipped — the assertions below would also hold
    // if no follow-up sweep had run at all.
    expect(attempted).toEqual([false, true])
    expect(settled.status).toBe('ran')
    if (settled.status !== 'ran') return
    expect(expectRan(settled.result).outcome).toBe('failed')
    // The two halves the host needs for Retry / draft-restore survive an unwind
    // that could not land — and the un-unwound user_action is still standing.
    expect(settled.userActionContent).toBe('I cross the bridge.')
    expect(entriesStore.getById('e_u2')).toBeDefined()
    // The flag the host reads to refuse Retry: offering this text while the
    // action still stands would insert a second identical user_action.
    expect(settled.converged).toBe(false)
  })

  it('reports no convergence when the follow-up sweep is refused', async () => {
    const { ctx, db } = await makeHarness()
    await seedTwoTurnsWithCatchUp(ctx)
    await openStory(db, 's1', 'b1')
    await hydrateAppSettings(async () => WORKING_CONFIG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    // Drop the user_action's create delta during the first sweep, which never
    // touches it: the follow-up then resolves no rollback window and is refused
    // outright, reversing nothing — the arm that leaves the action standing
    // without ever raising a DeltaReplayError.
    const regen = await withSweepHook(
      (rows) => {
        if (!isFollowUpSweep(rows))
          void ctx.db.delete(deltas).where(eq(deltas.targetId, 'e_u2')).run()
      },
      () => regenerateTurn({ storyId: 's1', branchId: 'b1' }, 'e_r2', ctx),
    )

    expect(regen.status).toBe('ran')
    if (regen.status !== 'ran') return
    expect(regen.converged).toBe(false)
    // The refusal reversed nothing, so the action really is still there.
    expect(branchEntries('b1').map((r) => r.id)).toContain('e_u2')
  })

  it('reports convergence when the failed unwind had already committed', async () => {
    // committed means the reversal landed and only the store sync threw, so the
    // user_action is gone. The hook throws ahead of the sweep, so the harness DB
    // cannot show that — `converged` tracking `committed` is what is pinned here.
    const { regen } = await regenerateWithFailingUnwind(
      new DeltaReplayError('Post-commit patch sync failed', {
        cause: new Error('patcher exploded'),
        actionId: 'act_t2',
        committed: true,
      }),
    )

    const settled = await regen

    expect(settled.status).toBe('ran')
    if (settled.status !== 'ran') return
    expect(settled.converged).toBe(true)
  })

  it('propagates a non-DeltaReplayError thrown by the follow-up unwind', async () => {
    const { attempted, regen } = await regenerateWithFailingUnwind(
      new Error('unknown target_table lore'),
    )

    await expect(regen).rejects.toThrow('unknown target_table lore')
    expect(attempted).toEqual([false, true])
  })
})
