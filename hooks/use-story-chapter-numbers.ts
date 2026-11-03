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

/**
 * Each story's open chapter number, null until the first read lands. `focused` going true rereads:
 * the list stays mounted under the reader, its key doesn't move, and the client never goes stale.
 */
export function useStoryChapterNumbers(focused: boolean): ChapterNumbers | null {
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const { data, refetch } = useQuery({
    queryKey: ['story-chapter-numbers', settleCount],
    queryFn: readNumbers,
    // Local DB read, not a flaky network call: a failure is worth logging, not retrying.
    retry: false,
    gcTime: 30_000,
    // A local read: TanStack's default pauses it while the browser reports no network.
    networkMode: 'always',
  })

  // data is undefined while a new key loads and after a failed read; hold the last read.
  const [lastRead, setLastRead] = useState<ChapterNumbers | null>(null)
  const shown = data ?? lastRead
  if (shown !== lastRead) setLastRead(shown)

  const wasFocusedRef = useRef(focused)
  useEffect(() => {
    if (focused && !wasFocusedRef.current) void refetch()
    wasFocusedRef.current = focused
  }, [focused, refetch])

  return shown
}
