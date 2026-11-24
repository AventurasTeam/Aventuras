import { eq, getTableName } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import {
  BRANCH_COPY_MANIFEST,
  branches,
  dbSchema,
  ensureVecTablesSql,
  happeningInvolvements,
  isVecFamilyTable,
  packFloat32,
  pipelineRuns,
  stories,
  type ClassifierStatus,
  type DbCtx,
  type NewEntity,
} from '@/lib/db'
import { branchSnapshot, cloneBranch, type BranchSnapshot } from '@/lib/db/__tests__/two-branch'
import { logger } from '@/lib/diagnostics'
import { PER_TURN_KIND } from '@/lib/pipeline'
import { resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import {
  chaptersStore,
  characterRelationshipsStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  eraFlipsStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  isBranchHeld,
  loreStore,
  threadsStore,
  translationsStore,
  undoRedoStore,
} from '@/lib/stores'

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
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  withBranchWriteShared,
} from '../delta/branch-write-lock'
import { onLogRewritten } from '../delta/post-commit-hook'
import { __redoGroupForTest } from '../delta/redo'
import { resolveByTable } from '../delta/registry'
import { reverseCloseForRerun } from '../delta/rerun-journal'
import { ReversalIntegrityError, type buildReverseAndPrunePlan } from '../delta/reverse-replay'
import { getRollbackCounts, sweepToEntry } from '../story-entries/operational'
import { writeSystemEntry } from '../story-entries/system-entry'
import { registerStoreOnlyRun } from '../turns/__tests__/stand-in-pass'
import type { PipelineAction } from '../types'

// What the planner throws itself, past the closure; null plans as shipped.
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

// Scripted answers for the fork's swap checks, in call order; none left reads the real state.
const swap = vi.hoisted(() => ({
  answers: [] as boolean[],
  calls: [] as string[],
  onCall: null as ((count: number) => void) | null,
}))

vi.mock('@/lib/embedder-swap', async (importOriginal) => {
  const actual = await importOriginal<{ isStorySwapPending: (storyId: string) => boolean }>()
  return {
    ...actual,
    isStorySwapPending: (storyId: string) => {
      swap.calls.push(storyId)
      swap.onCall?.(swap.calls.length)
      return swap.answers.shift() ?? actual.isStorySwapPending(storyId)
    },
  }
})

const CHILD = 'br_fork_child'
const AT = 1_790_000_000_000

let f: CloseFixture

beforeEach(async () => {
  resetSingletons()
  planner.refusal = null
  swap.answers = []
  swap.calls = []
  swap.onCall = null
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

// A shared holder on the parent: the fork's exclusive hold waits until `release`.
function holdShared(): { release: () => Promise<void> } {
  let open!: () => void
  const held = withBranchWriteShared(
    f.branchId,
    'act_fork_holder',
    () => new Promise<void>((resolve) => (open = resolve)),
  )
  return {
    release: () => {
      open()
      return held
    },
  }
}

const descriptionOn = (branchId: string, id: string): unknown =>
  (
    f.sqlite
      .prepare('SELECT description FROM entities WHERE branch_id = ? AND id = ?')
      .get(branchId, id) as { description: unknown } | undefined
  )?.description

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

// Records each batch's label once it commits, so a test reads the commit order.
function labelled(label: string, order: string[], waitMs = 0): DbCtx {
  return {
    db: f.ctx.db,
    runInTransaction: async (ops) => {
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
      await f.ctx.runInTransaction(ops)
      order.push(label)
    },
  }
}

// Anchored on N: landed before the fork's plan, it would survive into the child.
const lateWrite = (): Parameters<typeof applyDeltaAction>[0] => ({
  action: {
    kind: 'createEntity',
    source: 'user_edit',
    payload: { entry: character('char_fork_late', 'Mara') },
  },
  actionId: 'act_fork_late',
  branchId: f.branchId,
  entryId: entryAt(5),
})

function withoutBranchId(snapshot: BranchSnapshot): BranchSnapshot {
  return Object.fromEntries(
    Object.entries(snapshot).map(([table, rows]) => [
      table,
      rows.map(({ branch_id: _branch, ...row }) => row),
    ]),
  )
}

// A plain copy of the parent rolled back to B by the shipped rollback: what a fork at N equals.
async function rolledBackReference(referenceId: string): Promise<BranchSnapshot> {
  cloneBranch(f.sqlite, f.branchId, referenceId)
  const counts = await getRollbackCounts(referenceId, entryAt(6), f.ctx)
  if ('status' in counts) throw new Error(`reference counts refused: ${counts.reason}`)
  const swept = await sweepToEntry(referenceId, entryAt(6), f.ctx, counts)
  if (swept.status !== 'ok') throw new Error(`reference rollback refused: ${swept.reason}`)
  return withoutBranchId(branchSnapshot(f.sqlite, referenceId))
}

const storeRows = (branchId: string) => ({
  entries: entriesStore.getEntries(branchId),
  entities: entitiesStore.getEntities(branchId),
  lore: loreStore.getLore(branchId),
  threads: threadsStore.getThreads(branchId),
  happenings: happeningsStore.getHappenings(branchId),
  involvements: happeningInvolvementsStore.getInvolvements(branchId),
  awareness: happeningAwarenessStore.getAwareness(branchId),
  relationships: characterRelationshipsStore.getRelationshipRows(branchId),
  chapters: chaptersStore.getChapters(branchId),
  eraFlips: eraFlipsStore.getEraFlips(branchId),
  translations: translationsStore.getTranslations(branchId),
})

// Wraps every registered patcher; the next beforeEach's fixture registers fresh ones.
function recordPatchers(): string[] {
  const calls: string[] = []
  for (const table of Object.keys(BRANCH_COPY_MANIFEST)) {
    const entry = resolveByTable(table)
    const patcher = entry?.patcher
    if (!entry || !patcher) continue
    entry.patcher = (branchId, patch) => {
      calls.push(`${table}:${branchId}`)
      patcher(branchId, patch)
    }
  }
  return calls
}

const ORPHAN_ACTION = 'act_fork_orphan'
const RERUN_ACTION = 'act_fork_rerun'
const CLOSE_CHAPTER = 'chap_fork_crossing'

// An open marker, as a run the process died in leaves it.
async function seedMarker(runId: string, actionId: string, kind: string): Promise<void> {
  await f.ctx.db.insert(pipelineRuns).values({
    runId,
    kind,
    actionId,
    storyId: f.storyId,
    branchId: f.branchId,
    startedAt: AT,
  })
}

// An orphan pass whose one write is anchored on entry 5.
async function seedOrphanPass(): Promise<void> {
  await seedMarker('run_fork_orphan', ORPHAN_ACTION, PERIODIC_CLASSIFIER_KIND)
  await land(ORPHAN_ACTION, entryAt(5), {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: { entry: character('char_fork_orphan', 'Harl') },
  })
}

// The orphan's create, in a fork at 5's window, kept by a later user view anchored before B.
async function seedReownedOrphan(): Promise<void> {
  for (const [id, name] of [
    ['char_fork_wren', 'Wren'],
    ['char_fork_tobin', 'Tobin'],
  ] as const)
    await land('act_fork_cast', entryAt(1), {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character(id, name) },
    })
  await seedMarker('run_fork_orphan', ORPHAN_ACTION, PERIODIC_CLASSIFIER_KIND)
  await land(ORPHAN_ACTION, entryAt(7), {
    kind: 'upsertCharacterRelationship',
    source: 'periodic_classifier',
    payload: {
      branchId: f.branchId,
      subjectId: 'char_fork_wren',
      objectId: 'char_fork_tobin',
      kind: 'owes a debt',
      proseEntryId: null,
    },
  })
  await land('act_fork_user_view', entryAt(3), {
    kind: 'upsertCharacterRelationship',
    source: 'user_edit',
    payload: {
      branchId: f.branchId,
      subjectId: 'char_fork_wren',
      objectId: 'char_fork_tobin',
      kind: 'owes a debt',
      inverseKind: 'is owed by',
    },
  })
}

// A close ending on entry 5, then its re-run's reversal committed with the run left open.
async function seedUnfinishedRerun(beforeRerun?: () => Promise<void>): Promise<void> {
  const endEntryId = entryAt(5)
  await land('act_fork_close', endEntryId, {
    kind: 'createChapter',
    source: 'chapter_close',
    payload: {
      entry: {
        id: CLOSE_CHAPTER,
        branchId: f.branchId,
        sequenceNumber: 1,
        title: 'The Crossing',
        summary: 'Wren talks Tobin into a night crossing.',
        theme: 'a guarded passage',
        keywords: ['harrow'],
        startEntryId: entryAt(1),
        endEntryId,
        tokenCount: 64,
        closedAt: AT,
        createdAt: AT,
        updatedAt: AT,
      },
    },
  })
  await land('act_fork_close', endEntryId, {
    kind: 'createLore',
    source: 'chapter_close',
    payload: {
      entry: {
        id: 'lore_fork_toll',
        branchId: f.branchId,
        title: 'The Harrow toll',
        body: 'The Syndicate taxes the ferry.',
        injectionMode: 'auto',
        createdAt: AT,
        updatedAt: AT,
      },
    },
  })
  await beforeRerun?.()
  await seedMarker('run_fork_rerun', RERUN_ACTION, CHAPTER_CLOSE_KIND)
  await reverseCloseForRerun(
    { branchId: f.branchId, chapterId: CLOSE_CHAPTER, actionId: RERUN_ACTION },
    f.ctx,
  )
}

const relationshipCreateOn = (branchId: string): unknown[] =>
  f.sqlite
    .prepare(
      "SELECT source, entry_id AS entryId, action_id AS actionId FROM deltas WHERE branch_id = ? AND target_table = 'character_relationships' AND op = 'create'",
    )
    .all(branchId)

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
    const columns = (
      f.sqlite.prepare("SELECT name FROM pragma_table_info('stories')").all() as { name: string }[]
    )
      .map(({ name }) => name)
      .filter((name) => name !== 'id' && name !== 'current_branch_id')
      .join(', ')
    f.sqlite
      .prepare(
        `INSERT INTO stories (id, current_branch_id, ${columns}) SELECT 'story_other', 'br_other', ${columns} FROM stories WHERE id = ?`,
      )
      .run(f.storyId)

    expect(await forkBranchCore(input({ makeCurrent: true }), f.ctx)).toEqual(ok(CHILD))

    expect(await currentBranchOf()).toBe(CHILD)
    expect(
      f.sqlite
        .prepare("SELECT current_branch_id AS id FROM stories WHERE id = 'story_other'")
        .get(),
    ).toEqual({ id: 'br_other' })
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

  it('refuses a fork entry only a sibling branch holds', async () => {
    expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))

    await expectRefused(FORK_REFUSAL.entryMissing, () =>
      forkBranchCore(
        input({ parentBranchId: CHILD, forkEntryId: entryAt(7), newBranchId: 'br_fork_grand' }),
        f.ctx,
      ),
    )
    expect(await lockIsFree(CHILD)).toBe(true)
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

  it('throws a planner error that is no refusal, writing nothing and logging no refusal', async () => {
    planner.refusal = new Error('boom')
    const error = vi.spyOn(logger, 'error')
    const before = dbSnapshot()

    await expect(forkBranchCore(input(), f.ctx)).rejects.toThrow('boom')

    expect(dbSnapshot()).toEqual(before)
    expect(await lockIsFree(f.branchId)).toBe(true)
    expect(error).not.toHaveBeenCalledWith('action_layer.reversal_refused', expect.anything())
  })

  it('reads the gate when called: a reversal begun while its hold waits does not refuse it', async () => {
    const holder = holdShared()
    const fork = forkBranchCore(input(), f.ctx)
    generationStore.setReversalInProgress(true)
    await holder.release()

    expect(await fork).toEqual(ok(CHILD))
  })
})

describe('forkBranchCore and the branch write lock (AC 8)', () => {
  it('holds a write dispatched during the fork until its commit; the write lands on the parent only', async () => {
    const order: string[] = []
    const fork = forkBranchCore(input(), labelled('fork', order))
    const write = applyDeltaAction(lateWrite(), labelled('write', order))

    const [forked, written] = await Promise.all([fork, write])

    expect(forked).toEqual(ok(CHILD))
    expect(written.status).toBe('ok')
    expect(order).toEqual(['fork', 'write'])
    expect(entityIdsOf(f.branchId)).toEqual(['char_fork_late'])
    expect(entityIdsOf(CHILD)).toEqual([])
    expect(actionIdsOf(CHILD)).not.toContain('act_fork_late')
  })

  it('runs two forks of one parent one after the other, each child the rolled-back copy', async () => {
    const reference = await rolledBackReference('br_fork_ref')
    const order: string[] = []
    // b's batch waits inside its hold: had a's release freed it, the queued write lands first.
    const forks = Promise.all([
      forkBranchCore(input({ newBranchId: 'br_fork_a' }), labelled('a', order)),
      forkBranchCore(input({ newBranchId: 'br_fork_b' }), labelled('b', order, 30)),
    ])
    const write = applyDeltaAction(lateWrite(), labelled('write', order))

    const [results, written] = await Promise.all([forks, write])

    expect(results).toEqual([ok('br_fork_a'), ok('br_fork_b')])
    expect(written.status).toBe('ok')
    expect(order).toEqual(['a', 'b', 'write'])
    expect(withoutBranchId(branchSnapshot(f.sqlite, 'br_fork_a'))).toEqual(reference)
    expect(withoutBranchId(branchSnapshot(f.sqlite, 'br_fork_b'))).toEqual(reference)
  })

  it("keeps a fork's hold when another call under the same new id releases first", async () => {
    const order: string[] = []
    // The refusing call releases at once; the forking call's batch waits inside its own hold.
    const [refused, forked] = await Promise.all([
      forkBranchCore(input({ forkEntryId: 'ent_fork_nowhere' }), f.ctx),
      forkBranchCore(input(), labelled('fork', order, 30)),
      applyDeltaAction(lateWrite(), labelled('write', order)),
    ])

    expect(refused).toMatchObject({ status: 'rejected', code: FORK_REFUSAL.entryMissing })
    expect(forked).toEqual(ok(CHILD))
    expect(order).toEqual(['fork', 'write'])
    expect(entityIdsOf(CHILD)).toEqual([])
    expect(await lockIsFree(f.branchId)).toBe(true)
  })

  it('plans only once a write in flight when it was called commits, and takes it off the child', async () => {
    await land('act_fork_cast', entryAt(3), {
      kind: 'createEntity',
      source: 'user_edit',
      payload: {
        entry: { ...character('char_fork_tobin', 'Tobin'), description: 'The ferryman.' },
      },
    })
    const order: string[] = []
    // Anchored on 7, in the window; the fork's batch commits after it, so a plan read before
    // the edit's commit would copy the edit unreversed.
    const write = applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: {
            branchId: f.branchId,
            id: 'char_fork_tobin',
            patch: { description: 'The ferryman, drinking since noon.' },
          },
        },
        actionId: 'act_fork_edit',
        branchId: f.branchId,
        entryId: entryAt(7),
      },
      labelled('write', order, 30),
    )
    const fork = forkBranchCore(input(), labelled('fork', order, 60))

    const [written, forked] = await Promise.all([write, fork])

    expect(written.status).toBe('ok')
    expect(forked).toEqual(ok(CHILD))
    expect(order).toEqual(['write', 'fork'])
    expect(descriptionOn(f.branchId, 'char_fork_tobin')).toBe('The ferryman, drinking since noon.')
    expect(descriptionOn(CHILD, 'char_fork_tobin')).toBe('The ferryman.')
    expect(actionIdsOf(CHILD)).not.toContain('act_fork_edit')
  })

  it('forks the parent and entry it was called with when the caller changes the input mid-wait', async () => {
    const holder = holdShared()
    const request: { -readonly [K in keyof ForkBranchCoreInput]: ForkBranchCoreInput[K] } = input()
    const fork = forkBranchCore(request, f.ctx)
    request.parentBranchId = 'br_fork_elsewhere'
    request.forkEntryId = entryAt(7)
    await holder.release()

    expect(await fork).toEqual(ok(CHILD))
    expect(await lockIsFree(f.branchId)).toBe(true)
    expect(await branchRow(CHILD)).toMatchObject({
      parentBranchId: f.branchId,
      forkEntryId: entryAt(5),
    })
    expect(entryIdsOf(CHILD)).toEqual([1, 2, 3, 4, 5].map(entryAt))
  })
})

describe('forkBranchCore and a swap admitted mid-fork', () => {
  it('refuses when a swap is admitted between its first check and its batch, writing nothing', async () => {
    swap.answers = [false, true]

    await expectRefused(FORK_REFUSAL.swapPending, () => forkBranchCore(input(), f.ctx))

    expect(swap.calls).toEqual([f.storyId, f.storyId])
  })

  it('re-checks in the same synchronous step that starts the batch', async () => {
    let microtaskRan = false
    const seen: { checks: number; microtaskRan: boolean }[] = []
    swap.answers = [false, false]
    swap.onCall = (count) => {
      if (count === 2)
        queueMicrotask(() => {
          microtaskRan = true
        })
    }
    const ctx: DbCtx = {
      db: f.ctx.db,
      runInTransaction: (ops) => {
        seen.push({ checks: swap.calls.length, microtaskRan })
        return f.ctx.runInTransaction(ops)
      },
    }

    expect(await forkBranchCore(input(), ctx)).toEqual(ok(CHILD))

    expect(seen).toEqual([{ checks: 2, microtaskRan: false }])
  })
})

describe('forkBranchCore leaves the loaded parent alone (AC 9)', () => {
  it("changes no store row, runs no patcher, keeps the parent's redo top and evicts nothing", async () => {
    await land('act_fork_pass', entryAt(3), {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character('char_fork_tobin', 'Tobin') },
    })
    await land('act_fork_pass_late', entryAt(7), {
      kind: 'updateEntity',
      source: 'periodic_classifier',
      payload: {
        branchId: f.branchId,
        id: 'char_fork_tobin',
        patch: { description: 'The ferryman, drinking since noon.' },
      },
    })
    undoRedoStore.pushRedoGroup(__redoGroupForTest(f.branchId))
    const redoTop = undoRedoStore.peekRedoGroup(f.branchId)
    const before = storeRows(f.branchId)
    expect(before.entries.size).toBe(9)
    expect(before.entities.get('char_fork_tobin')?.description).toBe(
      'The ferryman, drinking since noon.',
    )
    const patched = recordPatchers()
    const rewritten: string[] = []
    const off = onLogRewritten((branchId) => rewritten.push(branchId))

    try {
      expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))
    } finally {
      off()
    }

    const after = storeRows(f.branchId)
    for (const key of Object.keys(before) as (keyof typeof before)[])
      expect(after[key]).toBe(before[key])
    expect(patched).toEqual([])
    expect(undoRedoStore.peekRedoGroup(f.branchId)).toBe(redoTop)
    expect(rewritten).toEqual([])

    // The recorders are live: a parent write after the fork shows in both.
    await land('act_fork_user_after', null, {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: f.branchId, id: 'char_fork_tobin', patch: { description: 'Tobin.' } },
    })
    expect(patched).toContain(`entities:${f.branchId}`)
    expect(storeRows(f.branchId).entities).not.toBe(before.entities)
  })
})

describe('forkBranchCore refuses a fork that would carry an unfinished run (AC 4, AC 5)', () => {
  it('refuses when a delta of the run survives the plan, writing nothing', async () => {
    await seedOrphanPass()

    const refusal = await expectRefused(FORK_REFUSAL.unfinishedRun, () =>
      forkBranchCore(input({ forkEntryId: entryAt(7) }), f.ctx),
    )

    expect(refusal.reason).toBe(
      'run run_fork_orphan (act_fork_orphan) is unfinished; the fork would carry its delta',
    )
  })

  it('refuses a tail fork of a parent whose unfinished run has a delta: with no B every delta copies', async () => {
    await seedOrphanPass()

    const refusal = await expectRefused(FORK_REFUSAL.unfinishedRun, () =>
      forkBranchCore(input({ forkEntryId: entryAt(9) }), f.ctx),
    )

    expect(refusal.reason).toBe(
      'run run_fork_orphan (act_fork_orphan) is unfinished; the fork would carry its delta',
    )
  })

  it('forks from before every entry the run wrote on, and the child holds none of its writes', async () => {
    await seedOrphanPass()

    expect(await forkBranchCore(input({ forkEntryId: entryAt(3) }), f.ctx)).toEqual(ok(CHILD))

    expect(actionIdsOf(CHILD)).not.toContain(ORPHAN_ACTION)
    expect(entityIdsOf(CHILD)).toEqual([])
    expect(entityIdsOf(f.branchId)).toEqual(['char_fork_orphan'])
  })

  it("forks when the run's only surviving delta is a create the plan re-owns", async () => {
    await seedReownedOrphan()

    expect(await forkBranchCore(input(), f.ctx)).toEqual(ok(CHILD))

    expect(actionIdsOf(CHILD)).not.toContain(ORPHAN_ACTION)
    expect(relationshipCreateOn(CHILD)).toEqual([
      { source: 'user_edit', entryId: null, actionId: 'act_fork_user_view' },
    ])
    expect(relationshipCreateOn(f.branchId)).toEqual([
      { source: 'periodic_classifier', entryId: entryAt(7), actionId: ORPHAN_ACTION },
    ])
  })

  it("refuses a tail fork while an unfinished re-run's journal would copy", async () => {
    await seedUnfinishedRerun()

    const refusal = await expectRefused(FORK_REFUSAL.unfinishedRun, () =>
      forkBranchCore(input({ forkEntryId: entryAt(9) }), f.ctx),
    )

    expect(refusal.reason).toBe(
      'run run_fork_rerun (act_fork_rerun) is unfinished; the fork would carry its journal',
    )
  })

  it("refuses a fork at the chapter's end: the re-run's journal drops but the chapter it undid stays", async () => {
    await seedUnfinishedRerun()

    const refusal = await expectRefused(FORK_REFUSAL.unfinishedRun, () =>
      forkBranchCore(input({ forkEntryId: entryAt(5) }), f.ctx),
    )

    expect(refusal.reason).toBe(
      'run run_fork_rerun (act_fork_rerun) is unfinished; the fork would carry its chapter',
    )
  })

  it("forks at the chapter's end once the parent no longer holds the re-run's chapter", async () => {
    await seedUnfinishedRerun()
    // A sibling keeps the chapter: a read not scoped to the parent would find it there.
    cloneBranch(f.sqlite, f.branchId, 'br_fork_sibling')
    f.sqlite
      .prepare('DELETE FROM chapters WHERE branch_id = ? AND id = ?')
      .run(f.branchId, CLOSE_CHAPTER)

    expect(await forkBranchCore(input({ forkEntryId: entryAt(5) }), f.ctx)).toEqual(ok(CHILD))
  })

  it("refuses at the chapter's end when the plan prunes only a later edit of the re-run's chapter", async () => {
    await seedUnfinishedRerun(() =>
      land('act_fork_rename', entryAt(7), {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: {
          branchId: f.branchId,
          id: CLOSE_CHAPTER,
          patch: { title: 'The Night Crossing' },
        },
      }),
    )

    const refusal = await expectRefused(FORK_REFUSAL.unfinishedRun, () =>
      forkBranchCore(input({ forkEntryId: entryAt(5) }), f.ctx),
    )

    expect(refusal.reason).toBe(
      'run run_fork_rerun (act_fork_rerun) is unfinished; the fork would carry its chapter',
    )
  })

  it("forks a held parent from before its re-run's chapter end, and refuses at that end", async () => {
    await seedUnfinishedRerun()
    holdParent()

    expect(await forkBranchCore(input({ forkEntryId: entryAt(3) }), f.ctx)).toEqual(ok(CHILD))

    const child = branchSnapshot(f.sqlite, CHILD)
    expect(child.chapters).toEqual([])
    expect(child.reversal_journals).toEqual([])
    expect(branchSnapshot(f.sqlite, f.branchId).reversal_journals).toHaveLength(1)
    await expectRefused(FORK_REFUSAL.unfinishedRun, () =>
      forkBranchCore(input({ forkEntryId: entryAt(5), newBranchId: 'br_fork_at_end' }), f.ctx),
    )
  })
})
