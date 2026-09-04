import { and, eq, inArray } from 'drizzle-orm'

import { deltas, happeningAwareness, happeningInvolvements, type Delta } from '@/lib/db'

import type { DbCtx } from '../types'

const CHILD_TABLES = ['happening_involvements', 'happening_awareness'] as const

/**
 * Every delta a content edit must reverse: the classifier facts anchored to the
 * edited entry, closed under the happening -> link-row relation.
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
  entryId: string,
  ctx: DbCtx,
): Promise<Delta[]> {
  const anchored = (await ctx.db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.entryId, entryId),
        eq(deltas.source, 'periodic_classifier'),
      ),
    )) as Delta[]

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
function sortForReplay(rows: Delta[]): Delta[] {
  return [...rows].sort((a, b) => b.logPosition - a.logPosition)
}
