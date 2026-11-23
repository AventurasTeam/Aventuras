import { eq, getTableName } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import {
  branches,
  dbSchema,
  ensureVecTablesSql,
  happeningInvolvements,
  isVecFamilyTable,
  packFloat32,
  stories,
  type ClassifierStatus,
  type DbCtx,
  type NewEntity,
} from '@/lib/db'
import { branchSnapshot } from '@/lib/db/__tests__/two-branch'
import { logger } from '@/lib/diagnostics'
import { PER_TURN_KIND } from '@/lib/pipeline'
import { resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { currentStoryStore, generationStore, isBranchHeld } from '@/lib/stores'

import {
  FORK_REFUSAL,
  forkBranch,
  forkBranchCore,
  type ForkBranchCoreInput,
  type ForkRefusal,
  type ForkRefusalCode,
  type ForkResult,
} from './fork-branch'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { holdBranchWriteExclusive, releaseBranchWriteExclusive } from '../delta/branch-write-lock'
import { ReversalIntegrityError, type buildReverseAndPrunePlan } from '../delta/reverse-replay'
import { writeSystemEntry } from '../story-entries/system-entry'
import { registerStoreOnlyRun } from '../turns/__tests__/stand-in-pass'
import type { PipelineAction } from '../types'

// A refusal the planner raises itself, past the closure; null plans as shipped.
const planner = vi.hoisted(() => ({ refusal: null as Error | null }))

vi.mock('../delta/reverse-replay', async (importOriginal) => {
  const actual = await importOriginal<
    Record<string, unknown> & { buildReverseAndPrunePlan: typeof buildReverseAndPrunePlan }
  >()
  const seamed: typeof buildReverseAndPrunePlan = async (...args) => {
    if (planner.refusal) throw planner.refusal
    return actual.buildReverseAndPrunePlan(...args)
  }
  return { ...actual, buildReverseAndPrunePlan: seamed }
})

const CHILD = 'br_fork_child'
const AT = 1_790_000_000_000

let f: CloseFixture

beforeEach(async () => {
  resetSingletons()
  planner.refusal = null
  f = await openCloseFixture({ turns: 4 })
})

afterEach(() => {
  resetSingletons()
  vi.restoreAllMocks()
})

// Positions 1-9: the opening, then four user_action/ai_reply pairs.
function entryAt(position: number): string {
  const entry = f.entries.find((e) => e.position === position)
  if (!entry) throw new Error(`the fixture holds no entry at position ${position}`)
  return entry.id
}

const input = (over: Partial<ForkBranchCoreInput> = {}): ForkBranchCoreInput => ({
  parentBranchId: f.branchId,
  forkEntryId: entryAt(5),
  name: 'The ferry not taken',
  makeCurrent: false,
  newBranchId: CHILD,
  createdAt: AT,
  ...over,
})

const ok = (branchId: string): ForkResult => ({ status: 'ok', branchId })

const character = (id: string, name: string): NewEntity => ({
  id,
  branchId: f.branchId,
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: AT,
  updatedAt: AT,
})

async function land(
  actionId: string,
  entryId: string | null,
  action: PipelineAction,
): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: f.branchId, entryId }, f.ctx)
  if (result.status !== 'ok')
    throw new Error(`${actionId} refused ${action.kind}: ${result.reason}`)
}

function idsOf(query: string, branchId: string): string[] {
  return (f.sqlite.prepare(query).all(branchId) as { id: string }[]).map(({ id }) => id)
}

const entryIdsOf = (branchId: string): string[] =>
  idsOf('SELECT id FROM story_entries WHERE branch_id = ? ORDER BY position', branchId)

const createdEntriesOf = (branchId: string): string[] =>
  idsOf(
    "SELECT target_id AS id FROM deltas WHERE branch_id = ? AND target_table = 'story_entries' AND op = 'create' ORDER BY log_position",
    branchId,
  )

const entityIdsOf = (branchId: string): string[] =>
  idsOf('SELECT id FROM entities WHERE branch_id = ? ORDER BY id', branchId)

const actionIdsOf = (branchId: string): string[] =>
  idsOf(
    'SELECT DISTINCT action_id AS id FROM deltas WHERE branch_id = ? ORDER BY action_id',
    branchId,
  )

// Every schema table's rows, every branch, as text: a refusal writes nothing anywhere.
function dbSnapshot(): Record<string, string[]> {
  const snapshot: Record<string, string[]> = {}
  for (const table of Object.values(dbSchema)) {
    const name = getTableName(table)
    snapshot[name] = (f.sqlite.prepare(`SELECT * FROM "${name}"`).all() as object[])
      .map((row) => JSON.stringify(row))
      .sort()
  }
  return snapshot
}

// A fresh exclusive request is granted at once only when no hold is left on the branch.
async function lockIsFree(branchId: string): Promise<boolean> {
  let granted = false
  void holdBranchWriteExclusive(branchId, 'probe:lock-free').then(() => {
    granted = true
  })
  await Promise.resolve()
  await Promise.resolve()
  releaseBranchWriteExclusive(branchId, 'probe:lock-free')
  return granted
}

async function expectRefused(
  code: ForkRefusalCode,
  fork: () => Promise<ForkResult>,
): Promise<ForkRefusal> {
  const before = dbSnapshot()
  const result = await fork()
  expect(result).toMatchObject({ status: 'rejected', code })
  expect(dbSnapshot()).toEqual(before)
  expect(await lockIsFree(f.branchId)).toBe(true)
  return result as ForkRefusal
}

function vectorCount(branchId: string): number {
  const families = (
    f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
  )
    .map(({ name }) => name)
    .filter(isVecFamilyTable)
  let count = 0
  for (const table of families)
    count += (
      f.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE branch_id = ?`).get(branchId) as {
        n: number
      }
    ).n
  return count
}

// A row every fork keeps, with a vector on the parent; the action layer writes no vectors.
async function seedKeptVector(): Promise<void> {
  await land('act_fork_keep', entryAt(1), {
    kind: 'createEntity',
    source: 'user_edit',
    payload: { entry: character('char_fork_tobin', 'Tobin') },
  })
  for (const ddl of ensureVecTablesSql(4)) f.sqlite.exec(ddl)
  f.sqlite
    .prepare(
      'INSERT INTO entities_vec_4 (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      `${f.branchId}:char_fork_tobin:model-x`,
      f.branchId,
      'model-x',
      'char_fork_tobin',
      '0000000a',
      packFloat32(new Float32Array([1, 0, 0, 0])),
    )
  expect(vectorCount(f.branchId)).toBe(1)
}

async function branchRow(id: string) {
  const [row] = await f.ctx.db.select().from(branches).where(eq(branches.id, id))
  return row
}

async function currentBranchOf(): Promise<string | null | undefined> {
  const [story] = await f.ctx.db
    .select({ current: stories.currentBranchId })
    .from(stories)
    .where(eq(stories.id, f.storyId))
  return story?.current
}

async function setParentStatus(status: ClassifierStatus | null): Promise<void> {
  await f.ctx.db
    .update(branches)
    .set({ classifierStatus: status })
    .where(eq(branches.id, f.branchId))
}

// A re-run whose abort's reversal didn't commit: the parent sits in heldBranches.
function holdParent(): void {
  const rerun = registerStoreOnlyRun(CHAPTER_CLOSE_KIND, f.branchId, 'rerun')
  generationStore.abortRun(rerun.runId, 'failed', { unreversed: true })
  expect(isBranchHeld(generationStore.getTxState(), f.branchId)).toBe(true)
}

describe('forkBranchCore', () => {
  it('copies the parent rolled back to N and leaves the parent as it was', async () => {
    const parentBefore = branchSnapshot(f.sqlite, f.branchId)

    expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))

    expect(entryIdsOf(CHILD)).toEqual([1, 2, 3, 4, 5].map(entryAt))
    expect(createdEntriesOf(CHILD)).toEqual([2, 3, 4, 5].map(entryAt))
    expect(actionIdsOf(CHILD)).toEqual(['act_close_turn_1', 'act_close_turn_2'])
    expect(entryIdsOf(f.branchId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(entryAt))
    expect(branchSnapshot(f.sqlite, f.branchId)).toEqual(parentBefore)
    expect(await lockIsFree(f.branchId)).toBe(true)
  })

  it('writes the branch row it was given, idle at min(watermark, N), from a failed parent', async () => {
    const failed: ClassifierStatus = {
      state: 'failed',
      lastSuccessAt: AT - 5,
      lastError: 'provider timed out',
      processedThrough: 9,
    }
    await setParentStatus(failed)

    expect(await forkBranchCore(input({ name: '  The ferry not taken ' }), f.ctx)).toEqual(
      ok(CHILD),
    )

    expect(await branchRow(CHILD)).toEqual({
      id: CHILD,
      storyId: f.storyId,
      parentBranchId: f.branchId,
      forkEntryId: entryAt(5),
      name: '  The ferry not taken ',
      createdAt: AT,
      classifierStatus: {
        state: 'idle',
        lastSuccessAt: null,
        lastError: null,
        processedThrough: 5,
      },
    })
    expect((await branchRow(f.branchId))?.classifierStatus).toEqual(failed)
  })

  it("keeps a running parent's lower watermark and leaves the parent running", async () => {
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: AT - 5,
      lastError: null,
      processedThrough: 3,
    }
    await setParentStatus(running)

    expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))

    expect((await branchRow(CHILD))?.classifierStatus).toEqual({
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 3,
    })
    expect((await branchRow(f.branchId))?.classifierStatus).toEqual(running)
  })

  it('keeps a never-processed watermark null, from a null status or a null processedThrough', async () => {
    const idleNull = { state: 'idle', lastSuccessAt: null, lastError: null, processedThrough: null }
    await setParentStatus(null)
    expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))
    await setParentStatus({
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: null,
    })
    expect(await forkBranchCore(input({ newBranchId: 'br_fork_second' }), f.ctx)).toEqual(
      ok('br_fork_second'),
    )

    expect((await branchRow(CHILD))?.classifierStatus).toEqual(idleNull)
    expect((await branchRow('br_fork_second'))?.classifierStatus).toEqual(idleNull)
  })

  it('mints a fresh br_ id and the current time in forkBranch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(AT + 7)
    const request = {
      parentBranchId: f.branchId,
      forkEntryId: entryAt(5),
      name: 'Elsewhere',
      makeCurrent: false,
    }

    const first = await forkBranch(request, f.ctx)
    const second = await forkBranch(request, f.ctx)

    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('forkBranch refused')
    expect(first.branchId).toMatch(
      /^br_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(second.branchId).not.toBe(first.branchId)
    expect(await branchRow(first.branchId)).toMatchObject({
      createdAt: AT + 7,
      name: 'Elsewhere',
      parentBranchId: f.branchId,
      forkEntryId: entryAt(5),
    })
  })

  it('points the story at the child with makeCurrent, in the batch that copies its rows and vectors', async () => {
    await seedKeptVector()

    expect(await forkBranchCore(input({ makeCurrent: true }), f.ctx)).toEqual(ok(CHILD))

    expect(await currentBranchOf()).toBe(CHILD)
    expect(entityIdsOf(CHILD)).toEqual(['char_fork_tobin'])
    expect(vectorCount(CHILD)).toBe(1)
  })

  it('leaves the story on the parent without makeCurrent', async () => {
    expect(await forkBranchCore(input({ makeCurrent: false }), f.ctx)).toEqual(ok(CHILD))

    expect(await currentBranchOf()).toBe(f.branchId)
    expect(await branchRow(CHILD)).toBeDefined()
  })

  it('commits nothing when the batch throws partway, and releases the lock', async () => {
    await seedKeptVector()
    // The batch's first op, the child's branches row, again after every other op.
    const failing: DbCtx = {
      db: f.ctx.db,
      runInTransaction: (ops) => f.ctx.runInTransaction([...ops, ops[0]!]),
    }

    await expect(forkBranchCore(input({ makeCurrent: true }), failing)).rejects.toThrow()

    expect(await branchRow(CHILD)).toBeUndefined()
    expect(Object.values(branchSnapshot(f.sqlite, CHILD)).flat()).toEqual([])
    expect(vectorCount(CHILD)).toBe(0)
    expect(await currentBranchOf()).toBe(f.branchId)
    expect(await lockIsFree(f.branchId)).toBe(true)
  })

  it("forks a held parent: the gate leaves the parent's own hold out", async () => {
    holdParent()
    // The store's convenience read counts the open branch's hold, so it would refuse here.
    expect(generationStore.isUserEditBlocked()).toBe(true)

    expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))
  })

  it('forks at a user_action', async () => {
    expect(await forkBranchCore(input({ forkEntryId: entryAt(4) }), f.ctx)).toEqual(ok(CHILD))

    expect(entryIdsOf(CHILD)).toEqual([1, 2, 3, 4].map(entryAt))
  })
})

describe('forkBranchCore refusals (AC 4)', () => {
  it('refuses while a hard-gate run holds another story', async () => {
    registerStoreOnlyRun(PER_TURN_KIND, 'br_elsewhere')

    await expectRefused(FORK_REFUSAL.gated, () => forkBranchCore(input(), f.ctx))
  })

  it('refuses while a turn is pending on another branch', async () => {
    await expectRefused(FORK_REFUSAL.gated, () =>
      generationStore.bracketPendingTurn('br_elsewhere', () => forkBranchCore(input(), f.ctx)),
    )
  })

  it('refuses while a prose reversal is in progress', async () => {
    generationStore.setReversalInProgress(true)

    await expectRefused(FORK_REFUSAL.gated, () => forkBranchCore(input(), f.ctx))
  })

  it('refuses while an embedder swap is pending on the story', async () => {
    const open = currentStoryStore.getCurrentStory()!
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, embedding_swap_target: 'other-embedder' },
    })

    await expectRefused(FORK_REFUSAL.swapPending, () => forkBranchCore(input(), f.ctx))
  })

  it('refuses a fork entry the parent lacks', async () => {
    await expectRefused(FORK_REFUSAL.entryMissing, () =>
      forkBranchCore(input({ forkEntryId: 'entry_close_404' }), f.ctx),
    )
  })

  it('refuses a parent branch that does not exist', async () => {
    await expectRefused(FORK_REFUSAL.entryMissing, () =>
      forkBranchCore(input({ parentBranchId: 'br_nowhere' }), f.ctx),
    )
    expect(await lockIsFree('br_nowhere')).toBe(true)
  })

  it('refuses a system fork entry', async () => {
    const systemId = await writeSystemEntry(
      { branchId: f.branchId, content: 'The reply stopped short. Retry to continue.' },
      f.ctx,
    )

    await expectRefused(FORK_REFUSAL.entrySystem, () =>
      forkBranchCore(input({ forkEntryId: systemId }), f.ctx),
    )
  })

  it("passes the sweep's rollback floor through when B has no create delta", async () => {
    f.sqlite
      .prepare(
        "DELETE FROM deltas WHERE branch_id = ? AND target_table = 'story_entries' AND target_id = ? AND op = 'create'",
      )
      .run(f.branchId, entryAt(6))

    await expectRefused(FORK_REFUSAL.rollbackFloor, () => forkBranchCore(input(), f.ctx))
  })

  it('refuses as integrity when the closure refuses, and logs it', async () => {
    await land('act_fork_pass', entryAt(7), {
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: 'hap_fork_toll',
          branchId: f.branchId,
          title: 'The toll',
          createdAt: AT,
          updatedAt: AT,
        },
      },
    })
    // A writer outside the log: the closure reaches a row naming the happening with no create.
    await f.ctx.db.insert(happeningInvolvements).values({
      id: 'hinv_fork_raw',
      branchId: f.branchId,
      happeningId: 'hap_fork_toll',
      entityId: 'char_fork_nobody',
    })
    const error = vi.spyOn(logger, 'error')

    const refusal = await expectRefused(FORK_REFUSAL.integrity, () =>
      forkBranchCore(input(), f.ctx),
    )

    expect(refusal.reason).toContain('no-create')
    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: f.branchId, refusal: 'no-create' }),
    )
  })

  it('refuses as integrity when the planner refuses, and logs it', async () => {
    planner.refusal = new ReversalIntegrityError('write-back', 'entities:char_fork_x', 'act_x')
    const error = vi.spyOn(logger, 'error')

    const refusal = await expectRefused(FORK_REFUSAL.integrity, () =>
      forkBranchCore(input(), f.ctx),
    )

    expect(refusal.reason).toBe('Reversal refused (write-back): entities:char_fork_x')
    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: f.branchId, refusal: 'write-back' }),
    )
  })
})
