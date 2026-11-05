import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generationStore, readStoryChapterNumbers } from '@/lib/stores'

type ChapterNumbers = ReadonlyMap<string, number>

// Logs from the shared fetch, since every mounted observer receives the same error.
async function readNumbers(): Promise<ChapterNumbers> {
  try {
    return await readStoryChapterNumbers(db)
  } catch (error) {
    logger.warn('app.story_chapter_numbers_read_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function sameNumbers(a: ChapterNumbers, b: ChapterNumbers): boolean {
  if (a.size !== b.size) return false
  for (const [storyId, number] of a) if (b.get(storyId) !== number) return false
  return true
}

/**
 * Each story's open chapter number, null until the first read lands, then the same object until
 * the numbers change. Reads only while `focused`: the list stays mounted under the reader, where a
 * settle neither reads nor rerenders it. `focused` going true rereads, since the client never goes
 * stale.
 */
export function useStoryChapterNumbers(focused: boolean): ChapterNumbers | null {
  const settleCount = generationStore.useGeneration((s) => (focused ? s.settleCount : null))
  const { data, refetch } = useQuery({
    queryKey: ['story-chapter-numbers', settleCount],
    queryFn: readNumbers,
    enabled: focused,
  })

  // data is undefined while hidden, while a new key loads and after a failed read: hold the last.
  const [lastRead, setLastRead] = useState<ChapterNumbers | null>(null)
  const shown =
    data === undefined || (lastRead !== null && sameNumbers(data, lastRead)) ? lastRead : data
  if (shown !== lastRead) setLastRead(shown)

  const wasFocusedRef = useRef(focused)
  useEffect(() => {
    if (focused && !wasFocusedRef.current) void refetch()
    wasFocusedRef.current = focused
  }, [focused, refetch])

  return shown
}
