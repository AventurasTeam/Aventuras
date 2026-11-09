import { and, eq, inArray } from 'drizzle-orm'

import {
  branches,
  chunked,
  isStoryMode,
  stories,
  storyEntries,
  type StoryEntry,
  type StoryMode,
} from '@/lib/db'

import type { TaskPromptContext } from './task'
import { buildCloseTurns, type CloseRangeEntry, type CloseTurn } from '../chapter-context'

export type TaskTurns = { entries: readonly CloseRangeEntry[]; closeTurns: CloseTurn[] }

/** The task's chapterEntryIds, in position order, under their turn handles. */
export async function readTaskTurns(ctx: TaskPromptContext): Promise<TaskTurns> {
  const rows: StoryEntry[] = []
  for (const ids of chunked(ctx.chapterEntryIds))
    rows.push(
      ...(await ctx.db
        .select()
        .from(storyEntries)
        .where(and(eq(storyEntries.branchId, ctx.branchId), inArray(storyEntries.id, ids)))),
    )
  const entries = rows
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
    .flatMap((row): CloseRangeEntry[] =>
      row.kind === 'system' ? [] : [{ ...row, kind: row.kind }],
    )
  // handleOf is a method on the id map: passed bare it would lose its `this`.
  return { entries, closeTurns: buildCloseTurns(entries, (id) => ctx.ids.handleOf(id)) }
}

/** The story's mode, from the stories row behind the branch. */
export async function storyModeOf(ctx: TaskPromptContext): Promise<StoryMode> {
  const [row] = await ctx.db
    .select({ definition: stories.definition })
    .from(branches)
    .innerJoin(stories, eq(stories.id, branches.storyId))
    .where(eq(branches.id, ctx.branchId))
    .limit(1)
  const mode: unknown = row?.definition?.mode
  if (!isStoryMode(mode))
    throw new Error(`close task: the story behind branch ${ctx.branchId} has no mode`)
  return mode
}
