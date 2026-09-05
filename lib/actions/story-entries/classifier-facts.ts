import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { deltas, happeningAwareness, happeningInvolvements, type Delta, type SqlOp } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { loadHeadTurn } from './head-turn'
import { PAYLOAD_META_PREFIX } from '../delta/delta-encoding'
import type { DbCtx } from '../types'
import { classifierWatermarkClampOps } from './prose-reversal'

const CHILD_TABLES = ['happening_involvements', 'happening_awareness'] as const

export type InvalidationScope = { entryIds: string[]; editedPosition: number }

const invalidationScopeSchema = z.object({
  entryIds: z.array(z.string()).min(1),
  editedPosition: z.number().int(),
})

// Recorded at write time rather than re-derived at reversal time, because the tail can
// move without this delta moving with it (data-model.md -> Entry mutability & rollback).
export const INVALIDATION_SCOPE_KEY = `${PAYLOAD_META_PREFIX}invalidationScope`

/**
 * The entries a content edit invalidates, or null when it invalidates none.
 *
 * The clamp reopens every entry above it, so the reversal has to cover that whole
 * window or the next pass re-derives beside facts that survived — which is what bounds
 * both to the head turn (data-model.md -> Entry mutability & rollback). The pair comes
 * from `resolveHeadTurn`, which is also what the editor derives its notice from.
 */
async function resolveInvalidationScope(
  branchId: string,
  editedId: string,
  ctx: DbCtx,
): Promise<InvalidationScope | null> {
  const head = await loadHeadTurn(branchId, ctx)
  if (!head) return null
  if (head.tail.id === editedId)
    return { entryIds: [head.tail.id], editedPosition: head.tail.position }
  // Clamping below the origin reopens the reply too, so the reply's facts go with it or
  // they re-derive twice.
  if (head.origin?.id === editedId)
    return { entryIds: [head.origin.id, head.tail.id], editedPosition: head.origin.position }
  return null
}

// The arms meet a delta, not an edit call, so they identify one by payload shape. Sound
// because of the converse: no other story_entries update delta carries a `content` key --
// updateStoryEntryMetadata writes `{ metadata }`, and the delete handler's whole-row
// payload does carry one but is excluded by the op.
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
 * An invalidation, or the delta that refused to describe one. Callers reject on
 * `unreadable` rather than reversing with an empty set (undo.ts -> UndoRejectionCode).
 */
export type InvalidationOutcome =
  | ({ status: 'ok' } & ContentEditInvalidation)
  | { status: 'unreadable'; deltaId: string }

/**
 * {@link resolveContentEditInvalidation} for the scope a delta already carries.
 *
 * Absent and unreadable are kept apart on purpose. An edit below the head turn records
 * no scope, and reversing it invalidates nothing — that is a fact about the forward
 * edit. An unreadable one is the absence of any fact about it, and reversing prose on
 * that basis is the failure the recorded scope exists to prevent.
 */
async function resolveRecordedInvalidation(
  branchId: string,
  delta: Pick<Delta, 'id' | 'undoPayload'>,
  ctx: DbCtx,
): Promise<InvalidationOutcome> {
  const payload = delta.undoPayload
  // Key presence, not a null check: `contentEditUndoPayload` omits the key entirely when
  // there is no scope, so an explicit null can only be corruption.
  if (payload == null || !(INVALIDATION_SCOPE_KEY in payload))
    return { status: 'ok', rows: [], clampOps: [] }
  const parsed = invalidationScopeSchema.safeParse(payload[INVALIDATION_SCOPE_KEY])
  if (!parsed.success) {
    logger.error('action_layer.invalidation_scope_malformed', {
      deltaId: delta.id,
      error: parsed.error.message,
    })
    return { status: 'unreadable', deltaId: delta.id }
  }
  return { status: 'ok', ...(await invalidationForScope(branchId, parsed.data, ctx)) }
}

/**
 * What reversing these deltas invalidates. A content delta puts prose back, and prose is
 * the classifier's only input, so reversing one reaches the same facts the forward edit
 * did. Every other delta shape reaches none.
 *
 * An entry the recorded scope names may have been swept since (a rollback above the
 * edited entry spares the edit but not the reply beside it); its facts went with it, so
 * `resolveClassifierFactDeltas` simply finds nothing anchored to it.
 */
export async function resolveInvalidationForDeltas(
  branchId: string,
  candidates: readonly Delta[],
  ctx: DbCtx,
): Promise<InvalidationOutcome> {
  const rows: Delta[] = []
  const clampOps: SqlOp[] = []
  for (const delta of candidates) {
    if (!isContentEditDelta(delta)) continue
    const one = await resolveRecordedInvalidation(branchId, delta, ctx)
    if (one.status === 'unreadable') return one
    rows.push(...one.rows)
    clampOps.push(...one.clampOps)
  }
  // Each per-delta result is sorted and unique; concatenating them is neither, and two
  // recorded scopes can name the same entry.
  return { status: 'ok', rows: sortForReplay(dedupeById(rows)), clampOps }
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

export function dedupeById(rows: readonly Delta[]): Delta[] {
  return [...new Map(rows.map((r) => [r.id, r])).values()]
}
