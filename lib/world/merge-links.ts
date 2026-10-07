import type {
  CharacterRelationship,
  Entity,
  EntityState,
  Happening,
  HappeningAwareness,
  HappeningInvolvement,
} from '@/lib/db'

import {
  entityLinkRows,
  holdersLosingItem,
  stateWithRefRewritten,
  type EntityLinkRows,
} from './entity-refs'

export type MergeLinkInput = {
  branchId: string
  canonical: Entity
  loser: Entity
  /** The branch's entities, both rows among them. */
  branchEntities: readonly Entity[]
  /** The branch's happenings, read with the link rows: one missing here is gone. */
  happenings: readonly Pick<Happening, 'id' | 'branchId'>[]
  /** The branch's link rows. */
  awareness: readonly HappeningAwareness[]
  involvements: readonly HappeningInvolvement[]
  relationships: readonly CharacterRelationship[]
}

/** What a merge drops instead of moving it to the canonical. */
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
  /** 1 when the canonical's state names the loser (a location under it): that ref is cleared. */
  canonicalRefs: number
}

/** A relationship the canonical takes from the loser: the other end and the merged views. */
export type RelationshipCopy = {
  otherId: string
  kind: CharacterRelationship['kind']
  inverseKind: CharacterRelationship['inverseKind']
}

export type MergeLinks = {
  /**
   * The loser's link rows the merge moves or gives way on: those whose other end the branch still
   * has, the pair's own relationship aside. The cascade removes the rest unmoved.
   */
  rows: EntityLinkRows
  /** What the merge writes on the canonical. */
  moved: {
    awareness: HappeningAwareness[]
    involvements: HappeningInvolvement[]
    relationships: RelationshipCopy[]
  }
  overlap: MergeOverlap
}

/** The canonical's state with its refs to the loser cleared, since it can't point at itself. */
export function canonicalRefsCleared(canonical: Entity, loserId: string): EntityState | null {
  return stateWithRefRewritten(canonical, loserId, canonical.id)
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

/** world.md → Merge: the loser's links a merge re-creates on the canonical, and those it drops. */
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
  // A create's reversal can orphan a link row; its copy's create would refuse the missing end.
  const onBranch = <Row extends { id: string; branchId: string }>(rows: readonly Row[]) =>
    new Set(rows.filter((row) => row.branchId === branchId).map((row) => row.id))
  const happenings = onBranch(input.happenings)
  const entities = onBranch(input.branchEntities)
  const rows: EntityLinkRows = {
    awareness: own.awareness.filter((row) => happenings.has(row.happeningId)),
    involvements: own.involvements.filter((row) => happenings.has(row.happeningId)),
    relationships: own.relationships.filter((row) => {
      const other = seenFrom(row, loser.id).other
      // The pair would name the canonical twice; the cascade removes the row.
      return other !== canonical.id && entities.has(other)
    }),
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
      canonicalRefs: canonicalRefsCleared(canonical, loser.id) == null ? 0 : 1,
    },
  }
}
