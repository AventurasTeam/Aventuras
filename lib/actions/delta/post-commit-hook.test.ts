import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import {
  branches,
  characterRelationships,
  deltas,
  entities,
  reversalJournals,
  stories,
  storyEntries,
  type CharacterState,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entitiesStore, entriesStore, undoRedoStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { logRewritten, onLogRewritten } from './post-commit-hook'
import { __redoGroupForTest, applyRedo } from './redo'
import { reverseCloseForRerun, reverseRunGroup } from './rerun-journal'
import { DeltaReplayError, reverseAndPruneDeltaRows, reverseReplayDeltas } from './reverse-replay'
import { selectReversalSet } from './row-closure'
import {
  CLOSE_LORE_ID,
  installChapterDeleteHooks,
  openClosed,
  worldRows,
  writeCloseWork,
  writeUnderClose,
} from '../chapters/__tests__/chapter-delete-fixture'
import { updateStoryEntryContent } from '../story-entries/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import type { DbCtx, DeltaSource, PipelineAction } from '../types'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

// The re-run fixture runs a real close, which asks the model for its metadata.
vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

afterEach(() => {
  vi.restoreAllMocks()
  entitiesStore.__reset()
  entriesStore.__reset()
  undoRedoStore.clear('b1')
})

const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'active',
  injectionMode: 'auto',
  state: STATE,
  createdAt: 1,
  updatedAt: 1,
}

async function setup(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  entitiesStore.hydrate('b1', [])
  entriesStore.hydrate('b1', [])
  undoRedoStore.clear('b1')
  return { db, runInTransaction }
}

async function act(ctx: DbCtx, actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

const createKael: PipelineAction = {
  kind: 'createEntity',
  source: 'user_edit',
  payload: { entry: KAEL },
}

const rename = (source: DeltaSource, name: string): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId: 'b1', id: 'char_kael', patch: { name } },
})

async function kaelName(ctx: DbCtx): Promise<string | undefined> {
  const [row] = await ctx.db
    .select({ name: entities.name })
    .from(entities)
    .where(and(eq(entities.branchId, 'b1'), eq(entities.id, 'char_kael')))
  return row?.name
}

// Registered around the call alone: the setup's own reversals are not the case's.
async function heardDuring<T>(
  run: () => Promise<T>,
): Promise<{ heard: string[]; settled: PromiseSettledResult<T> }> {
  const heard: string[] = []
  const off = onLogRewritten((branchId) => {
    heard.push(branchId)
  })
  try {
    const [settled] = await Promise.allSettled([run()])
    return { heard, settled }
  } finally {
    off()
  }
}

function rejectionOf(settled: PromiseSettledResult<unknown>): unknown {
  if (settled.status !== 'rejected') throw new Error(`expected a rejection, got ${settled.status}`)
  return settled.reason
}

type Rewrite = {
  readonly name: string
  /** Lands what the call rewrites, then hands back the call. */
  readonly arrange: (ctx: DbCtx) => Promise<() => Promise<unknown>>
  readonly nameBefore: string
  readonly nameAfter: string
}

const REWRITES: readonly Rewrite[] = [
  {
    name: 'a CTRL-Z, through reverseAndPruneDeltaRows',
    arrange: async (ctx) => {
      await act(ctx, 'act_0', createKael)
      await act(ctx, 'act_u', rename('user_edit', 'Ser Kael'))
      return () => undoLastAction('b1', ctx)
    },
    nameBefore: 'Ser Kael',
    nameAfter: 'Kael',
  },
  {
    name: 'reverseReplayDeltas, through reverseReplayGroup',
    arrange: async (ctx) => {
      await act(ctx, 'act_0', createKael)
      await act(ctx, 'act_pass', rename('periodic_classifier', 'Ser Kael'))
      return () => reverseReplayDeltas('act_pass', ctx)
    },
    nameBefore: 'Ser Kael',
    nameAfter: 'Kael',
  },
  {
    name: 'a redo, through applyRedo',
    arrange: async (ctx) => {
      await act(ctx, 'act_0', createKael)
      await act(ctx, 'act_u', rename('user_edit', 'Ser Kael'))
      expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
      return () => redoLastAction('b1', ctx)
    },
    nameBefore: 'Kael',
    nameAfter: 'Ser Kael',
  },
]

describe('onLogRewritten', () => {
  it('calls each listener in registration order, with the branch', () => {
    const calls: string[] = []
    const offA = onLogRewritten((branchId) => {
      calls.push(`a:${branchId}`)
    })
    const offB = onLogRewritten((branchId) => {
      calls.push(`b:${branchId}`)
    })
    try {
      logRewritten('b1')
    } finally {
      offA()
      offB()
    }
    expect(calls).toEqual(['a:b1', 'b:b1'])
  })

  it('stops calling a listener once it unregisters', () => {
    const listener = vi.fn()
    const off = onLogRewritten(listener)
    off()
    logRewritten('b1')
    expect(listener).not.toHaveBeenCalled()
  })

  it('calls a function registered twice twice, until both registrations unregister', () => {
    const listener = vi.fn()
    const first = onLogRewritten(listener)
    const second = onLogRewritten(listener)
    logRewritten('b0')
    first()
    logRewritten('b1')
    second()
    logRewritten('b2')
    expect(listener.mock.calls).toEqual([['b0'], ['b0'], ['b1']])
  })

  it('logs a throwing listener, calls the rest and does not rethrow', () => {
    const error = vi.spyOn(logger, 'error')
    const later = vi.fn()
    const offThrowing = onLogRewritten(() => {
      throw new Error('listener boom')
    })
    const offLater = onLogRewritten(later)
    try {
      expect(() => logRewritten('b1')).not.toThrow()
    } finally {
      offThrowing()
      offLater()
    }
    expect(later).toHaveBeenCalledWith('b1')
    expect(error).toHaveBeenCalledWith('action_layer.log_rewritten_listener_failed', {
      branchId: 'b1',
      error: 'listener boom',
    })
  })
})

describe('the commits that rewrite a log', () => {
  it.each(REWRITES)('hears $name once, with its branch', async ({ arrange, nameAfter }) => {
    const ctx = await setup()
    const run = await arrange(ctx)

    const { heard, settled } = await heardDuring(run)

    expect(settled.status).toBe('fulfilled')
    expect(heard).toEqual(['b1'])
    expect(await kaelName(ctx)).toBe(nameAfter)
  })

  it.each(REWRITES)(
    'hears $name when the store sync after its commit throws',
    async ({ arrange, nameAfter }) => {
      const ctx = await setup()
      const run = await arrange(ctx)
      vi.spyOn(entitiesStore, 'patch').mockImplementation(() => {
        throw new Error('store sync boom')
      })

      const { heard, settled } = await heardDuring(run)

      expect(rejectionOf(settled)).toBeInstanceOf(DeltaReplayError)
      expect(rejectionOf(settled)).toMatchObject({ stage: 'store-sync' })
      expect(heard).toEqual(['b1'])
      expect(await kaelName(ctx)).toBe(nameAfter)
    },
  )

  it.each(REWRITES)(
    'hears nothing when $name meets a transaction that throws',
    async ({ arrange, nameBefore }) => {
      const ctx = await setup()
      const run = await arrange(ctx)
      const failing = vi.fn<DbCtx['runInTransaction']>().mockRejectedValue(new Error('disk full'))
      ctx.runInTransaction = failing

      const { heard, settled } = await heardDuring(run)

      expect(settled.status).toBe('rejected')
      expect(failing).toHaveBeenCalledTimes(1)
      expect(heard).toEqual([])
      expect(await kaelName(ctx)).toBe(nameBefore)
    },
  )

  it("runs the other listeners, the store sync and the caller's result past a throwing listener", async () => {
    const ctx = await setup()
    await act(ctx, 'act_0', createKael)
    await act(ctx, 'act_pass', rename('periodic_classifier', 'Ser Kael'))
    const error = vi.spyOn(logger, 'error')
    const offThrowing = onLogRewritten(() => {
      throw new Error('listener boom')
    })
    try {
      const { heard, settled } = await heardDuring(() => reverseReplayDeltas('act_pass', ctx))

      expect(settled).toEqual({ status: 'fulfilled', value: 1 })
      expect(heard).toEqual(['b1'])
    } finally {
      offThrowing()
    }
    expect(entitiesStore.getById('b1', 'char_kael')?.name).toBe('Kael')
    expect(error).toHaveBeenCalledWith('action_layer.log_rewritten_listener_failed', {
      branchId: 'b1',
      error: 'listener boom',
    })
  })
})

describe('the commits that rewrite nothing', () => {
  // char_x < char_y: `kind` is char_x's view, `inverseKind` char_y's.
  const onPair = (
    id: string,
    logPosition: number,
    over: Partial<Delta> & Pick<Delta, 'actionId'>,
  ): Delta => ({
    id,
    branchId: 'b1',
    op: 'update',
    targetTable: 'character_relationships',
    targetId: 'rel_1',
    entryId: null,
    source: 'user_edit',
    undoPayload: null,
    logPosition,
    encodingVersion: 1,
    createdAt: logPosition,
    ...over,
  })

  // As undo.test.ts seeds it: CTRL-Z of the user's `kind` would prune a pass's write outside its redo.
  it('hears nothing on a refused CTRL-Z', async () => {
    const ctx = await setup()
    await ctx.db.insert(characterRelationships).values({
      id: 'rel_1',
      branchId: 'b1',
      aId: 'char_x',
      bId: 'char_y',
      kind: 'rival',
      inverseKind: null,
      createdAt: 1,
      updatedAt: 1,
    })
    await ctx.db.insert(deltas).values([
      onPair('d_pair', 1, { actionId: 'act_u0', op: 'create' }),
      onPair('d_kind', 2, { actionId: 'act_u1', undoPayload: { kind: null } }),
      onPair('d_null', 3, {
        actionId: 'act_pass',
        source: 'periodic_classifier',
        undoPayload: { inverseKind: 'mentor' },
      }),
    ])

    const { heard, settled } = await heardDuring(() => undoLastAction('b1', ctx))

    expect(settled).toEqual({
      status: 'fulfilled',
      value: {
        status: 'rejected',
        code: 'integrity',
        reason: expect.stringContaining('pruned-outside-redo'),
      },
    })
    expect(heard).toEqual([])
  })

  it('hears nothing on an empty set, a settle-only commit or an empty redo', async () => {
    const ctx = await setup()
    await ctx.db.insert(stories).values({ id: 's-settle', title: 'X', createdAt: 1, updatedAt: 1 })
    const settle = () => [ctx.db.delete(stories).where(eq(stories.id, 's-settle')).toSQL()]

    const { heard } = await heardDuring(async () => {
      const empty = await selectReversalSet(ctx, { branchId: 'b1', target: [] })
      expect(await reverseAndPruneDeltaRows(empty, ctx, { keepRedoExact: false })).toBe(0)
      expect(await reverseReplayDeltas('act_none', ctx)).toBe(0)
      expect(await reverseReplayDeltas('act_none', ctx, settle)).toBe(0)
      await applyRedo(__redoGroupForTest('b1'), ctx)
    })

    expect(heard).toEqual([])
    expect(await ctx.db.select().from(stories).where(eq(stories.id, 's-settle'))).toEqual([])
  })

  // A forward write commits through reverseAndPruneDeltaRows too, with nothing to reverse.
  it('hears nothing on a content edit that sweeps nothing', async () => {
    const ctx = await setup()
    const reply = {
      id: 'e_reply',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply' as const,
      content: 'the courier rode north',
      contentTokens: null,
      chapterId: null,
      metadata: null,
      createdAt: 1,
    }
    await ctx.db.insert(storyEntries).values(reply)
    entriesStore.hydrate('b1', [reply])

    const { heard, settled } = await heardDuring(() =>
      updateStoryEntryContent('b1', 'e_reply', 'the courier turned back', ctx),
    )

    expect(settled).toEqual({ status: 'fulfilled', value: { status: 'ok' } })
    expect(heard).toEqual([])
    const [row] = await ctx.db.select().from(storyEntries).where(eq(storyEntries.id, 'e_reply'))
    expect(row?.content).toBe('the courier turned back')
    expect((await ctx.db.select().from(deltas)).map((d) => d.targetId)).toEqual(['e_reply'])
  })
})

describe("a re-run's undo", () => {
  installChapterDeleteHooks(generateStructuredMock)

  it('hears nothing as a re-run that reversed nothing writes its journal', async () => {
    const c = await openClosed()
    const { branchId, ctx } = c.fx

    const { heard, settled } = await heardDuring(() =>
      reverseCloseForRerun({ branchId, chapterId: c.chapter.id, actionId: 'act_rerun' }, ctx),
    )

    expect(settled.status).toBe('fulfilled')
    expect(heard).toEqual([])
    expect(await ctx.db.select({ id: reversalJournals.actionId }).from(reversalJournals)).toEqual([
      { id: 'act_rerun' },
    ])
  })

  it('hears the branch once as an aborted re-run that wrote nothing writes its journal back', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const { branchId, ctx } = c.fx
    await reverseCloseForRerun({ branchId, chapterId: c.chapter.id, actionId: 'act_rerun' }, ctx)
    expect((await worldRows(c.fx)).lore).toEqual([])

    const { heard, settled } = await heardDuring(() =>
      reverseRunGroup({ actionId: 'act_rerun', branchId }, ctx),
    )

    expect(settled).toEqual({ status: 'fulfilled', value: { deltas: 0, journal: 'restored' } })
    expect(heard).toEqual([branchId])
    expect((await worldRows(c.fx)).lore.map((row) => row.id)).toEqual([CLOSE_LORE_ID])
    expect(await ctx.db.select().from(reversalJournals)).toEqual([])
  })

  it('hears the branch once as it writes the journal back', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const { branchId, ctx } = c.fx
    await reverseCloseForRerun({ branchId, chapterId: c.chapter.id, actionId: 'act_rerun' }, ctx)
    await writeUnderClose({ ...c, actionId: 'act_rerun' }, [
      {
        kind: 'updateChapter',
        source: 'chapter_close',
        payload: {
          branchId,
          id: c.chapter.id,
          patch: {
            closeReport: {
              version: 1,
              actionId: 'act_rerun',
              calls: [],
              stopped: [],
              noToolCalls: true,
            },
          },
        },
      },
    ])
    expect((await worldRows(c.fx)).lore).toEqual([])

    const { heard, settled } = await heardDuring(() => undoLastAction(branchId, ctx))

    expect(settled).toEqual({ status: 'fulfilled', value: { status: 'ok' } })
    expect(heard).toEqual([branchId])
    // The write-back put the close's lore back and spent its journal.
    expect((await worldRows(c.fx)).lore.map((row) => row.id)).toEqual([CLOSE_LORE_ID])
    expect(await ctx.db.select().from(reversalJournals)).toEqual([])
  })
})
