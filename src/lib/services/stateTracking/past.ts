import type { StoryEntry, WorldStateRecord } from '#lib/types/index.ts'
import { withLegacyRecords } from './legacy'
import type { AnchorCandidate, RunQuery } from './runs'

/** Everything a past state on the open branch is resolved from, loaded once. */
export interface PastSources {
  /** The entries on the branch line, in story order. */
  entries: StoryEntry[]
  /** The stored records on the branch line; old deltas are added from `entries`. */
  records: WorldStateRecord[]
  /** The branch's automatic and closing snapshots, without their contents. */
  snapshots: {
    id: string
    entryId: string
    entryPosition: number
    createdAt: number
    /** Saved with the lorebook. */
    complete: boolean
    closing: boolean
  }[]
  checkpoints: {
    id: string
    lastEntryId: string
    createdAt: number
    anchored: boolean
    branchId: string | null
    /** Saved with the lorebook. */
    complete: boolean
  }[]
  /** The open branch and its ancestors. */
  lineBranchIds: (string | null)[]
  tracking: { on: boolean; enabledSince: number | null }
  now: number
}

/**
 * The full states a past state can be rebuilt from: complete snapshots, checkpoints anywhere on
 * the branch line (an ancestor's at an inherited entry holds the state this branch had there),
 * and the live state. A checkpoint made after its entry had a successor was itself rebuilt, so
 * it cannot vouch.
 */
export function anchorCandidates(src: PastSources): AnchorCandidate[] {
  const positions = new Map(src.entries.map((e) => [e.id, e.position]))
  const line = new Set(src.lineBranchIds)
  const last = src.entries[src.entries.length - 1]
  const nextAfter = (position: number) => src.entries.find((e) => e.position > position)
  return [
    ...src.snapshots
      .filter((s) => s.complete)
      .map((s) => ({
        kind: 'snapshot' as const,
        id: s.id,
        position: s.entryPosition,
        takenAt: s.createdAt,
      })),
    ...src.checkpoints
      .filter(
        (cp) =>
          cp.complete && cp.anchored && line.has(cp.branchId) && positions.has(cp.lastEntryId),
      )
      .filter((cp) => {
        const next = nextAfter(positions.get(cp.lastEntryId)!)
        return !next || cp.createdAt < next.createdAt
      })
      .map((cp) => ({
        kind: 'checkpoint' as const,
        id: cp.id,
        position: positions.get(cp.lastEntryId)!,
        takenAt: cp.createdAt,
      })),
    ...(last
      ? [{ kind: 'live' as const, id: null, position: last.position, takenAt: src.now }]
      : []),
  ]
}

export function pastQuery(src: PastSources, target: number): RunQuery {
  return {
    line: src.entries,
    records: withLegacyRecords(src.entries, src.records),
    snapshots: src.snapshots.map((s) => ({
      entryId: s.entryId,
      takenAt: s.createdAt,
      closing: s.closing,
    })),
    target,
    candidates: anchorCandidates(src),
    tracking: src.tracking,
  }
}

/** Positions of the incomplete snapshots from `from` up to `bound`, which could not be used. */
export function skippedSnapshots(src: PastSources, from: number, bound: number): number[] {
  return src.snapshots
    .filter((s) => !s.complete && s.entryPosition >= from && s.entryPosition <= bound)
    .map((s) => s.entryPosition)
    .sort((a, b) => a - b)
}
