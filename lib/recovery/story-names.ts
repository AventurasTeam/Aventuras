import { inArray } from 'drizzle-orm'

import { stories, type DbCtx } from '@/lib/db'
import type { RecoveryReport } from '@/lib/pipeline'

import type { RecoveryStoryNames } from './copy'

export async function loadRecoveryStoryNames(
  report: RecoveryReport,
  db: DbCtx['db'],
): Promise<RecoveryStoryNames> {
  const storyIds = new Set<string>()
  for (const run of report.reversed) {
    if (run.storyId !== null) storyIds.add(run.storyId)
  }

  if (storyIds.size === 0) return {}

  const rows = await db
    .select({ id: stories.id, title: stories.title })
    .from(stories)
    .where(inArray(stories.id, [...storyIds]))

  return Object.fromEntries(rows.map(({ id, title }) => [id, title]))
}
