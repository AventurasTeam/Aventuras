import { useMemo } from 'react'

import { type StoryEntry } from '@/lib/db'
import { countEntryTokens } from '@/lib/retrieval'
import { currentStoryStore, entriesStore } from '@/lib/stores'

// Picked off the row rather than restated: `kind` stays the schema's union, so
// the 'system' literal below is checked instead of being any string.
type ProgressEntry = Pick<StoryEntry, 'id' | 'content' | 'chapterId' | 'kind'>

/**
 * Percent of the story's chapter token threshold the open region consumes, 0–100.
 *
 * Open region = non-`system` entries whose `chapterId` is still null
 * (data-model.md → Chapters / memory system); seeded and imported stories
 * arrive with chapters already closed, so it is not the whole branch, and
 * `system` rows are technical-only, never prose the threshold is measured
 * against. Counts only the entries passed in — the reader holds a trailing
 * window, so a longer open region under-reports. A non-positive or non-finite
 * threshold reads as 0.
 */
export function openRegionProgress(entries: readonly ProgressEntry[], threshold: number): number {
  if (!Number.isFinite(threshold) || threshold <= 0) return 0
  let tokens = 0
  for (const e of entries) {
    if (e.kind === 'system' || e.chapterId !== null) continue
    tokens += countEntryTokens(e.id, e.content)
  }
  return Math.min(100, (tokens / threshold) * 100)
}

/**
 * Progress for `storyId`'s open region, or 0 when that story is not the open
 * one. The scope argument is required because both stores below are global and
 * nothing clears them on navigation: a surface that read them unscoped would
 * show the last-opened story's progress against its threshold.
 */
export function useOpenRegionTokens(storyId: string | null | undefined): number {
  // Select the raw map, per the reader: a fresh array from the selector breaks
  // useSyncExternalStore's snapshot-stability contract. The map identity moves
  // only on an entries write — stream chunks land in reader-local state — so
  // the memo spares the walk on the per-chunk re-renders.
  const rows = entriesStore.useEntries((m) => m)
  const threshold = currentStoryStore.useCurrentStory((open) =>
    open != null && open.storyId === storyId ? open.settings.chapterTokenThreshold : 0,
  )
  // Branch-filtered like the reader's own read of this map: the working set holds
  // one branch, but a branch switch moves the open story before the re-hydrate
  // lands, and counting the outgoing branch's entries against the incoming
  // branch's threshold reports a region this branch does not have.
  const branchId = currentStoryStore.useCurrentStory((open) =>
    open != null && open.storyId === storyId ? open.branchId : null,
  )
  return useMemo(
    () =>
      openRegionProgress(
        [...rows.values()].filter((e) => e.branchId === branchId),
        threshold,
      ),
    [rows, branchId, threshold],
  )
}
