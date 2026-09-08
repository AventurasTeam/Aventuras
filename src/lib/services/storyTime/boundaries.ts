/**
 * The points a repair may be selected between.
 *
 * One rule resolves them all: a boundary names an entry and stands for that entry's ending —
 * the assertion when it is anchored, the recorded ending otherwise. An anchored natural
 * boundary is therefore not a special case, it simply is that anchor.
 */

import type { StoryEntry, TimeAnchor, TimeTracker } from '$lib/types'
import { toMinutes } from './minutes'

export type BoundaryKind = 'anchor' | 'story-start' | 'story-end' | 'fork'

export interface Boundary {
  entryId: string
  /** Index into the entry list the boundary was resolved against. */
  index: number
  kind: BoundaryKind
  /** Null when the entry carries neither an anchor nor a recorded ending. */
  time: TimeTracker | null
}

export interface BoundaryInput {
  /** The entries visible on the current branch, in story order. */
  entries: StoryEntry[]
  anchors: TimeAnchor[]
  /** The entry this branch forked from, when on a branch. */
  forkEntryId?: string | null
  /** Ids the current branch owns and may rewrite. Undefined means every entry is owned. */
  ownedEntryIds?: Set<string>
}

/**
 * Every boundary on the branch, in story order.
 *
 * The first entry -- or the fork point on a branch -- opens the list, the last closes it, and
 * anchors fall between. An unanchored entry is never a boundary, so the ranges between
 * consecutive boundaries are the repairs on offer.
 */
export function listBoundaries(input: BoundaryInput): Boundary[] {
  const { entries, anchors, forkEntryId = null, ownedEntryIds } = input
  if (entries.length === 0) return []

  const anchorByEntry = new Map(anchors.map((anchor) => [anchor.entryId, anchor]))
  const owns = (id: string) => !ownedEntryIds || ownedEntryIds.has(id)

  const forkIndex = forkEntryId ? entries.findIndex((entry) => entry.id === forkEntryId) : -1
  const startIndex = forkIndex >= 0 ? forkIndex : 0
  const startKind: BoundaryKind = forkIndex >= 0 ? 'fork' : 'story-start'

  const indices = new Map<number, BoundaryKind>()
  indices.set(startIndex, startKind)
  indices.set(entries.length - 1, indices.get(entries.length - 1) ?? 'story-end')

  for (let i = startIndex; i < entries.length; i++) {
    const entry = entries[i]
    if (!anchorByEntry.has(entry.id)) continue
    // An anchor before the fork is visible but cannot bound a repair on this branch.
    if (i > startIndex && !owns(entry.id)) continue
    indices.set(i, i === startIndex || i === entries.length - 1 ? indices.get(i)! : 'anchor')
  }

  return [...indices.keys()]
    .sort((a, b) => a - b)
    .map((index) => {
      const entry = entries[index]
      const anchor = anchorByEntry.get(entry.id)
      return {
        entryId: entry.id,
        index,
        kind: indices.get(index)!,
        time: anchor?.assertedTime ?? entry.metadata?.timeEnd ?? null,
      }
    })
}

export interface SelectableRange {
  from: Boundary
  to: Boundary
  /** Entries after `from` up to and including `to`. */
  entryIds: string[]
}

/**
 * The ranges a reader may reconcile: the gaps between consecutive boundaries.
 *
 * Adjacent only. A range spanning an anchor would have to either violate that assertion when
 * it scales or promote it to a constraint, and both undo the rule that an anchor is a fact
 * the reader stated.
 */
export function selectableRanges(entries: StoryEntry[], boundaries: Boundary[]): SelectableRange[] {
  const ranges: SelectableRange[] = []
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1]
    const to = boundaries[i]
    if (to.index <= from.index) continue
    ranges.push({
      from,
      to,
      entryIds: entries.slice(from.index + 1, to.index + 1).map((entry) => entry.id),
    })
  }
  return ranges
}

export type RangeRefusal = {
  reason: 'unusable-boundary' | 'backwards-span'
  boundaries: Boundary[]
}

/** Null when the range can be repaired; the refusal otherwise. Equal times are allowed. */
export function refuseRange(from: Boundary, to: Boundary): RangeRefusal | null {
  if (!from.time || !to.time) {
    return {
      reason: 'unusable-boundary',
      boundaries: [from, to].filter((boundary) => !boundary.time),
    }
  }
  if (toMinutes(to.time) < toMinutes(from.time)) {
    return { reason: 'backwards-span', boundaries: [from, to] }
  }
  return null
}
