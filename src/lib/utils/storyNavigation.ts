import type { Branch, Checkpoint, StoryEntry } from '$lib/types'

/**
 * The number a reader sees for an entry: its stored position, one-based, so the last entry's
 * number equals the entry count shown for the branch.
 */
export function entryNumber(entry: StoryEntry): number {
  return entry.position + 1
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

export type LandmarkKind = 'origin' | 'checkpoint'

export interface Landmark {
  entryId: string
  number: number
  kind: LandmarkKind
  label: string
  preview: string | null
}

/**
 * The places in the branch being read that are worth returning to: where it began, and every
 * checkpoint a new branch can be forked from here.
 *
 * A checkpoint is forkable only from the branch its entry belongs to, so checkpoints inherited
 * from an ancestor are left out — they are visible in the story but cannot be branched from
 * while reading this branch. Resolution goes through `entries` rather than each checkpoint's
 * `entriesSnapshot` (a full deep copy of the story), which also drops checkpoints whose entry a
 * rollback has since deleted.
 */
export function buildLandmarks(
  entries: StoryEntry[],
  checkpoints: Checkpoint[],
  activeBranch: Branch | null,
): Landmark[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const branchId = activeBranch?.id ?? null
  const landmarks: Landmark[] = []

  if (activeBranch) {
    const forkEntry = byId.get(activeBranch.forkEntryId)
    if (forkEntry) {
      // The branch was forked from a checkpoint on its parent, and that checkpoint's entry is
      // this fork entry. Naming the row after it keeps every row in the list a checkpoint name.
      // It is not among the checkpoint rows below: it belongs to the parent branch, so nothing
      // here is listed twice.
      const origin = checkpoints.find((c) => c.id === activeBranch.checkpointId)
      landmarks.push({
        entryId: forkEntry.id,
        number: entryNumber(forkEntry),
        kind: 'origin',
        label: origin?.name ?? 'Branch origin',
        preview: origin?.lastEntryPreview ?? null,
      })
    }
  }

  for (const checkpoint of checkpoints) {
    const entry = byId.get(checkpoint.lastEntryId)
    if (!entry || entry.branchId !== branchId) continue
    landmarks.push({
      entryId: entry.id,
      number: entryNumber(entry),
      kind: 'checkpoint',
      label: checkpoint.name,
      preview: checkpoint.lastEntryPreview,
    })
  }

  return landmarks.sort((a, b) => a.number - b.number)
}
