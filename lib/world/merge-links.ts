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
import { checkParentChain, parentOfLocations } from './parent-chain'
import { adoptionHidesStory, type StoryPlace } from './place-rules'
import { realPlacementOf, type PlacedPlacement } from './placement'

export type MergeLinkInput = {
  canonical: Entity
  loser: Entity
  /** Holds both `canonical` and `loser`. */
  branchEntities: readonly Entity[]
  /** Read with the link rows: one missing here is gone. */
  branchHappenings: readonly Pick<Happening, 'id'>[]
  branchAwareness: readonly HappeningAwareness[]
  branchInvolvements: readonly HappeningInvolvement[]
  branchRelationships: readonly CharacterRelationship[]
  /** Where the story is, for a place adoption the story-inside rule would refuse. */
  story: StoryPlace
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
  /**
   * Only for an unplaced canonical place: takes the loser's placement, or stays unplaced when that
   * place is unknown, retired, loops, or would put the canonical's story in a disabled place.
   */
  canonicalPlacement?: 'takes-loser' | 'stays-unplaced'
}

/**
 * A loser's awareness row the merge drops, on a happening the canonical knows: its pin may carry
 * to the canonical's row (world.md → Reversibility).
 */
export type PinCarry = { keptId: string; fromId: string }

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
  /** The dropped awareness rows' pins, each offered to the canonical's row it gives way to. */
  pinCarries: PinCarry[]
  overlap: MergeOverlap
}

/** The canonical's state with its refs to the loser cleared, since it can't point at itself. */
export function canonicalRefsCleared(canonical: Entity, loserId: string): EntityState | null {
  return stateWithRefRewritten(canonical, loserId, canonical.id)
}

export type CanonicalPlacement =
  | { outcome: 'takes-loser'; placement: PlacedPlacement }
  | { outcome: 'stays-unplaced' }

const STAYS_UNPLACED: CanonicalPlacement = { outcome: 'stays-unplaced' }

/**
 * world.md → Merge: an unplaced canonical takes the loser's placement unless that parent is
 * retired, its chain loops or is broken, or the story would land in a disabled place. Null unless
 * the canonical is an unplaced place; a stored parent naming no place counts as unplaced.
 */
export function canonicalPlacementOf(
  input: Pick<MergeLinkInput, 'canonical' | 'loser' | 'branchEntities' | 'story'>,
): CanonicalPlacement | null {
  const { canonical, loser, branchEntities } = input
  if (canonical.kind !== 'location' || loser.kind !== 'location') return null
  const locations = branchEntities.filter((e) => e.kind === 'location')
  const placementIn = realPlacementOf(locations)
  if (placementIn(canonical.id).kind !== 'unplaced') return null
  const taken = placementIn(loser.id)
  if (taken.kind === 'top') return { outcome: 'takes-loser', placement: taken }
  if (taken.kind === 'unplaced') return STAYS_UNPLACED
  const parent = locations.find((e) => e.id === taken.parentId)
  if (parent == null || parent.status === 'retired') return STAYS_UNPLACED
  if (checkParentChain(canonical.id, taken.parentId, parentOfLocations(locations)) !== 'ok')
    return STAYS_UNPLACED
  const hides = adoptionHidesStory({
    canonical,
    loser,
    parentId: taken.parentId,
    branchEntities,
    story: input.story,
  })
  return hides ? STAYS_UNPLACED : { outcome: 'takes-loser', placement: taken }
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
  const { canonical, loser } = input
  const placement = canonicalPlacementOf(input)
  const linksOf = (id: string) =>
    entityLinkRows({
      id,
      branchAwareness: input.branchAwareness,
      branchInvolvements: input.branchInvolvements,
      branchRelationships: input.branchRelationships,
    })
  const own = linksOf(loser.id)
  const canonicalLinks = linksOf(canonical.id)
  // A create's reversal can orphan a link row; its copy's create would refuse the missing end.
  const happenings = new Set(input.branchHappenings.map((row) => row.id))
  const entities = new Set(input.branchEntities.map((row) => row.id))
  const rows: EntityLinkRows = {
    awareness: own.awareness.filter((row) => happenings.has(row.happeningId)),
    involvements: own.involvements.filter((row) => happenings.has(row.happeningId)),
    relationships: own.relationships.filter((row) => {
      const other = seenFrom(row, loser.id).other
      // The pair would name the canonical twice; the cascade removes the row.
      return other !== canonical.id && entities.has(other)
    }),
  }

  const known = new Map(canonicalLinks.awareness.map((row) => [row.happeningId, row.id]))
  const awareness = rows.awareness.filter((row) => !known.has(row.happeningId))
  const pinCarries = rows.awareness.flatMap((row) => {
    const keptId = known.get(row.happeningId)
    return keptId === undefined ? [] : [{ keptId, fromId: row.id }]
  })
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
    pinCarries,
    overlap: {
      awareness: rows.awareness.length - awareness.length,
      involvements: rows.involvements.length - involvements.length,
      relationships: relationships.overlap,
      holdersLosingItem: holdersLosingItem(loser, canonical, input.branchEntities),
      canonicalRefs: canonicalRefsCleared(canonical, loser.id) == null ? 0 : 1,
      ...(placement == null ? {} : { canonicalPlacement: placement.outcome }),
    },
  }
}
