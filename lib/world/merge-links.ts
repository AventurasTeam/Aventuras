import type {
  CharacterRelationship,
  Entity,
  HappeningAwareness,
  HappeningInvolvement,
} from '@/lib/db'

import { entityLinkRows, holdersLosingItem, type EntityLinkRows } from './entity-refs'

export type MergeLinkInput = {
  branchId: string
  canonical: Entity
  loser: Entity
  /** The branch's entities, both rows among them. */
  branchEntities: readonly Entity[]
  /** The branch's link rows. */
  awareness: readonly HappeningAwareness[]
  involvements: readonly HappeningInvolvement[]
  relationships: readonly CharacterRelationship[]
}

/** What of the loser's gives way to the canonical's instead of moving to it. */
export type MergeOverlap = {
  /** Awareness rows in a happening the canonical already knows; its own row stays. */
  awareness: number
  /**
   * Involvements in a happening the canonical already takes part in, whose own row and role stay,
   * and each of the loser's own after its first in one happening.
   */
  involvements: number
  /**
   * Relationships with a character the canonical already relates to; its views stay, and the
   * loser's fills only one that is blank.
   */
  relationships: number
  /** Holders that drop the loser item because the canonical item is already held or placed. */
  holdersLosingItem: number
}

/** A relationship the canonical takes from the loser: the other end and the merged views. */
export type RelationshipCopy = {
  otherId: string
  kind: CharacterRelationship['kind']
  inverseKind: CharacterRelationship['inverseKind']
}

export type MergeLinks = {
  /** The loser's link rows the merge moves or gives way on: all but the pair's own relationship. */
  rows: EntityLinkRows
  /** What the merge writes on the canonical. */
  moved: {
    awareness: HappeningAwareness[]
    involvements: HappeningInvolvement[]
    relationships: RelationshipCopy[]
  }
  overlap: MergeOverlap
}

/** A relationship row seen from `id`: the other end, `id`'s view of it, and its view of `id`. */
function seenFrom(row: CharacterRelationship, id: string) {
  return row.aId === id
    ? { other: row.bId, self: row.kind, their: row.inverseKind }
    : { other: row.aId, self: row.inverseKind, their: row.kind }
}

function relationshipCopies(
  input: MergeLinkInput,
  loserRows: readonly CharacterRelationship[],
  canonicalRows: readonly CharacterRelationship[],
): { copies: RelationshipCopy[]; overlap: number } {
  const kept = new Map(
    canonicalRows.map((row) => {
      const view = seenFrom(row, input.canonical.id)
      return [view.other, view] as const
    }),
  )
  const copies: RelationshipCopy[] = []
  let overlap = 0
  for (const row of loserRows) {
    const moved = seenFrom(row, input.loser.id)
    const existing = kept.get(moved.other)
    if (existing != null) overlap += 1
    const kind = existing?.self ?? moved.self
    const inverseKind = existing?.their ?? moved.their
    if (existing != null && existing.self === kind && existing.their === inverseKind) continue
    copies.push({ otherId: moved.other, kind, inverseKind })
  }
  return { copies, overlap }
}

/**
 * world.md → Merge: which of the loser's link rows the merge re-creates on the canonical, and what
 * gives way because the canonical already has it. The planner writes `moved`; the dialog counts.
 */
export function mergeLinks(input: MergeLinkInput): MergeLinks {
  const { branchId, canonical, loser } = input
  const linksOf = (id: string) =>
    entityLinkRows({
      branchId,
      id,
      awareness: input.awareness,
      involvements: input.involvements,
      relationships: input.relationships,
    })
  const own = linksOf(loser.id)
  const canonicalLinks = linksOf(canonical.id)
  const rows: EntityLinkRows = {
    ...own,
    // The pair would name the canonical twice; the cascade removes the row.
    relationships: own.relationships.filter(
      (row) => seenFrom(row, loser.id).other !== canonical.id,
    ),
  }

  const known = new Set(canonicalLinks.awareness.map((row) => row.happeningId))
  const awareness = rows.awareness.filter((row) => !known.has(row.happeningId))
  const involved = new Set(canonicalLinks.involvements.map((row) => row.happeningId))
  const involvements = rows.involvements.filter((row) => {
    if (involved.has(row.happeningId)) return false
    involved.add(row.happeningId)
    return true
  })
  const relationships = relationshipCopies(input, rows.relationships, canonicalLinks.relationships)

  return {
    rows,
    moved: { awareness, involvements, relationships: relationships.copies },
    overlap: {
      awareness: rows.awareness.length - awareness.length,
      involvements: rows.involvements.length - involvements.length,
      relationships: relationships.overlap,
      holdersLosingItem: holdersLosingItem(loser, canonical, input.branchEntities),
    },
  }
}
