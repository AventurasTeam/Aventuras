import { and, eq, inArray, or } from 'drizzle-orm'

import {
  characterRelationships,
  happeningAwareness,
  happeningInvolvements,
  type SqlOp,
} from '@/lib/db'

import {
  defineCascade,
  translationCascade,
  vecSweepOps,
  vecTableLister,
} from '../delta/delete-cascade'

function byIds<T extends { id: string }>(
  rows: readonly T[],
  build: (ids: string[]) => SqlOp,
): SqlOp[] {
  return rows.length === 0 ? [] : [build(rows.map((row) => row.id))]
}

/** milestone.md → C3 entity cascade: link tables + translations + vectors. */
export const entityCascade = defineCascade(
  ['happening_involvements', 'happening_awareness', 'character_relationships', 'translations'],
  async (branchId, id, ctx) => {
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
    const vectors = await vecSweepOps('entity', branchId, id, vecTableLister(ctx))
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
  },
)

/** The link tables `entityCascade` removes with an entity, translations aside. */
export type EntityCascadeLinkTable = Exclude<(typeof entityCascade.tables)[number], 'translations'>
