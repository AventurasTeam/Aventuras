import type { StoryEntry } from '$lib/types'

/** `metadata.source` of the system entry a failed generation leaves in place of its narration. */
export const GENERATION_ERROR_SOURCE = 'generation-error'

/** Whether a system entry records a failed generation, which offers Retry and Dismiss. */
export function isGenerationErrorEntry(entry: StoryEntry): boolean {
  return entry.type === 'system' && entry.metadata?.source === GENERATION_ERROR_SOURCE
}

/**
 * Walks backward from the entry with the given ID and returns the nearest
 * preceding `user_action` entry, or null if none is found (or the entry
 * itself isn't in the list).
 */
export function findPrecedingUserAction(entries: StoryEntry[], entryId: string): StoryEntry | null {
  const entryIndex = entries.findIndex((e) => e.id === entryId)
  if (entryIndex <= 0) return null

  for (let i = entryIndex - 1; i >= 0; i--) {
    if (entries[i].type === 'user_action') return entries[i]
  }
  return null
}
