import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import { stories, type Story as StoryRow, type dbSchema } from '@/lib/db'

import { hydrateStories } from './stories'

type Db = BaseSQLiteDatabase<'async' | 'sync', unknown, typeof dbSchema>

export async function readStoriesRows(db: Db): Promise<StoryRow[]> {
  return db.select().from(stories)
}

/** Convenience used by the action layer and boot/landing hydration. */
export function rehydrateStories(db: Db): Promise<void> {
  return hydrateStories(() => readStoriesRows(db))
}
