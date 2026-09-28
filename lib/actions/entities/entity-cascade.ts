import { and, eq, inArray, or } from 'drizzle-orm'

import {
  characterRelationships,
  happeningAwareness,
  happeningInvolvements,
  type SqlOp,
} from '@/lib/db'

import { translationCascade, vecSweepOps, vecTableLister } from '../delta/delete-cascade'
import type { CascadeDeleteOps } from '../delta/registry'

function byIds<T extends { id: string }>(
  ids: readonly T[],
  build: (ids: string[]) => SqlOp,
): SqlOp[] {
  return ids.length === 0 ? [] : [build(ids.map((row) => row.id))]
}

/**
 * C3's entity cascade: the three FK-less link tables, their translations and the entity's own,
 * and every vector. Read under the delete's locks and deleted by the ids read.
 */
export const entityCascade: CascadeDeleteOps = async (branchId, id, ctx) => {
  const involvements = await ctx.db
    .select()
    .from(happeningInvolvements)
    .where(
      and(eq(happeningInvolvements.branchId, branchId), eq(happeningInvolvements.entityId, id)),
    )
  const awareness = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, branchId), eq(happeningAwareness.characterId, id)))
  const relationships = await ctx.db
    .select()
    .from(characterRelationships)
    .where(
      and(
        eq(characterRelationships.branchId, branchId),
        or(eq(characterRelationships.aId, id), eq(characterRelationships.bId, id)),
      ),
    )
  const own = await translationCascade(ctx, branchId, [
    { kind: 'entity', ids: [id] },
    { kind: 'character_relationship', ids: relationships.map((row) => row.id) },
  ])
  const vectors = await vecSweepOps('entities', branchId, id, vecTableLister(ctx))
  return {
    ops: [
      ...byIds(involvements, (ids) =>
        ctx.db
          .delete(happeningInvolvements)
          .where(
            and(
              eq(happeningInvolvements.branchId, branchId),
              inArray(happeningInvolvements.id, ids),
            ),
          )
          .toSQL(),
      ),
      ...byIds(awareness, (ids) =>
        ctx.db
          .delete(happeningAwareness)
          .where(
            and(eq(happeningAwareness.branchId, branchId), inArray(happeningAwareness.id, ids)),
          )
          .toSQL(),
      ),
      ...byIds(relationships, (ids) =>
        ctx.db
          .delete(characterRelationships)
          .where(
            and(
              eq(characterRelationships.branchId, branchId),
              inArray(characterRelationships.id, ids),
            ),
          )
          .toSQL(),
      ),
      ...own.ops,
      ...vectors,
    ],
    children: {
      happening_involvements: involvements,
      happening_awareness: awareness,
      character_relationships: relationships,
      ...own.children,
    },
  }
}
