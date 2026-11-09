import { and, eq, inArray } from 'drizzle-orm'

import { primePromptCount } from '@/lib/ai'
import {
  branches,
  chunked,
  isStoryMode,
  stories,
  storyEntries,
  type StoryEntry,
  type StoryMode,
} from '@/lib/db'
import { promptProse } from '@/lib/piggyback'
import { countTokens } from '@/lib/tokens'

import type { TaskPromptContext } from './task'
import { buildCloseTurns, type CloseRangeEntry, type CloseTurn } from '../chapter-context'

export type TaskTurns = {
  entries: readonly CloseRangeEntry[]
  closeTurns: CloseTurn[]
  /** Each entry's stored contentTokens summed; a null one counted from promptProse. */
  proseTokens: number
}

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
  // C5: content_tokens has no backfill, so a row stored without one is counted here.
  const proseTokens = entries.reduce(
    (sum, entry) => sum + (entry.contentTokens ?? countTokens(promptProse(entry))),
    0,
  )
  // handleOf is a method on the id map: passed bare it would lose its `this`.
  return {
    entries,
    closeTurns: buildCloseTurns(entries, (id) => ctx.ids.handleOf(id)),
    proseTokens,
  }
}

/** The turns with every content blank: the half primeCloseSystemCount counts. */
export function blankTurns(turns: readonly CloseTurn[]): CloseTurn[] {
  return turns.map((turn) => ({ ...turn, content: '' }))
}

/**
 * Primes `system` at `countTokens(blankSystem) + proseTokens` (developer, 2026-11-09), so a part's
 * first step never encodes the chapter. An older row's stored count includes a trailing block the
 * prompt strips, so the total can run slightly long: accepted as small, the check has no margin.
 */
export function primeCloseSystemCount(
  system: string,
  blankSystem: string,
  proseTokens: number,
): void {
  primePromptCount(system, countTokens(blankSystem) + proseTokens)
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
