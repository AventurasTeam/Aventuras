import { and, desc, eq, inArray } from 'drizzle-orm'

import {
  deltas,
  happeningAwareness,
  happeningInvolvements,
  storyEntries,
  type Delta,
  type SqlOp,
} from '@/lib/db'

import type { DbCtx } from '../types'
import { classifierWatermarkClampOps } from './prose-reversal'

const CHILD_TABLES = ['happening_involvements', 'happening_awareness'] as const

export type InvalidationScope = { entryIds: string[]; editedPosition: number }

/**
 * The entries a content edit invalidates, or null when it invalidates none.
 *
 * The clamp reopens every entry above it, so the reversal has to cover that whole
 * window or the next pass re-derives beside facts that survived — which is what bounds
 * both to the head turn (data-model.md -> Entry mutability & rollback). The same pair
 * `resolveSaveAndRegenTurn` derives the editor's notice from; they must agree.
 */
export async function resolveInvalidationScope(
  branchId: string,
  editedId: string,
  ctx: DbCtx,
): Promise<InvalidationScope | null> {
  const [tail, previous] = await ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, position: storyEntries.position })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(desc(storyEntries.position))
    .limit(2)
  if (!tail) return null
  if (tail.id === editedId) return { entryIds: [tail.id], editedPosition: tail.position }
  // Clamping below the head turn's origin reopens the reply too, so the reply's facts
  // go with it or they re-derive twice.
  if (previous?.id === editedId && previous.kind === 'user_action' && tail.kind === 'ai_reply')
    return { entryIds: [previous.id, tail.id], editedPosition: previous.position }
  return null
}

// The undo and redo arms meet a content delta, not an edit call, so they identify one
// by payload shape. `content` is the only column this delta ever carries.
export function isContentEditDelta(
  delta: Pick<Delta, 'targetTable' | 'op' | 'undoPayload'>,
): boolean {
  return (
    delta.targetTable === 'story_entries' &&
    delta.op === 'update' &&
    delta.undoPayload != null &&
    'content' in delta.undoPayload
  )
}

/**
 * Both halves of a prose change's invalidation, resolved together so the forward, undo
 * and redo arms cannot disagree about how far it reaches. Empty off the head turn.
 */
export async function resolveContentEditInvalidation(
  branchId: string,
  entryId: string,
  ctx: DbCtx,
): Promise<{ rows: Delta[]; clampOps: SqlOp[] }> {
  const scope = await resolveInvalidationScope(branchId, entryId, ctx)
  if (!scope) return { rows: [], clampOps: [] }
  return {
    rows: await resolveClassifierFactDeltas(branchId, scope.entryIds, ctx),
    clampOps: classifierWatermarkClampOps(branchId, scope.editedPosition),
  }
}

/**
 * A first-introduction entity stays, even though the prose that introduced it is gone.
 * It is not a fact about that turn but a row the rest of the branch now references --
 * `sceneEntities` arrays, later happenings' involvements, relationships -- and none of
 * those sit in this entry's anchor set. A suffix rollback may delete an entity because
 * it takes every reference down with it; an entry-scoped reversal would leave them
 * dangling, and canon treats a dangling id as permanent rather than transient
 * (entry-card.md -> Unresolvable ids). Everything else the pass wrote is reversed,
 * status flips and relationships included: those are updates and standalone rows, so
 * undoing them dangles nothing.
 */
function isReversible(delta: Delta): boolean {
  return !(delta.targetTable === 'entities' && delta.op === 'create')
}

/**
 * Every delta a content edit must reverse: the classifier facts anchored to the
 * entries in its invalidation scope, closed under the happening -> link-row relation.
 *
 * The closure is load-bearing. Undoing a `create` is a plain row delete with no
 * cascade -- only the explicit `deleteHappening` action carries one -- and a link
 * row does NOT share its happening's anchor: awareness anchors to the turn that
 * narrated the learning, which can sit either side of the happening's own
 * provenance entry (classifier.md -> Provenance attribution). Reversing by anchor
 * alone therefore deletes a happening while its awareness rows survive pointing at
 * nothing. A suffix rollback never sees this because it reverses a whole tail; an
 * entry-scoped reversal has to close the set by hand.
 *
 * Child deltas come in whatever their source, not just `periodic_classifier`: the
 * row is going away, so a hand-edit of it has to go with it.
 */
export async function resolveClassifierFactDeltas(
  branchId: string,
  entryIds: readonly string[],
  ctx: DbCtx,
): Promise<Delta[]> {
  if (entryIds.length === 0) return []
  const anchored = (
    (await ctx.db
      .select()
      .from(deltas)
      .where(
        and(
          eq(deltas.branchId, branchId),
          inArray(deltas.entryId, [...entryIds]),
          eq(deltas.source, 'periodic_classifier'),
        ),
      )) as Delta[]
  ).filter(isReversible)

  const removedHappenings = anchored
    .filter((d) => d.targetTable === 'happenings' && d.op === 'create')
    .map((d) => d.targetId)
  if (removedHappenings.length === 0) return sortForReplay(anchored)

  const [involvements, awareness] = await Promise.all([
    ctx.db
      .select({ id: happeningInvolvements.id })
      .from(happeningInvolvements)
      .where(
        and(
          eq(happeningInvolvements.branchId, branchId),
          inArray(happeningInvolvements.happeningId, removedHappenings),
        ),
      ),
    ctx.db
      .select({ id: happeningAwareness.id })
      .from(happeningAwareness)
      .where(
        and(
          eq(happeningAwareness.branchId, branchId),
          inArray(happeningAwareness.happeningId, removedHappenings),
        ),
      ),
  ])

  const childIds = [...involvements, ...awareness].map((r) => r.id)
  if (childIds.length === 0) return sortForReplay(anchored)

  const childDeltas = (await ctx.db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        inArray(deltas.targetTable, [...CHILD_TABLES]),
        inArray(deltas.targetId, childIds),
      ),
    )) as Delta[]

  const seen = new Set(anchored.map((d) => d.id))
  return sortForReplay([...anchored, ...childDeltas.filter((d) => !seen.has(d.id))])
}

// reverse-replay unwinds newest-first, and the two queries above are unioned out
// of log order.
export function sortForReplay(rows: Delta[]): Delta[] {
  return [...rows].sort((a, b) => b.logPosition - a.logPosition)
}
