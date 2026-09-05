import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'

import {
  deltas,
  happeningAwareness,
  happeningInvolvements,
  storyEntries,
  type Delta,
  type SqlOp,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import type { DbCtx } from '../types'
import { classifierWatermarkClampOps } from './prose-reversal'

const CHILD_TABLES = ['happening_involvements', 'happening_awareness'] as const

export type InvalidationScope = { entryIds: string[]; editedPosition: number }

const invalidationScopeSchema = z.object({
  entryIds: z.array(z.string()).min(1),
  editedPosition: z.number().int(),
})

/**
 * Where a content edit's invalidation scope rides on its own delta — payload metadata,
 * never a column (delta-encoding.ts -> PAYLOAD_META_PREFIX).
 *
 * Recorded at write time because the tail can move between the edit and its reversal
 * without the edit's delta moving with it: a rollback prunes the deltas above this one
 * and can leave an edit that was made below the head turn sitting at the log head, on
 * what is now the tail. Re-deriving the scope there answers a different question than
 * the forward edit answered, and the two arms must reverse the same set.
 */
export const INVALIDATION_SCOPE_KEY = '$invalidationScope'

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
  // Narrative tail, not row tail: a `system` entry carries no delta of its own
  // (data-model.md -> Entry mutability & rollback), so counting it would push the real
  // head turn out of scope and downgrade a head-turn edit to a bare text write.
  const [tail, previous] = await ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, position: storyEntries.position })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), ne(storyEntries.kind, 'system')))
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

export type ContentEditInvalidation = { rows: Delta[]; clampOps: SqlOp[] }

async function invalidationForScope(
  branchId: string,
  scope: InvalidationScope | null,
  ctx: DbCtx,
): Promise<ContentEditInvalidation> {
  if (!scope) return { rows: [], clampOps: [] }
  return {
    rows: await resolveClassifierFactDeltas(branchId, scope.entryIds, ctx),
    clampOps: classifierWatermarkClampOps(branchId, scope.editedPosition),
  }
}

/**
 * Both halves of a prose change's invalidation for the FORWARD edit, plus the scope
 * they were resolved from — the caller records that on the delta so the undo and redo
 * arms replay this same set instead of re-deriving it. Empty off the head turn.
 */
export async function resolveContentEditInvalidation(
  branchId: string,
  entryId: string,
  ctx: DbCtx,
): Promise<ContentEditInvalidation & { scope: InvalidationScope | null }> {
  const scope = await resolveInvalidationScope(branchId, entryId, ctx)
  return { ...(await invalidationForScope(branchId, scope, ctx)), scope }
}

/** The content delta's payload: prior prose, and the scope its invalidation covered. */
export function contentEditUndoPayload(
  previousContent: string,
  scope: InvalidationScope | null,
): Record<string, unknown> {
  return scope
    ? { content: previousContent, [INVALIDATION_SCOPE_KEY]: scope }
    : { content: previousContent }
}

/**
 * The scope the forward edit recorded, or null when it recorded none. An edit below the
 * head turn writes none, and both readings mean the same thing: putting this prose back
 * invalidates nothing.
 */
export function recordedInvalidationScope(
  delta: Pick<Delta, 'id' | 'undoPayload'>,
): InvalidationScope | null {
  const raw = delta.undoPayload?.[INVALIDATION_SCOPE_KEY]
  if (raw == null) return null
  const parsed = invalidationScopeSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  // Reversing prose while silently invalidating nothing is the failure the scope
  // exists to prevent, so a malformed one is reported rather than absorbed.
  logger.warn('action_layer.invalidation_scope_malformed', {
    deltaId: delta.id,
    error: parsed.error.message,
  })
  return null
}

/** {@link resolveContentEditInvalidation} for the scope a delta already carries. */
export function resolveRecordedInvalidation(
  branchId: string,
  delta: Pick<Delta, 'id' | 'undoPayload'>,
  ctx: DbCtx,
): Promise<ContentEditInvalidation> {
  return invalidationForScope(branchId, recordedInvalidationScope(delta), ctx)
}

/**
 * What reversing a delta group invalidates. A group carrying a content delta puts prose
 * back, and prose is the classifier's only input, so undoing it reaches the same facts
 * the forward edit did. Every other group shape reaches none — which is why the arm
 * could hardcode an empty clamp until content became delta-logged.
 *
 * An entry the recorded scope names may have been swept since (a rollback above the
 * edited entry spares the edit but not the reply beside it); its facts went with it, so
 * `resolveClassifierFactDeltas` simply finds nothing anchored to it.
 */
export async function resolveGroupInvalidation(
  branchId: string,
  group: readonly Delta[],
  ctx: DbCtx,
): Promise<ContentEditInvalidation> {
  const rows: Delta[] = []
  const clampOps: SqlOp[] = []
  for (const delta of group) {
    if (!isContentEditDelta(delta)) continue
    const one = await resolveRecordedInvalidation(branchId, delta, ctx)
    rows.push(...one.rows)
    clampOps.push(...one.clampOps)
  }
  return { rows, clampOps }
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
