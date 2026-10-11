import type { Branch, Checkpoint, StoryEntry } from '$lib/types'
import { chapterBannerLabel, type ChapterBanner } from './chapterBanners'

/**
 * The number a reader sees for an entry: its stored position, one-based, so the last entry's
 * number equals the entry count shown for the branch.
 */
export function entryNumber(entry: StoryEntry): number {
  return entry.position + 1
}

export interface EntryNumberRange {
  first: number
  last: number
}

/**
 * First and last reader-facing numbers in a run of entries, or null when there are none.
 *
 * Endpoints only: numbering has gaps in imported or repaired stories, so the span between them
 * is not a count. `entries` must be sorted by position, which is how the store holds them.
 */
export function entryNumberRange(entries: StoryEntry[]): EntryNumberRange | null {
  if (entries.length === 0) return null
  return {
    first: entryNumber(entries[0]),
    last: entryNumber(entries[entries.length - 1]),
  }
}

/** Index of the last entry at or below `position`, or -1 when every entry is above it. */
function floorIndex(entries: StoryEntry[], position: number): number {
  let lo = 0
  let hi = entries.length - 1
  let found = -1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (entries[mid].position <= position) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return found
}

/**
 * The entry a reader means by a number, or null when there is nothing to navigate to.
 *
 * Positions are contiguous within a branch, but an imported or repaired story may have gaps,
 * so a miss floors to the nearest lower-numbered entry and both ends clamp. `entries` must be
 * sorted by position, which is how the store holds them.
 */
export function resolveEntryByNumber(
  entries: StoryEntry[],
  input: number | string,
): StoryEntry | null {
  if (entries.length === 0) return null

  const parsed = typeof input === 'number' ? input : Number(input.trim())
  if (typeof input === 'string' && input.trim() === '') return null
  if (!Number.isInteger(parsed)) return null

  const index = floorIndex(entries, parsed - 1)
  return entries[index === -1 ? 0 : index]
}

/**
 * The part of the ui store a jump touches. Named as an interface rather than taken as the store
 * itself so the sequence below can be tested without one.
 */
export interface EntryJumpUi {
  requestEntryScroll(entryId: string): void
  setActivePanel(panel: 'story'): void
  showToast(message: string, type?: 'error' | 'warning' | 'info', duration?: number): void
}

export interface EntryJumpRequest {
  /** The branch being read; a jump can only land on an entry it contains. */
  entries: StoryEntry[]
  entryId: string
  ui: EntryJumpUi
  confirmation: string
  /** Each panel dismisses itself, so the step belongs to the caller. */
  closeOnMobile?: () => void
  canHover: boolean
}

/**
 * Send the reader to an entry in the story from another panel. Returns whether it will land.
 *
 * The presence check runs before the request so the reader is told the truth rather than left
 * with one that never lands. The request goes on the ui store because AppShell destroys the
 * story view while another panel is up.
 */
export function jumpToEntry(request: EntryJumpRequest): boolean {
  const { entries, entryId, ui, confirmation, closeOnMobile, canHover } = request

  const willLand = entries.some((entry) => entry.id === entryId)

  ui.requestEntryScroll(entryId)
  ui.setActivePanel('story')
  closeOnMobile?.()

  // Without hover there is no tooltip and the panel may have closed over the result, so a
  // failed jump has to be distinguishable from one that landed.
  if (!canHover) {
    if (willLand) {
      ui.showToast(confirmation, 'info', 2000)
    } else {
      ui.showToast('That entry is not in this branch', 'error', 2000)
    }
  }

  return willLand
}

/** Most of the viewport the entry above a landing may take when lifted into view. */
const CONTEXT_LIFT_MAX_RATIO = 0.3

/** Share of the gap between cards left above the lifted one; at or over 1 the card before shows. */
const CONTEXT_LIFT_GAP_SHARE = 0.8

export interface ContextLiftInput {
  /** From the top edge of the entry above the landing to the landing's. */
  distance: number
  /** The entry above's own height, so `distance - aboveHeight` is the gap between them. */
  aboveHeight: number
  /** How far below the viewport's top the landing already sits, where it could not reach it. */
  offset: number
  viewportHeight: number
}

/**
 * How far to pull a landing up so the entry above it shows, with its top border clear of the
 * viewport's edge. The entry takes at most 30% of the viewport and is clipped beyond it, whatever
 * its kind; the gap between the two is lifted with it.
 */
export function contextLift(input: ContextLiftInput): number {
  const { distance, aboveHeight, offset, viewportHeight } = input
  const margin = Math.floor(Math.max(0, distance - aboveHeight) * CONTEXT_LIFT_GAP_SHARE)
  const wanted = Math.min(distance, CONTEXT_LIFT_MAX_RATIO * viewportHeight) + margin
  return Math.max(0, wanted - Math.max(0, offset))
}

export type LandmarkKind = 'origin' | 'checkpoint' | 'chapter' | 'tail' | 'first' | 'last'

/** The filter option each kind of row belongs to. */
export type LandmarkFilterGroup = 'firstLast' | 'chapters' | 'checkpoints'

export const LANDMARK_FILTER_GROUPS: LandmarkFilterGroup[] = [
  'firstLast',
  'chapters',
  'checkpoints',
]

const FILTER_GROUP_OF: Record<LandmarkKind, LandmarkFilterGroup> = {
  origin: 'checkpoints',
  checkpoint: 'checkpoints',
  chapter: 'chapters',
  tail: 'chapters',
  first: 'firstLast',
  last: 'firstLast',
}

export function filterLandmarks(
  landmarks: Landmark[],
  shown: Record<LandmarkFilterGroup, boolean>,
): Landmark[] {
  return landmarks.filter((landmark) => shown[FILTER_GROUP_OF[landmark.kind]])
}

export interface Landmark {
  entryId: string
  checkpointId: string | null
  branchId: string | null
  /** Whether "Switch to checkpoint branch" applies. A chapter's start may lie in an ancestor's history. */
  switchesBranch: boolean
  number: number
  kind: LandmarkKind
  label: string
  branchName: string
}

/**
 * The checkpoints a branch owns. An unanchored checkpoint owns nothing — it has no entry left to
 * take a branch from — and its `branchId` is null whatever branch it was made on, so counting one
 * would read it as Main's.
 */
export function checkpointsOnBranch(
  checkpoints: Checkpoint[],
  branchId: string | null,
): Checkpoint[] {
  return checkpoints.filter((c) => c.anchored && c.branchId === branchId)
}

/** Branches created from this checkpoint; inherited visibility alone does not count as use. */
export function branchesUsingCheckpoint(checkpointId: string, branches: Branch[]): Branch[] {
  return branches.filter((branch) => branch.checkpointId === checkpointId)
}

export function checkpointDeletionBlocker(checkpointId: string, branches: Branch[]): string | null {
  const sharingBranches = branchesUsingCheckpoint(checkpointId, branches)
  if (sharingBranches.length === 0) return null

  const branchNames = sharingBranches.map((branch) => `"${branch.name}"`).join(', ')
  return `Cannot delete this checkpoint because it was used to create ${sharingBranches.length === 1 ? 'branch' : 'branches'} ${branchNames}. Delete ${sharingBranches.length === 1 ? 'that branch' : 'those branches'} first.`
}

export interface OrphanedCheckpoint {
  checkpointId: string
  label: string
}

export interface Landmarks {
  /** Rows the reader can navigate to, by ascending entry number. */
  landmarks: Landmark[]
  /** Checkpoints with no anchoring entry left, oldest first — the only order they have. */
  orphaned: OrphanedCheckpoint[]
}

/**
 * The places in the branch being read that are worth returning to: where it began, every
 * checkpoint along the lineage that produced its current state, and where each chapter starts.
 *
 * A chapter or tail row sorts ahead of any other row on the same entry, matching the story view, where
 * its banner sits above that entry. The first-entry row leads the list and the last-entry row ends it, whatever
 * else shares their entries.
 *
 * They mark the first and last entry of the branch as read. A single entry gets the first-entry row only.
 *
 * A checkpoint missing from `entries` is two different things, and they are not shown alike: one
 * anchored elsewhere belongs to another branch and is left out, while one with no anchoring entry
 * at all is orphaned and is returned separately, since it has no entry to number or navigate to.
 */
export function buildLandmarks(
  entries: StoryEntry[],
  checkpoints: Checkpoint[],
  branches: Branch[],
  activeBranch: Branch | null,
  chapterBanners?: Map<string, ChapterBanner>,
): Landmarks {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]))
  const landmarks: Landmark[] = []

  function getBranchName(branchId: string | null): string {
    if (!branchId) return 'Main'
    return branchNames.get(branchId) ?? 'Unknown branch'
  }

  /** The checkpoint an origin row was rendered for, which must not be listed a second time. */
  let originCheckpointId: string | null = null

  if (activeBranch) {
    const forkEntry = byId.get(activeBranch.forkEntryId)
    if (forkEntry) {
      // The branch was forked from a checkpoint on its parent, and that checkpoint's entry is
      // this fork entry. Naming the row after it keeps every row in the list a checkpoint name.
      // It is not among the checkpoint rows below: it belongs to the parent branch, so nothing
      // here is listed twice.
      const origin = checkpoints.find((c) => c.id === activeBranch.checkpointId)
      originCheckpointId = origin?.id ?? null
      landmarks.push({
        entryId: forkEntry.id,
        checkpointId: origin?.id ?? null,
        branchId: forkEntry.branchId,
        switchesBranch: true,
        number: entryNumber(forkEntry),
        kind: 'origin',
        label: origin?.name ?? 'Branch origin',
        branchName: getBranchName(forkEntry.branchId),
      })
    }
  }

  const orphaned: (OrphanedCheckpoint & { createdAt: number })[] = []

  for (const checkpoint of checkpoints) {
    if (!checkpoint.anchored) {
      // An unanchored checkpoint can still be the one an origin row was named after, where a
      // branch's fork entry and its fork checkpoint disagree. Listing it here as well would put
      // the same checkpoint in the panel twice.
      if (checkpoint.id === originCheckpointId) continue
      orphaned.push({
        checkpointId: checkpoint.id,
        label: checkpoint.name,
        createdAt: checkpoint.createdAt,
      })
      continue
    }

    const entry = byId.get(checkpoint.lastEntryId)
    if (!entry || checkpoint.id === activeBranch?.checkpointId) continue
    landmarks.push({
      entryId: entry.id,
      checkpointId: checkpoint.id,
      branchId: entry.branchId,
      switchesBranch: true,
      number: entryNumber(entry),
      kind: 'checkpoint',
      label: checkpoint.name,
      branchName: getBranchName(entry.branchId),
    })
  }

  /** A row that sits on an entry and belongs to no checkpoint. */
  function entryRow(entry: StoryEntry, kind: LandmarkKind, label: string): Landmark {
    return {
      entryId: entry.id,
      checkpointId: null,
      branchId: entry.branchId,
      switchesBranch: false,
      number: entryNumber(entry),
      kind,
      label,
      branchName: getBranchName(entry.branchId),
    }
  }

  for (const [entryId, banner] of chapterBanners ?? []) {
    const entry = byId.get(entryId)
    if (!entry) continue
    landmarks.push(
      entryRow(entry, banner.number === null ? 'tail' : 'chapter', chapterBannerLabel(banner)),
    )
  }

  const first = entries[0]
  const last = entries[entries.length - 1]
  if (first) landmarks.push(entryRow(first, 'first', 'First entry'))
  if (last !== first) landmarks.push(entryRow(last, 'last', 'Last entry'))

  const rank = (landmark: Landmark) => {
    if (landmark.kind === 'first') return -1
    if (landmark.kind === 'last') return 2
    return landmark.kind === 'chapter' || landmark.kind === 'tail' ? 0 : 1
  }

  return {
    landmarks: landmarks.sort((a, b) => a.number - b.number || rank(a) - rank(b)),
    orphaned: orphaned
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ checkpointId, label }) => ({ checkpointId, label })),
  }
}
