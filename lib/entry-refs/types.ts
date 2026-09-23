import type { StoryEntry } from '@/lib/db'

/**
 * One branch entry as Plot renders it: position for `entry #n`, chapter id for the bucket, an
 * excerpt for the picker.
 */
export type EntryRef = {
  id: string
  position: number
  kind: StoryEntry['kind']
  chapterId: string | null
  excerpt: string
}

export type EntryIndex = ReadonlyMap<string, EntryRef>
