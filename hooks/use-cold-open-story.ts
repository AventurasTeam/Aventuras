import { useEffect } from 'react'

import { loadOpenStory } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { currentStoryStore, rehydrateStories, type OpenStory } from '@/lib/stores'

import { useLeaveFailedStoryOpen } from './use-leave-failed-story-open'

const ctx = { db, runInTransaction }

/**
 * A story-scoped surface's cold mount (reload, deep link) hydrates the working set the way the
 * reader does, and leaves for the story list when the branch can't open. Returns the open story
 * once it is this branch's.
 */
export function useColdOpenStory(branchId: string, surface: 'world' | 'plot'): OpenStory | null {
  const leaveFailedOpen = useLeaveFailedStoryOpen()
  useEffect(() => {
    if (branchId === '') {
      logger.warn(`app.${surface}_story_not_found`, { branchId })
      leaveFailedOpen()
      return
    }
    if (currentStoryStore.getCurrentStory()?.branchId === branchId) return
    let current = true
    void loadOpenStory(branchId, ctx, () => current)
      .then((result) => {
        if (!current || result.status === 'ok') return
        // `failed` is logged where it's detected; `no-story` is logged nowhere else.
        if (result.status === 'no-story')
          logger.warn(`app.${surface}_story_not_found`, { branchId })
        leaveFailedOpen()
      })
      .catch((err: unknown) => {
        logger.error(`app.${surface}_story_load_failed`, {
          branchId,
          error: err instanceof Error ? err.message : String(err),
        })
        if (current) leaveFailedOpen()
      })
    return () => {
      current = false
    }
  }, [branchId, surface, leaveFailedOpen])
  useEffect(() => {
    // Never rejects: it logs its own failure.
    void rehydrateStories(db)
  }, [])
  return currentStoryStore.useCurrentStory((o) => (o?.branchId === branchId ? o : null))
}
