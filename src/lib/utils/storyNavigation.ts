import type { Branch, Checkpoint, StoryEntry } from '$lib/types'

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

export type LandmarkKind = 'origin' | 'checkpoint'

export interface Landmark {
  entryId: string
  checkpointId: string | null
  branchId: string | null
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
 * The places in the branch being read that are worth returning to: where it began, and every
 * checkpoint along the lineage that produced its current state.
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
      number: entryNumber(entry),
      kind: 'checkpoint',
      label: checkpoint.name,
      branchName: getBranchName(entry.branchId),
    })
  }

  return {
    landmarks: landmarks.sort((a, b) => a.number - b.number),
    orphaned: orphaned
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ checkpointId, label }) => ({ checkpointId, label })),
  }
}
