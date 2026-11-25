import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  deltas,
  entities,
  stories,
  type Delta,
  type NewEntity,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import {
  entitiesStore,
  entriesStore,
  generationStore,
  resetAllStores,
  undoRedoStore,
} from '@/lib/stores'
import { resolveLead } from '@/lib/world'

import { setBranchLead, unsetBranchLead } from './set-lead'
import { applyDeltaAction, settleUserWrites } from '../delta/apply-delta-action'
import { __resetBranchWriteLocks } from '../delta/branch-write-lock'
import { withKeyLock } from '../delta/key-lock'
import { __redoGroupForTest } from '../delta/redo'
import { rowLock } from '../delta/row-locks'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '../story-entries/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import type { DbCtx } from '../types'

const DEFINITION = {
  mode: 'adventure',
  narration: 'second',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A drowned city.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
} as StoryDefinition

const CREATIVE_THIRD = { ...DEFINITION, mode: 'creative', narration: 'third' } as StoryDefinition

let ctx: DbCtx

function entity(id: string, branchId: string, over: Partial<NewEntity> = {}): NewEntity {
  return {
    id,
    branchId,
    kind: 'character',
    name: id,
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

async function hydrateMain(): Promise<void> {
  entitiesStore.hydrate(
    'br_1',
    (await ctx.db.select().from(entities).where(eq(entities.branchId, 'br_1'))) as never,
  )
}

// br_1 is the story's current branch; br_2 holds the same ids, Kael flagged there too.
async function setup({
  status = 'active',
  definition = DEFINITION,
}: { status?: 'active' | 'draft'; definition?: StoryDefinition | null } = {}): Promise<void> {
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  await ctx.db.insert(stories).values({
    id: 'story_1',
    title: 'T',
    status,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: 'br_1',
    definition,
  })
  await ctx.db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 1 },
  ])
  await ctx.db
    .insert(entities)
    .values([
      entity('char_kael', 'br_1', { isLead: 1, createdAt: 1 }),
      entity('char_mira', 'br_1', { createdAt: 2 }),
      entity('char_vorne', 'br_1', { createdAt: 3 }),
      entity('char_sage', 'br_1', { status: 'staged' }),
      entity('loc_hollow', 'br_1', { kind: 'location' }),
      entity('char_kael', 'br_2', { isLead: 1 }),
      entity('char_mira', 'br_2'),
      entity('char_other', 'br_2'),
    ])
  await hydrateMain()
  entriesStore.hydrate('br_1', [])
}

async function setFlag(id: string, isLead: 0 | 1): Promise<void> {
  await ctx.db
    .update(entities)
    .set({ isLead })
    .where(and(eq(entities.branchId, 'br_1'), eq(entities.id, id)))
  await hydrateMain()
}

async function flagged(branchId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: entities.id })
    .from(entities)
    .where(and(eq(entities.branchId, branchId), eq(entities.isLead, 1)))
    .orderBy(asc(entities.id))
  return rows.map((r) => r.id)
}

async function deltaRows(): Promise<Delta[]> {
  return (await ctx.db.select().from(deltas).orderBy(asc(deltas.logPosition))) as Delta[]
}

async function storyRow() {
  const [row] = await ctx.db
    .select({ definition: stories.definition, updatedAt: stories.updatedAt })
    .from(stories)
    .where(eq(stories.id, 'story_1'))
  return row
}

async function writeEntry(id: string, position: number, kind: 'user_action' | 'ai_reply') {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createStoryEntry',
        source: 'user_edit',
        payload: {
          entry: {
            id,
            branchId: 'br_1',
            position,
            kind,
            content: `${id} prose`,
            createdAt: position,
          },
        },
      },
      actionId: `act_${id}`,
      branchId: 'br_1',
      entryId: id,
    },
    ctx,
  )
  if (result.status !== 'ok') throw new Error(`${id} did not land: ${result.reason}`)
}

function startHardGateRun(): void {
  generationStore.startRun({
    runId: 'r1',
    kind: 'turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_r1',
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: 'commit',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

// Holds Kael's row lock so a dispatched group waits inside it; `release` lets it run.
function holdKaelRow() {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const held = withKeyLock(rowLock('entities')({ branchId: 'br_1', id: 'char_kael' }), () => gate)
  return { release, held }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  resetAllStores()
  __resetBranchWriteLocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('setBranchLead', () => {
  beforeEach(async () => {
    await setup()
  })

  it('switches the lead in one user group: every other flag off, then the target on', async () => {
    const before = await storyRow()
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_1'))
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_2'))

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect(await flagged('br_1')).toEqual(['char_mira'])
    const rows = await deltaRows()
    expect(
      rows.map(({ branchId, targetTable, targetId, op, source, entryId, undoPayload }) => ({
        branchId,
        targetTable,
        targetId,
        op,
        source,
        entryId,
        undoPayload,
      })),
    ).toEqual([
      {
        branchId: 'br_1',
        targetTable: 'entities',
        targetId: 'char_kael',
        op: 'update',
        source: 'user_edit',
        entryId: null,
        undoPayload: { isLead: 1 },
      },
      {
        branchId: 'br_1',
        targetTable: 'entities',
        targetId: 'char_mira',
        op: 'update',
        source: 'user_edit',
        entryId: null,
        undoPayload: { isLead: 0 },
      },
    ])
    expect(new Set(rows.map((d) => d.actionId)).size).toBe(1)
    expect(rows[0].actionId).toMatch(/^act_/)
    // The story row is not written, and the other branch's same ids keep their flags.
    expect(await storyRow()).toEqual(before)
    expect(await flagged('br_2')).toEqual(['char_kael'])
    // The group cleared its own branch's redo, and only that one.
    expect(undoRedoStore.__branches()).toEqual(['br_2'])
    expect(entitiesStore.getEntities('br_1').get('char_mira')?.isLead).toBe(1)
    expect(entitiesStore.getEntities('br_1').get('char_kael')?.isLead).toBe(0)
  })

  it('CTRL-Z undoes the switch as one action, and redo applies both writes again', async () => {
    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect(await undoLastAction('br_1', ctx)).toEqual({ status: 'ok' })
    expect(await flagged('br_1')).toEqual(['char_kael'])

    expect(await redoLastAction('br_1', ctx)).toEqual({ status: 'ok' })
    expect(await flagged('br_1')).toEqual(['char_mira'])
  })

  // data-model.md → The lead: redo replays the group newest first, so the store holds two flags
  // between its patches. A render-path read sees that and reads no lead, logging nothing.
  it("a render-path read after each of a redo's store patches sees the double and logs nothing", async () => {
    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })
    expect(await undoLastAction('br_1', ctx)).toEqual({ status: 'ok' })
    const patch = entitiesStore.patch
    const observations: { flags: number; lead: string | null }[] = []
    vi.spyOn(entitiesStore, 'patch').mockImplementation((branchId, p) => {
      patch(branchId, p)
      const rows = entitiesStore.getEntities('br_1')
      observations.push({
        flags: [...rows.values()].filter((e) => e.isLead === 1).length,
        lead: resolveLead(rows, 'br_1')?.id ?? null,
      })
    })
    const error = vi.spyOn(logger, 'error')

    expect(await redoLastAction('br_1', ctx)).toEqual({ status: 'ok' })

    expect(observations.find((o) => o.flags === 2)).toEqual({ flags: 2, lead: null })
    expect(observations.at(-1)).toEqual({ flags: 1, lead: 'char_mira' })
    expect(error).not.toHaveBeenCalled()
  })

  it('a rollback to an entry before the set restores the previous lead', async () => {
    await writeEntry('e_action', 1, 'user_action')
    await writeEntry('e_reply', 2, 'ai_reply')
    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    const shown = await shownCounts('br_1', 'e_reply', ctx)
    expect((await rollbackToEntry('br_1', 'e_reply', ctx, { expectedCounts: shown })).status).toBe(
      'ok',
    )

    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  it('a set on a branch with two flagged rows leaves only the target', async () => {
    await setFlag('char_vorne', 1)

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect(await flagged('br_1')).toEqual(['char_mira'])
    expect((await deltaRows()).map((d) => d.targetId)).toEqual([
      'char_kael',
      'char_vorne',
      'char_mira',
    ])
  })

  // data-model.md → The lead: a reader outside the render path that finds two logs the error.
  it('logs the double it reads once, with both ids, and still repairs it', async () => {
    await setFlag('char_vorne', 1)
    const error = vi.spyOn(logger, 'error')

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('action_layer.branch_lead_double', {
      branchId: 'br_1',
      ids: ['char_kael', 'char_vorne'],
    })
    expect(await flagged('br_1')).toEqual(['char_mira'])
  })

  it('logs nothing on a branch with one flagged row', async () => {
    const error = vi.spyOn(logger, 'error')

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect(error).not.toHaveBeenCalled()
  })

  it('clears the other flagged rows oldest first', async () => {
    await ctx.db.insert(entities).values(entity('char_ash', 'br_1', { isLead: 1, createdAt: 5 }))
    await hydrateMain()

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect((await deltaRows()).map((d) => d.targetId)).toEqual([
      'char_kael',
      'char_ash',
      'char_mira',
    ])
  })

  it('repairs a double whose other row is the target by clearing only the other row', async () => {
    await setFlag('char_vorne', 1)

    expect(await setBranchLead('br_1', 'char_kael', ctx)).toEqual({ status: 'ok' })

    expect(await flagged('br_1')).toEqual(['char_kael'])
    expect((await deltaRows()).map((d) => [d.targetId, d.undoPayload])).toEqual([
      ['char_vorne', { isLead: 1 }],
    ])
  })

  it('writes nothing and keeps redo when the target is already the only lead', async () => {
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_1'))

    expect(await setBranchLead('br_1', 'char_kael', ctx)).toEqual({ status: 'ok' })

    expect(await deltaRows()).toEqual([])
    expect(undoRedoStore.__branches()).toEqual(['br_1'])
  })

  it.each([
    ['a location', 'loc_hollow', 'not-character'],
    ['a staged character', 'char_sage', 'not-active'],
    ['a row only on another branch', 'char_other', 'wrong-branch'],
    ['a row on no branch', 'char_ghost', 'wrong-branch'],
  ])('refuses %s with %s and writes nothing', async (_name, id, code) => {
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_1'))

    expect(await setBranchLead('br_1', id, ctx)).toEqual({ status: 'rejected', code })

    expect(await deltaRows()).toEqual([])
    expect(await flagged('br_1')).toEqual(['char_kael'])
    expect(undoRedoStore.__branches()).toEqual(['br_1'])
  })

  it('refuses a draft story and writes nothing', async () => {
    await setup({ status: 'draft' })

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({
      status: 'rejected',
      code: 'draft-story',
    })

    expect(await deltaRows()).toEqual([])
    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  it('refuses in-flight while a hard-gate run holds the gate, writing nothing', async () => {
    startHardGateRun()

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({
      status: 'rejected',
      code: 'in-flight',
    })

    expect(await deltaRows()).toEqual([])
    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  // The gate is the named branch's: its hold counts, another branch's doesn't.
  it('refuses in-flight while the named branch is held, and sets on a branch that is not', async () => {
    const real = generationStore.getTxState()
    vi.spyOn(generationStore, 'getTxState').mockReturnValue({
      ...real,
      heldBranches: new Map([['br_1', { storyId: 'story_1' }]]),
    })

    expect(await setBranchLead('br_1', 'char_mira', ctx)).toEqual({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(await flagged('br_1')).toEqual(['char_kael'])

    expect(await setBranchLead('br_2', 'char_mira', ctx)).toEqual({ status: 'ok' })
    expect(await flagged('br_2')).toEqual(['char_mira'])
  })

  // A run reserving right after the gate check settles user writes before it reads: the set
  // must already be tracked by then, so the check and the dispatch share one tick.
  it('dispatches in the tick of its gate check: a run reserving right after it waits for the set', async () => {
    const real = generationStore.getTxState
    let checks = 0
    let resolveSettled!: () => void
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    vi.spyOn(generationStore, 'getTxState').mockImplementation(() => {
      checks += 1
      if (checks === 1)
        queueMicrotask(() => {
          startHardGateRun()
          void settleUserWrites().then(resolveSettled)
        })
      return real()
    })

    const setting = setBranchLead('br_1', 'char_mira', ctx)
    await settled

    expect(await deltaRows()).toHaveLength(2)
    expect(await setting).toEqual({ status: 'ok' })
  })

  it('acts on the branch it is given, not the story’s current branch', async () => {
    expect(await setBranchLead('br_2', 'char_mira', ctx)).toEqual({ status: 'ok' })

    expect(await flagged('br_2')).toEqual(['char_mira'])
    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  it('queues two sets fired at once on one branch: one flagged row, the later target', async () => {
    const [first, second] = await Promise.all([
      setBranchLead('br_1', 'char_mira', ctx),
      setBranchLead('br_1', 'char_vorne', ctx),
    ])

    expect(first).toEqual({ status: 'ok' })
    expect(second).toEqual({ status: 'ok' })
    expect(await flagged('br_1')).toEqual(['char_vorne'])
  })

  it('maps a reversal raised while the group waits on a row lock to in-flight, writing nothing', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const { release, held } = holdKaelRow()
    const pending = setBranchLead('br_1', 'char_mira', ctx)
    await flush()
    generationStore.setReversalInProgress(true)
    try {
      release()
      await held
      expect(await pending).toEqual({ status: 'rejected', code: 'in-flight' })
    } finally {
      generationStore.setReversalInProgress(false)
    }

    expect(await deltaRows()).toEqual([])
    expect(await flagged('br_1')).toEqual(['char_kael'])
    expect(warn).toHaveBeenCalledWith(
      'action_layer.lead_rejected',
      expect.objectContaining({ code: 'in-flight', reason: 'prose reversal in progress' }),
    )
  })

  it('maps any other group refusal to failed: a flagged row deleted while the group waited', async () => {
    const { release, held } = holdKaelRow()
    const pending = setBranchLead('br_1', 'char_mira', ctx)
    await flush()
    try {
      await ctx.db
        .delete(entities)
        .where(and(eq(entities.branchId, 'br_1'), eq(entities.id, 'char_kael')))
    } finally {
      release()
      await Promise.allSettled([held, pending])
    }

    expect(await pending).toEqual({ status: 'rejected', code: 'failed' })
    expect(await deltaRows()).toEqual([])
    expect(await flagged('br_1')).toEqual([])
  })

  it('throws for a branch that does not exist', async () => {
    await expect(setBranchLead('br_missing', 'char_mira', ctx)).rejects.toThrow('branch not found')
  })
})

describe('unsetBranchLead', () => {
  beforeEach(async () => {
    await setup({ definition: CREATIVE_THIRD })
  })

  it('clears every flagged row in one group, and CTRL-Z restores them', async () => {
    await setFlag('char_vorne', 1)

    expect(await unsetBranchLead('br_1', ctx)).toEqual({ status: 'ok' })

    expect(await flagged('br_1')).toEqual([])
    const rows = await deltaRows()
    expect(rows.map((d) => [d.targetId, d.source, d.undoPayload])).toEqual([
      ['char_kael', 'user_edit', { isLead: 1 }],
      ['char_vorne', 'user_edit', { isLead: 1 }],
    ])
    expect(new Set(rows.map((d) => d.actionId)).size).toBe(1)
    expect(await flagged('br_2')).toEqual(['char_kael'])

    expect(await undoLastAction('br_1', ctx)).toEqual({ status: 'ok' })
    expect(await flagged('br_1')).toEqual(['char_kael', 'char_vorne'])
  })

  it('logs the double it reads once, with both ids, and still clears both', async () => {
    await setFlag('char_vorne', 1)
    const error = vi.spyOn(logger, 'error')

    expect(await unsetBranchLead('br_1', ctx)).toEqual({ status: 'ok' })

    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('action_layer.branch_lead_double', {
      branchId: 'br_1',
      ids: ['char_kael', 'char_vorne'],
    })
    expect(await flagged('br_1')).toEqual([])
  })

  it('writes nothing and keeps redo when the branch has no lead', async () => {
    await setFlag('char_kael', 0)
    undoRedoStore.pushRedoGroup(__redoGroupForTest('br_1'))

    expect(await unsetBranchLead('br_1', ctx)).toEqual({ status: 'ok' })

    expect(await deltaRows()).toEqual([])
    expect(undoRedoStore.__branches()).toEqual(['br_1'])
  })

  it.each([
    ['an adventure story', DEFINITION],
    ['a creative first-person story', { ...CREATIVE_THIRD, narration: 'first' } as StoryDefinition],
    [
      'a creative second-person story',
      { ...CREATIVE_THIRD, narration: 'second' } as StoryDefinition,
    ],
    ['a story with no stored definition', null],
  ])('refuses needs-lead on %s and writes nothing', async (_name, definition) => {
    await setup({ definition })

    expect(await unsetBranchLead('br_1', ctx)).toEqual({
      status: 'rejected',
      code: 'needs-lead',
    })

    expect(await deltaRows()).toEqual([])
    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  it('refuses a draft story and writes nothing', async () => {
    await setup({ status: 'draft', definition: CREATIVE_THIRD })

    expect(await unsetBranchLead('br_1', ctx)).toEqual({
      status: 'rejected',
      code: 'draft-story',
    })
    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  it('refuses in-flight while a hard-gate run holds the gate', async () => {
    startHardGateRun()

    expect(await unsetBranchLead('br_1', ctx)).toEqual({
      status: 'rejected',
      code: 'in-flight',
    })
    expect(await flagged('br_1')).toEqual(['char_kael'])
  })

  it('throws for a branch that does not exist', async () => {
    await expect(unsetBranchLead('br_missing', ctx)).rejects.toThrow('branch not found')
  })
})
