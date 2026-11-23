import type { DatabaseSync } from 'node:sqlite'

import { eq, getTableColumns } from 'drizzle-orm'
import { expect } from 'vitest'

import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import {
  branchCopyOps,
  branches,
  chapters,
  compositeText,
  ensureVecTablesSql,
  entities,
  happenings,
  isVecFamilyTable,
  KIND_FIELDS,
  lore,
  packFloat32,
  pipelineRuns,
  SOURCE_TABLES,
  sourceHash,
  threads,
  type ClassifierStatus,
  type DbCtx,
  type NewEntity,
  type VecTargetKind,
} from '@/lib/db'
import { branchSnapshot, type BranchSnapshot } from '@/lib/db/__tests__/two-branch'
import { seedVec } from '@/lib/db/__tests__/vec-fixtures'
import {
  openCloseFixture,
  writeTurnEntry,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { undoRedoStore } from '@/lib/stores'

import { applyDeltaAction, applyDeltaActionGroup } from '../../delta/apply-delta-action'
import { reverseCloseForRerun } from '../../delta/rerun-journal'
import type { ReversePlan } from '../../delta/reverse-replay'
import {
  getRollbackCounts,
  sweepToEntry,
  type ResolvedSweep,
} from '../../story-entries/operational'
import type { DeltaSource, PipelineAction } from '../../types'
import { forkBranchCore, planFork } from '../fork-branch'

export type ForkWorld = {
  readonly ctx: DbCtx
  readonly sqlite: DatabaseSync
  readonly storyId: string
  readonly parentId: string
}

export type VectorRow = { id: string; modelId: string; sourceHash: string; embedding: string }

export type ParentSnapshot = {
  rows: BranchSnapshot
  vectors: Record<string, VectorRow[]>
  branchRow: Record<string, unknown>
  redoTop: unknown
  hasRedo: boolean
}

export type PlanFacts = { prunedIds: string[]; droppedJournalIds: string[]; hasB: boolean }

export const FORK_CHILD_ID = 'br_fork_child'
export const FORK_REFERENCE_ID = 'br_fork_ref'

const FORK_NAME = 'Fork under test'
const FORK_AT = 1_767_400_000_000
const REFERENCE_AT = 1_767_400_000_001
const WORLD_AT = 1_767_300_000_000
const WINDOW_LORE_ID = 'lore_fork_window'
// Two dimension families, so a sweep that skips one family's table leaves a vector the child lacks.
const VECTOR_DIMS = [4, 8] as const

const KIND_TABLES = {
  entity: entities,
  lore,
  happening: happenings,
  thread: threads,
  chapter: chapters,
}

/** The close fixture's story, open, with `turns` action/reply pairs after its opening. */
export async function openForkWorld(turns: number): Promise<ForkWorld> {
  const fx = await openCloseFixture({ turns })
  return { ctx: fx.ctx, sqlite: fx.sqlite, storyId: fx.storyId, parentId: fx.branchId }
}

/** The close fixture's entry id at `position` (`entry_close_NNN`), which `appendTurns` continues. */
export function entryAt(position: number): string {
  return `entry_close_${String(position).padStart(3, '0')}`
}

/** `count` action/reply pairs after the parent's last entry, each pair under one action. */
export async function appendTurns(w: ForkWorld, count: number): Promise<void> {
  const { tail } = w.sqlite
    .prepare('SELECT max(position) AS tail FROM story_entries WHERE branch_id = ?')
    .get(w.parentId) as { tail: number }
  const at = { ctx: w.ctx, branchId: w.parentId }
  for (let turn = 0; turn < count; turn++) {
    const position = tail + 1 + 2 * turn
    const actionId = `act_fork_turn_${position}`
    await writeTurnEntry(at, actionId, {
      id: entryAt(position),
      position,
      kind: 'user_action',
      content: `I walk on to the milestone at mile ${position}.`,
    })
    await writeTurnEntry(at, actionId, {
      id: entryAt(position + 1),
      position: position + 1,
      kind: 'ai_reply',
      content: `The road bends past mile ${position + 1}, and the river bends with it.`,
    })
  }
}

/** Lands each action through the action layer under one action id and anchor; a refusal throws. */
export async function landWrites(
  w: ForkWorld,
  at: { readonly actionId: string; readonly entryId: string | null },
  actions: readonly PipelineAction[],
): Promise<void> {
  for (const action of actions) {
    const result = await applyDeltaAction(
      { action, actionId: at.actionId, branchId: w.parentId, entryId: at.entryId },
      w.ctx,
    )
    if (result.status !== 'ok')
      throw new Error(`fork fixture: ${at.actionId} refused ${action.kind}: ${result.reason}`)
  }
}

export function createEntityAction(
  w: ForkWorld,
  id: string,
  name: string,
  over: Partial<NewEntity> = {},
): PipelineAction {
  return {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id,
        branchId: w.parentId,
        kind: 'character',
        name,
        status: 'active',
        injectionMode: 'auto',
        createdAt: WORLD_AT,
        updatedAt: WORLD_AT,
        ...over,
      },
    },
  }
}

export function createLoreAction(
  w: ForkWorld,
  id: string,
  title: string,
  source: DeltaSource = 'periodic_classifier',
): PipelineAction {
  return {
    kind: 'createLore',
    source,
    payload: {
      entry: {
        id,
        branchId: w.parentId,
        title,
        body: `${title}, as it was written down.`,
        keywords: [],
        injectionMode: 'auto',
        createdAt: WORLD_AT,
        updatedAt: WORLD_AT,
      },
    },
  }
}

export function createHappeningAction(w: ForkWorld, id: string, title: string): PipelineAction {
  return {
    kind: 'createHappening',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id,
        branchId: w.parentId,
        title,
        description: `${title}.`,
        createdAt: WORLD_AT,
        updatedAt: WORLD_AT,
      },
    },
  }
}

/** A row as stored: SQL column names, JSON as its text. */
export function rowOn(
  w: ForkWorld,
  table: string,
  branchId: string,
  id: string,
): Record<string, unknown> | undefined {
  return w.sqlite
    .prepare(`SELECT * FROM "${table}" WHERE branch_id = ? AND id = ?`)
    .get(branchId, id) as Record<string, unknown> | undefined
}

export function rowsOn(w: ForkWorld, table: string, branchId: string): Record<string, unknown>[] {
  return w.sqlite
    .prepare(`SELECT * FROM "${table}" WHERE branch_id = ? ORDER BY rowid`)
    .all(branchId) as Record<string, unknown>[]
}

export function idsOn(w: ForkWorld, table: string, branchId: string): string[] {
  const rows = w.sqlite
    .prepare(`SELECT id FROM "${table}" WHERE branch_id = ? ORDER BY id`)
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

export function entryIdsOn(w: ForkWorld, branchId: string): string[] {
  const rows = w.sqlite
    .prepare('SELECT id FROM story_entries WHERE branch_id = ? ORDER BY position')
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

export function deltaRowsOf(
  w: ForkWorld,
  branchId: string,
  actionId: string,
): Record<string, unknown>[] {
  return w.sqlite
    .prepare('SELECT * FROM deltas WHERE branch_id = ? AND action_id = ? ORDER BY log_position')
    .all(branchId, actionId) as Record<string, unknown>[]
}

/** Each family table's rows on the branch, every table listed, embeddings as hex. */
export function vectorRows(sqlite: DatabaseSync, branchId: string): Record<string, VectorRow[]> {
  const names = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  const rows: Record<string, VectorRow[]> = {}
  for (const { name } of names) {
    if (!isVecFamilyTable(name)) continue
    rows[name] = sqlite
      .prepare(
        `SELECT id, model_id AS modelId, source_hash AS sourceHash, hex(embedding) AS embedding FROM ${name} WHERE branch_id = ? ORDER BY id, model_id`,
      )
      .all(branchId) as VectorRow[]
  }
  return rows
}

// The text the vector is computed from, in KIND_FIELDS order: what seedVec's guard checks.
function embeddedFields(w: ForkWorld, kind: VecTargetKind, id: string): (string | null)[] {
  const columns: Record<string, { name: string } | undefined> = getTableColumns(KIND_TABLES[kind])
  const names = KIND_FIELDS[kind].map((field) => {
    const column = columns[field]
    if (!column) throw new Error(`fork harness: ${SOURCE_TABLES[kind]} has no column ${field}`)
    return column.name
  })
  const row = w.sqlite
    .prepare(
      `SELECT ${names.map((name) => `"${name}"`).join(', ')} FROM "${SOURCE_TABLES[kind]}" WHERE branch_id = ? AND id = ?`,
    )
    .get(w.parentId, id) as Record<string, string | null> | undefined
  if (!row) throw new Error(`fork harness: no ${SOURCE_TABLES[kind]} row ${w.parentId}/${id}`)
  return names.map((name) => row[name] ?? null)
}

export function seedForkVectors(
  w: ForkWorld,
  rows: { created: { kind: VecTargetKind; id: string }; kept: { kind: VecTargetKind; id: string } },
): void {
  for (const dim of VECTOR_DIMS) for (const ddl of ensureVecTablesSql(dim)) w.sqlite.exec(ddl)
  const seeded = [rows.created, rows.kept]
  seeded.forEach(({ kind, id }, slot) => {
    const fields = embeddedFields(w, kind, id)
    for (const dim of VECTOR_DIMS) {
      const vector = new Float32Array(dim)
      vector[slot] = 1
      seedVec(
        w.sqlite,
        {
          kind,
          id,
          branchId: w.parentId,
          modelId: `fork-model-${dim}`,
          dim,
          sourceHash: sourceHash(compositeText(fields)),
          vector: packFloat32(vector),
        },
        { fields },
      )
    }
  })
}

/** A pass's lore row anchored on `windowEntryId`, then `seedForkVectors` for it and `kept`. */
export async function seedVectorsWithWindowLore(
  w: ForkWorld,
  windowEntryId: string,
  kept: { kind: VecTargetKind; id: string },
): Promise<string> {
  await landWrites(w, { actionId: 'act_fork_window_lore', entryId: windowEntryId }, [
    createLoreAction(w, WINDOW_LORE_ID, 'The drowned milestone'),
  ])
  seedForkVectors(w, { created: { kind: 'lore', id: WINDOW_LORE_ID }, kept })
  return WINDOW_LORE_ID
}

const CLOSED_AT = 1_767_350_000_000
const RERUN_AT = CLOSED_AT + 1_000

function closeReportAction(w: ForkWorld, chapterId: string, actionId: string): PipelineAction {
  return {
    kind: 'updateChapter',
    source: 'chapter_close',
    payload: {
      branchId: w.parentId,
      id: chapterId,
      patch: { closeReport: { version: 1, actionId, calls: [], stopped: [], noToolCalls: true } },
    },
  }
}

/**
 * A close of entries `startPosition..endPosition` as a close logs it, every write under
 * `actionId` and anchored on the end entry.
 */
export async function closeByHand(
  w: ForkWorld,
  close: {
    readonly chapterId: string
    readonly actionId: string
    readonly startPosition: number
    readonly endPosition: number
    readonly loreId: string
  },
): Promise<void> {
  const { chapterId, actionId, startPosition, endPosition, loreId } = close
  const endEntryId = entryAt(endPosition)
  const stamps: PipelineAction[] = []
  for (let position = startPosition; position <= endPosition; position++)
    stamps.push({
      kind: 'stampEntryChapter',
      source: 'chapter_close',
      payload: { branchId: w.parentId, id: entryAt(position), chapterId },
    })
  const group = await applyDeltaActionGroup(
    [
      {
        kind: 'createChapter',
        source: 'chapter_close',
        payload: {
          entry: {
            id: chapterId,
            branchId: w.parentId,
            sequenceNumber: 1,
            title: 'The Crossing at Harrow',
            summary: "Wren crosses the river at night on the ferryman's word.",
            theme: 'a guarded passage',
            keywords: ['ferry'],
            startEntryId: entryAt(startPosition),
            endEntryId,
            tokenCount: 64,
            closedAt: CLOSED_AT,
            createdAt: CLOSED_AT,
            updatedAt: CLOSED_AT,
          },
        },
      },
      ...stamps,
    ],
    { actionId, branchId: w.parentId, entryId: endEntryId },
    w.ctx,
  )
  if (group.status !== 'ok')
    throw new Error(`fork fixture: the close of ${chapterId} refused: ${group.reason}`)
  await landWrites(w, { actionId, entryId: endEntryId }, [
    createLoreAction(w, loreId, 'The Harrow ferry', 'chapter_close'),
    closeReportAction(w, chapterId, actionId),
  ])
}

/**
 * A finished re-run of the close: its marker, the journaled reversal, its own lore and report, the
 * marker closed.
 */
export async function rerunByHand(
  w: ForkWorld,
  rerun: {
    readonly chapterId: string
    readonly endEntryId: string
    readonly actionId: string
    readonly runId: string
    readonly loreId: string
  },
): Promise<void> {
  const { chapterId, endEntryId, actionId, runId, loreId } = rerun
  await w.ctx.db.insert(pipelineRuns).values({
    runId,
    kind: CHAPTER_CLOSE_KIND,
    actionId,
    storyId: w.storyId,
    branchId: w.parentId,
    startedAt: RERUN_AT,
  })
  await reverseCloseForRerun({ branchId: w.parentId, chapterId, actionId }, w.ctx)
  await landWrites(w, { actionId, entryId: endEntryId }, [
    createLoreAction(w, loreId, 'The night ferry', 'chapter_close'),
    closeReportAction(w, chapterId, actionId),
  ])
  // Left open, the marker would refuse every fork whose copy keeps its journal.
  await w.ctx.db
    .update(pipelineRuns)
    .set({ finishedAt: RERUN_AT + 1, outcome: 'completed' })
    .where(eq(pipelineRuns.runId, runId))
}

export function journalIdsOn(w: ForkWorld, branchId: string): string[] {
  const rows = w.sqlite
    .prepare('SELECT action_id AS id FROM reversal_journals WHERE branch_id = ? ORDER BY action_id')
    .all(branchId) as { id: string }[]
  return rows.map(({ id }) => id)
}

export function snapshotParent(w: ForkWorld): ParentSnapshot {
  return {
    rows: branchSnapshot(w.sqlite, w.parentId),
    vectors: vectorRows(w.sqlite, w.parentId),
    branchRow: w.sqlite.prepare('SELECT * FROM branches WHERE id = ?').get(w.parentId) as Record<
      string,
      unknown
    >,
    redoTop: undoRedoStore.peekRedoGroup(w.parentId),
    hasRedo: undoRedoStore.hasRedo(w.parentId),
  }
}

function positionOf(w: ForkWorld, entryId: string): number {
  const row = w.sqlite
    .prepare('SELECT position FROM story_entries WHERE branch_id = ? AND id = ?')
    .get(w.parentId, entryId) as { position: number } | undefined
  if (!row) throw new Error(`fork harness: no entry ${w.parentId}/${entryId}`)
  return row.position
}

// B: the parent's earliest non-system entry after the fork entry.
function entryAfter(w: ForkWorld, forkEntryId: string): string | null {
  const next = w.sqlite
    .prepare(
      "SELECT id FROM story_entries WHERE branch_id = ? AND kind != 'system' AND position > ? ORDER BY position LIMIT 1",
    )
    .get(w.parentId, positionOf(w, forkEntryId)) as { id: string } | undefined
  return next?.id ?? null
}

/** The fork's own sweep and plan, read-only on the parent; null with no B. */
export async function forkPlan(
  w: ForkWorld,
  forkEntryId: string,
  childId: string,
): Promise<{ swept: ResolvedSweep; plan: ReversePlan } | null> {
  const planned = await planFork(w.parentId, positionOf(w, forkEntryId), childId, w.ctx)
  if (planned.status === 'rejected')
    throw new Error(`fork harness: the fork's plan refused: ${planned.code} ${planned.reason}`)
  return planned.fork
}

export async function planFacts(
  w: ForkWorld,
  forkEntryId: string,
  childId: string,
): Promise<PlanFacts> {
  const planned = await forkPlan(w, forkEntryId, childId)
  if (planned === null) return { prunedIds: [], droppedJournalIds: [], hasB: false }
  return {
    prunedIds: planned.plan.prunedDeltas.map((d) => d.id).sort(),
    droppedJournalIds: planned.plan.droppedJournals.map((j) => j.actionId).sort(),
    hasB: true,
  }
}

/** A plain copy of the parent, `system` entries left out, rolled back to the fork entry. */
export async function buildReference(
  w: ForkWorld,
  forkEntryId: string,
  referenceId: string,
): Promise<void> {
  const b = entryAfter(w, forkEntryId)
  const [parent] = await w.ctx.db.select().from(branches).where(eq(branches.id, w.parentId))
  if (!parent) throw new Error(`fork harness: no branch ${w.parentId}`)
  await w.ctx.runInTransaction([
    w.ctx.db
      .insert(branches)
      .values({
        ...parent,
        id: referenceId,
        parentBranchId: w.parentId,
        forkEntryId: null,
        name: referenceId,
        createdAt: REFERENCE_AT,
      })
      .toSQL(),
    ...(await branchCopyOps(w.ctx.db, {
      from: w.parentId,
      to: referenceId,
      mode: 'fork',
      where: { deltas: 'all', reversal_journals: 'all' },
    })),
  ])
  if (b === null) return
  const counts = await getRollbackCounts(referenceId, b, w.ctx)
  if ('status' in counts)
    throw new Error(`fork harness: the reference's counts refused: ${counts.reason}`)
  const rolled = await sweepToEntry(referenceId, b, w.ctx, counts)
  if (rolled.status !== 'ok')
    throw new Error(`fork harness: the reference's rollback refused: ${rolled.reason}`)
}

const withoutBranch = (rows: readonly Record<string, unknown>[]): Record<string, unknown>[] =>
  rows.map(({ branch_id: _branch, ...row }) => row)

function missingFrom(
  parent: readonly Record<string, unknown>[],
  child: readonly Record<string, unknown>[],
  key: string,
): string[] {
  const held = new Set(child.map((row) => String(row[key])))
  return parent
    .map((row) => String(row[key]))
    .filter((id) => !held.has(id))
    .sort()
}

export async function assertFork(
  w: ForkWorld,
  forkEntryId: string,
  opts: { childId?: string; referenceId?: string } = {},
): Promise<{ childId: string; facts: PlanFacts }> {
  const childId = opts.childId ?? FORK_CHILD_ID
  const referenceId = opts.referenceId ?? FORK_REFERENCE_ID
  const before = snapshotParent(w)
  const facts = await planFacts(w, forkEntryId, childId)

  const forked = await forkBranchCore(
    {
      parentBranchId: w.parentId,
      forkEntryId,
      name: FORK_NAME,
      makeCurrent: false,
      newBranchId: childId,
      createdAt: FORK_AT,
    },
    w.ctx,
  )
  expect(forked).toEqual({ status: 'ok', branchId: childId })
  await buildReference(w, forkEntryId, referenceId)

  const after = snapshotParent(w)
  expect(after.rows, 'the parent').toEqual(before.rows)
  expect(after.vectors, "the parent's vectors").toEqual(before.vectors)
  expect(after.branchRow, "the parent's branches row").toEqual(before.branchRow)
  expect(after.redoTop, "the parent's redo top").toBe(before.redoTop)
  expect(after.hasRedo, "the parent's redo").toBe(before.hasRedo)

  const child = branchSnapshot(w.sqlite, childId)
  const reference = branchSnapshot(w.sqlite, referenceId)
  expect(child.probe_captures, "the child's captures").toEqual([])
  expect(reference.probe_captures, "the reference's captures").toEqual([])
  for (const table of Object.keys(child))
    expect(withoutBranch(child[table]), table).toEqual(withoutBranch(reference[table]))
  expect(vectorRows(w.sqlite, childId), 'vectors').toEqual(vectorRows(w.sqlite, referenceId))

  expect(missingFrom(before.rows.deltas, child.deltas, 'id'), 'AC 10: deltas').toEqual(
    facts.prunedIds,
  )
  expect(
    missingFrom(before.rows.reversal_journals, child.reversal_journals, 'action_id'),
    'AC 10: journals',
  ).toEqual(facts.droppedJournalIds)

  const status = JSON.parse(
    String(before.branchRow.classifier_status ?? 'null'),
  ) as ClassifierStatus | null
  const through = status?.processedThrough ?? null
  const [row] = await w.ctx.db.select().from(branches).where(eq(branches.id, childId))
  expect(row, "the child's branches row").toMatchObject({
    id: childId,
    storyId: w.storyId,
    parentBranchId: w.parentId,
    forkEntryId,
    name: FORK_NAME,
    createdAt: FORK_AT,
  })
  expect(row?.classifierStatus, "the child's classifier_status").toEqual({
    state: 'idle',
    lastSuccessAt: null,
    lastError: null,
    processedThrough: through === null ? null : Math.min(through, positionOf(w, forkEntryId)),
  })
  return { childId, facts }
}
