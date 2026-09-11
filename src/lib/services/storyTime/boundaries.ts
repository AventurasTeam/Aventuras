/**
 * The points a repair may be selected between.
 *
 * One rule resolves them all: a boundary names an entry and stands for that entry's ending —
 * the assertion when it is anchored, the recorded ending otherwise. An anchored natural
 * boundary is therefore not a special case, it simply is that anchor.
 */

import type { StoryEntry, TimeAnchor, TimeTracker } from '$lib/types'
import { toMinutes } from './minutes'

export type BoundaryKind = 'anchor' | 'story-start' | 'story-end' | 'fork' | 'checkpoint'

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
  /** Entries any branch in the story forked from, not only the branch in view. */
  forkEntryIds?: Iterable<string>
  /** Entries any checkpoint in the story was taken at. */
  checkpointEntryIds?: Iterable<string>
}

/**
 * Every boundary on the branch, in story order.
 *
 * The first entry opens the list and the last closes it; between them sit the anchors, the
 * entries some branch forked from, and the entries a checkpoint was taken at. A natural
 * boundary is a seam rather than a claim about the time: something else has already copied
 * that moment, so the ending recorded there may not move. An entry that is both anchored and
 * natural is one boundary, and resolves to the assertion either way.
 */
export function listBoundaries(input: BoundaryInput): Boundary[] {
  const { entries, anchors, forkEntryIds = [], checkpointEntryIds = [] } = input
  if (entries.length === 0) return []

  const anchorByEntry = new Map(anchors.map((anchor) => [anchor.entryId, anchor]))
  const forks = new Set(forkEntryIds)
  const checkpoints = new Set(checkpointEntryIds)

  const indices = new Map<number, BoundaryKind>()
  indices.set(0, 'story-start')
  if (!indices.has(entries.length - 1)) indices.set(entries.length - 1, 'story-end')

  for (let i = 0; i < entries.length; i++) {
    // The ends keep their own kind; their time still resolves to an anchor when one is there.
    if (indices.has(i)) continue
    const { id } = entries[i]
    const kind: BoundaryKind | null = anchorByEntry.has(id)
      ? 'anchor'
      : forks.has(id)
        ? 'fork'
        : checkpoints.has(id)
          ? 'checkpoint'
          : null
    if (kind) indices.set(i, kind)
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
