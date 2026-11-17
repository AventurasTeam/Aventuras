import { and, eq, inArray } from 'drizzle-orm'

import { countWithStoredProse, type PromptHalves } from '@/lib/ai'
import {
  branches,
  chunked,
  isStoryMode,
  stories,
  storyEntries,
  type StoryEntry,
  type StoryMode,
} from '@/lib/db'
import { renderTemplate, type TemplateId } from '@/lib/prompts'

import type { TaskPromptContext } from './task'
import { buildCloseTurns, type CloseRangeEntry, type CloseTurn } from '../chapter-context'
import { storedProseTokens } from '../entry-reads'

/** A close task's turns, at least one: with none, its prompt's "# The turns" renders empty. */
export type CloseTurns = readonly [CloseTurn, ...CloseTurn[]]

export function hasTurns(turns: readonly CloseTurn[]): turns is CloseTurns {
  return turns.length > 0
}

export type TaskTurns = {
  entries: readonly CloseRangeEntry[]
  closeTurns: readonly CloseTurn[]
  /** Each entry's stored contentTokens summed; a null one counted from promptProse. */
  proseTokens: number
}

/** The entries the task was shown (`taskEntryIds`), in position order, under their turn handles. */
export async function readTaskTurns(ctx: TaskPromptContext): Promise<TaskTurns> {
  const rows: StoryEntry[] = []
  for (const ids of chunked(ctx.taskEntryIds))
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
  const proseTokens = entries.reduce((sum, entry) => sum + storedProseTokens(entry), 0)
  // handleOf is a method on the id map: passed bare it would lose its `this`.
  return {
    entries,
    closeTurns: buildCloseTurns(entries, (id) => ctx.ids.handleOf(id)),
    proseTokens,
  }
}

/** The turns with every content blank: the half the stored counts are added to. */
export function blankTurns(turns: readonly CloseTurn[]): CloseTurn[] {
  return turns.map((turn) => ({ ...turn, content: '' }))
}

/**
 * Renders a close template over `closeTurns` and primes its system half's count from the turns'
 * stored counts, so a part's first step doesn't encode the chapter (a half over the cache's
 * character budget still is). Leans a little either way: high on a stored stripped block, low where
 * o200k merges text across a turn's edges. A template that doesn't render each turn's prose once
 * and whole has its half encoded instead.
 */
export function renderClosePrompt(
  templateId: TemplateId,
  closeTurns: CloseTurns,
  variables: Record<string, unknown>,
  proseTokens: number,
): PromptHalves {
  const halves = renderTemplate(templateId, { ...variables, closeTurns })
  const blank = renderTemplate(templateId, { ...variables, closeTurns: blankTurns(closeTurns) })
  const chars = closeTurns.reduce((sum, turn) => sum + turn.content.length, 0)
  countWithStoredProse(
    halves.system,
    blank.system,
    { chars, tokens: proseTokens },
    { record: true },
  )
  return halves
}

/** Throws when the story behind the branch has no mode. */
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
