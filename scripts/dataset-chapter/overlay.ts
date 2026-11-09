import { isDeepStrictEqual } from 'node:util'

import { and, desc, eq, inArray } from 'drizzle-orm'
import type { ZodType } from 'zod'

import { applyDeltaAction, loadOpenStory, undoLastAction } from '@/lib/actions'
import { proseLogPosition, userEditsSince, wroteField } from '@/lib/actions/delta/user-precedence'
import {
  chapters,
  deltas,
  emptyEntityState,
  entities,
  entityStateSchemaForKind,
  storyEntries,
  threads,
  threadWriteSchema,
  type DbCtx,
  type Entity,
  type EntityState,
} from '@/lib/db'
import { generateId } from '@/lib/ids'
import type { CappedList } from '@/lib/pipeline/definitions/close-agent/fields'
import { selectUndoTarget } from '@/lib/undo'
import { CAST_SOFT_CAPS } from '@/lib/wizard'

import { DATASET_OVERLAY, type EntityOverlay } from './overlay-data'

/** The dataset seed's branch (testing.md → The dataset seed). */
export const DATASET_BRANCH_ID = 'br_aa6101af-d3dd-4964-9869-81e76cc35f97'

export type OverlayOutcome = {
  /** The seed's close was undone first. */
  reopened: boolean
  userEdit: 'logged' | 'restated'
}

const CAPPED_LISTS: readonly CappedList[] = ['traits', 'drives', 'agenda']
const REFRESH = 'update scripts/dataset-chapter/overlay-data.ts to the seed'

const overlayError = (detail: string): Error => new Error(`[overlay] ${detail}`)

async function openBranch(ctx: DbCtx): Promise<void> {
  const opened = await loadOpenStory(DATASET_BRANCH_ID, ctx)
  if (opened.status !== 'ok')
    throw overlayError(
      `the dataset branch did not open (${opened.status}): load it with pnpm db:seed:dataset`,
    )
}

// Undone after the overlay, the seed's close would put back the values the overlay replaced.
async function reopenChapter(ctx: DbCtx): Promise<boolean> {
  const closed = await ctx.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.branchId, DATASET_BRANCH_ID))
  if (closed.length === 0) return false
  if (closed.length > 1)
    throw overlayError(
      `the dataset branch holds ${closed.length} chapters; the overlay reopens one`,
    )
  const chapterId = closed[0].id
  const [created] = await ctx.db
    .select({ actionId: deltas.actionId })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, DATASET_BRANCH_ID),
        eq(deltas.targetTable, 'chapters'),
        eq(deltas.targetId, chapterId),
        eq(deltas.op, 'create'),
      ),
    )
  const log = await ctx.db
    .select({
      actionId: deltas.actionId,
      source: deltas.source,
      targetTable: deltas.targetTable,
      targetId: deltas.targetId,
      op: deltas.op,
    })
    .from(deltas)
    .where(eq(deltas.branchId, DATASET_BRANCH_ID))
    .orderBy(desc(deltas.logPosition))
  if (created === undefined || selectUndoTarget(log)?.actionId !== created.actionId)
    throw overlayError(
      `chapter ${chapterId} is closed, and its close is not the branch's last action to undo: reload the seed with pnpm db:seed:dataset --overlay`,
    )
  const undone = await undoLastAction(DATASET_BRANCH_ID, ctx)
  if (undone.status !== 'ok')
    throw overlayError(`undoing the chapter's close was refused (${undone.code}): ${undone.reason}`)
  const [left] = await ctx.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.branchId, DATASET_BRANCH_ID))
  if (left !== undefined) throw overlayError(`chapter ${left.id} is still closed after its undo`)
  return true
}

type PlannedState = { row: Entity; state: EntityState }

function plannedState(row: Entity, entry: EntityOverlay): PlannedState {
  if (row.kind !== entry.kind)
    throw overlayError(
      `${entry.name} is a ${row.kind} in the seed, not a ${entry.kind}: ${REFRESH}`,
    )
  // A patch over what the row holds: a key the overlay doesn't name keeps its value.
  const state = { ...(row.state ?? emptyEntityState(entry.kind)), ...entry.state }
  const schema: ZodType = entityStateSchemaForKind(entry.kind)
  const parsed = schema.safeParse(state)
  if (!parsed.success)
    throw overlayError(`${entry.name}'s overlaid state is invalid: ${parsed.error.message}`)
  return { row, state: state as EntityState }
}

// Every check after the reopen, before any overlay write: a changed seed fails loudly and
// leaves no half-applied overlay.
// The edit is there to protect its field: a value the seed already holds, with no user edit after
// the prose of every turn a close may cite, would make the edit a noop that leaves it open.
async function userEditProtects(ctx: DbCtx, row: Entity): Promise<boolean> {
  const turns = await ctx.db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, DATASET_BRANCH_ID))
  let since = 0
  for (const { id } of turns)
    since = Math.max(since, await proseLogPosition(ctx, DATASET_BRANCH_ID, id))
  const edits = await userEditsSince(ctx, DATASET_BRANCH_ID, 'entities', row.id, since)
  return wroteField(edits, 'entities', 'description', [])
}

async function plannedStates(ctx: DbCtx): Promise<PlannedState[]> {
  const { entities: overlaid, userEdit, plantedThread } = DATASET_OVERLAY
  const named = [...overlaid, userEdit]
  const rows = await ctx.db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.branchId, DATASET_BRANCH_ID),
        inArray(
          entities.id,
          named.map(({ id }) => id),
        ),
      ),
    )
  const held = new Map(rows.map((row) => [row.id, row]))
  for (const { id, name } of named) {
    const row = held.get(id)
    if (row === undefined)
      throw overlayError(`${name} (${id}) is not on the dataset branch: ${REFRESH}`)
    if (row.name !== name)
      throw overlayError(`${id} is "${row.name}" in the seed, not "${name}": ${REFRESH}`)
  }
  const edited = held.get(userEdit.id)!
  if (edited.description === userEdit.description && !(await userEditProtects(ctx, edited)))
    throw overlayError(
      `${userEdit.name}'s description already holds the overlay's user edit, with no user edit logged after the chapter to protect it: ${REFRESH}`,
    )
  const { id, title } = plantedThread.duplicates
  const [duplicated] = await ctx.db
    .select({ title: threads.title, status: threads.status })
    .from(threads)
    .where(and(eq(threads.branchId, DATASET_BRANCH_ID), eq(threads.id, id)))
  if (duplicated === undefined || duplicated.title !== title || duplicated.status !== 'active')
    throw overlayError(
      `the planted thread repeats "${title}" (${id}), which is no active thread on the branch: ${REFRESH}`,
    )
  const planted = threadWriteSchema.safeParse({ ...plantedThread.row, branchId: DATASET_BRANCH_ID })
  if (!planted.success)
    throw overlayError(`the planted thread is invalid: ${planted.error.message}`)
  const [heldPlanted] = await ctx.db
    .select()
    .from(threads)
    .where(and(eq(threads.branchId, DATASET_BRANCH_ID), eq(threads.id, plantedThread.row.id)))
  // Compared on the written columns: the embedding sweep clears `embeddingStale`, and the
  // timestamps aren't content.
  if (
    heldPlanted !== undefined &&
    !isDeepStrictEqual(threadWriteSchema.parse(heldPlanted), planted.data)
  )
    throw overlayError(
      `the planted thread ${plantedThread.row.id} is held with other values than the overlay's: reload the seed with pnpm db:seed:dataset --overlay`,
    )
  return overlaid.map((entry) => plannedState(held.get(entry.id)!, entry))
}

async function plantThread(ctx: DbCtx): Promise<void> {
  const planted = { ...DATASET_OVERLAY.plantedThread.row, branchId: DATASET_BRANCH_ID }
  const [held] = await ctx.db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.branchId, DATASET_BRANCH_ID), eq(threads.id, planted.id)))
  if (held === undefined) await ctx.db.insert(threads).values(planted)
}

async function applyUserEdit(ctx: DbCtx): Promise<OverlayOutcome['userEdit']> {
  const { id, name, description } = DATASET_OVERLAY.userEdit
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: DATASET_BRANCH_ID, id, patch: { description } },
      },
      actionId: generateId('act'),
      branchId: DATASET_BRANCH_ID,
    },
    ctx,
  )
  if (result.status === 'ok') return 'logged'
  // updateEntity's only noop: the description already stands.
  if (result.code === 'noop') return 'restated'
  throw overlayError(`the user edit of ${name}'s description was refused: ${result.reason}`)
}

/** Opens the dataset branch, reopens its chapter if closed, writes the overlay. Idempotent. */
export async function applyDatasetOverlay(ctx: DbCtx): Promise<OverlayOutcome> {
  await openBranch(ctx)
  const reopened = await reopenChapter(ctx)
  const planned = await plannedStates(ctx)
  // No delta: the rows read as a first profile, so nothing protects them and a close's CTRL-Z
  // restores them. A row already as planned is left alone, so a second application writes nothing.
  const now = Date.now()
  for (const { row, state } of planned) {
    if (isDeepStrictEqual(state, row.state)) continue
    await ctx.db
      .update(entities)
      .set({ state, updatedAt: now })
      .where(and(eq(entities.branchId, DATASET_BRANCH_ID), eq(entities.id, row.id)))
  }
  await plantThread(ctx)
  // The stores still hold what the direct writes replaced.
  await openBranch(ctx)
  return { reopened, userEdit: await applyUserEdit(ctx) }
}

/** The overlay's at-cap and over-cap rows by id, with each list's stored length after it lands. */
export function overlayCappedLists(): readonly { id: string; list: CappedList; length: number }[] {
  return DATASET_OVERLAY.entities.flatMap(({ id, state }) =>
    CAPPED_LISTS.flatMap((list) => {
      const sent = (state as Partial<Record<CappedList, readonly string[]>>)[list]
      return sent !== undefined && sent.length >= CAST_SOFT_CAPS[list]
        ? [{ id, list, length: sent.length }]
        : []
    }),
  )
}
