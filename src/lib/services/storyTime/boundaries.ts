/**
 * The points a range may be selected between.
 *
 * One rule resolves them all: a boundary names an entry and stands for that entry's ending —
 * the assertion when it is anchored, the recorded ending otherwise. An anchored natural
 * boundary is therefore not a special case, it simply is that anchor.
 */

import type { StoryEntry, TimeAnchor, TimeTracker } from '#lib/types/index.ts'
import { normalizeTime, toMinutes } from './minutes'

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
  /** Entries any branch in the story forked from, not only the branch in view. */
  forkEntryIds?: Iterable<string>
}

/**
 * Every boundary on the branch, in story order.
 *
 * The first entry opens the list and the last closes it; between them sit the anchors and the
 * entries some branch forked from. A fork is a seam rather than a claim about the time: the
 * entries before it are shared by every branch forked there, so no range may reach across it to fit
 * them to a point inside one branch, and the branches open on its ending, so it may not move. An entry
 * that is both anchored and natural is one boundary, and resolves to the assertion either way.
 *
 * A checkpoint is not one of them. It copies the clock, but nothing reads that copy until a branch
 * is taken from it, and reconciling through it rewrites the copy along with the entry.
 */
export function listBoundaries(input: BoundaryInput): Boundary[] {
  const { entries, anchors, forkEntryIds = [] } = input
  if (entries.length === 0) return []

  const anchorByEntry = new Map(anchors.map((anchor) => [anchor.entryId, anchor]))
  const forks = new Set(forkEntryIds)

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

/** Times the reader states for a range's boundaries, for one reconciliation and nothing else. */
export interface BoundaryRestatement {
  from?: TimeTracker
  to?: TimeTracker
}

/** The range's boundaries as the reconciliation reads them: restated where the reader said so. */
export function restateBoundaries(
  range: Pick<SelectableRange, 'from' | 'to'>,
  restated: BoundaryRestatement = {},
): { from: Boundary; to: Boundary } {
  const restate = (boundary: Boundary, time: TimeTracker | undefined): Boundary =>
    time ? { ...boundary, time: normalizeTime(time) } : boundary
  return { from: restate(range.from, restated.from), to: restate(range.to, restated.to) }
}

/**
 * Times the reader restated for a range's boundaries. An `edit` changes the boundary's anchor and is
 * stored with the reconciliation, note included; an `assert` is never stored.
 */
export type BoundaryDrafts = Partial<
  Record<'from' | 'to', { kind: 'edit' | 'assert'; time: TimeTracker; note?: string | null }>
>

/**
 * The anchors a reconciliation stores: those the reader edited. Decided by the draft, not by the
 * anchor found now, so an assertion never turns into an overwrite of an anchor added since.
 */
export function editedAnchors(
  range: Pick<SelectableRange, 'from' | 'to'>,
  drafts: BoundaryDrafts,
  anchorFor: (entryId: string) => TimeAnchor | undefined,
): TimeAnchor[] {
  return (['from', 'to'] as const).flatMap((which) => {
    const draft = drafts[which]
    const existing = draft?.kind === 'edit' ? anchorFor(range[which].entryId) : undefined
    if (!draft || !existing) return []
    return [
      {
        ...existing,
        assertedTime: normalizeTime(draft.time),
        note: draft.note === undefined ? existing.note : draft.note,
      },
    ]
  })
}

/**
 * Whether a boundary may be restated. An earlier boundary only moves the baseline, so even a player
 * action may be; a later one is written to its entry, and an action has no ending to write.
 */
export function canRestate(which: 'from' | 'to', entry: StoryEntry | undefined): boolean {
  return !!entry && (which === 'from' || entry.type !== 'user_action')
}

/**
 * Whether applying would move the time branches open on. Only a later boundary is written through
 * to its entry, so only a later boundary can. Branches open on the checkpoint's clock, which can
 * disagree with the entry's ending, and applying rewrites both.
 */
export function movesForkEnding(
  entry: StoryEntry | undefined,
  effectiveTime: TimeTracker | null,
  forked: boolean,
  checkpointClocks: (TimeTracker | null | undefined)[] = [],
): boolean {
  if (!forked || !entry || !effectiveTime) return false
  const target = toMinutes(effectiveTime)
  const recorded = entry.metadata?.timeEnd
  if (!recorded || toMinutes(recorded) !== target) return true
  return checkpointClocks.some((clock) => !!clock && toMinutes(clock) !== target)
}

export type RangeRefusal = {
  reason: 'unusable-boundary' | 'backwards-span'
  boundaries: Boundary[]
}

/** Null when the range can be reconciled; the refusal otherwise. Equal times are allowed. */
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
