import { and, eq, inArray } from 'drizzle-orm'

import { countWithStoredProse, type PromptHalves } from '@/lib/ai'
import {
  branches,
  chunked,
  isStoryMode,
  readBranchLead,
  readEntityNames,
  stories,
  storyEntries,
  type DbCtx,
  type StoryEntry,
  type StoryMode,
} from '@/lib/db'
import { renderTemplate, type TemplateId } from '@/lib/prompts'
import { oneLine } from '@/lib/text'
import { leadStampOf } from '@/lib/world'

import type { CloseIds } from './ids'
import type { TaskPromptContext } from './task'
import {
  buildCloseTurns,
  type CloseHandle,
  type CloseRangeEntry,
  type CloseTurn,
} from '../chapter-context'
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
  /** The branch's lead as read for these turns' marks: raw id, its name on one line. */
  lead: { id: string; name: string } | null
}

/** The branch's lead by the flag, its name on one line; null with none, or with two (logged). */
export async function readCloseLead(ctx: {
  readonly db: DbCtx['db']
  readonly branchId: string
}): Promise<{ id: string; name: string } | null> {
  const lead = await readBranchLead(ctx.branchId, ctx.db)
  return lead === null ? null : { id: lead.id, name: oneLine(lead.name) }
}

/** Names the characters `entries`' stamps name; undefined for a row gone. */
export async function readStampedNames(
  ctx: { readonly db: DbCtx['db']; readonly branchId: string },
  entries: readonly Pick<StoryEntry, 'metadata'>[],
): Promise<(id: string) => string | undefined> {
  const stamped = [...new Set(entries.flatMap((entry) => leadStampOf(entry) ?? []))]
  const names = await readEntityNames(ctx.branchId, stamped, ctx.db)
  return (id) => names.get(id)
}

/** The lead as a close task names it: under its handle. */
export type ShownLead = { id: CloseHandle; name: string }

/**
 * The lead a task's user half names (VARIABLES.chapter → lead), under its handle. A start calls it
 * after it shows its rows, so they keep their numbering; null with no lead.
 */
export function showLead(
  ids: CloseIds,
  lead: { id: string; name: string } | null,
): ShownLead | null {
  return lead === null ? null : { id: ids.show(lead.id, lead.name) as CloseHandle, name: lead.name }
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
  // One read serves the marks and the lead line: the close's hard gate holds the flag still.
  const lead = await readCloseLead(ctx)
  const nameOf = await readStampedNames(ctx, entries)
  // handleOf and show are methods on the id map: passed bare they would lose their `this`.
  return {
    entries,
    closeTurns: buildCloseTurns(entries, (id) => ctx.ids.handleOf(id), {
      namedLeadId: lead?.id ?? null,
      nameOf,
      show: (id, name) => ctx.ids.show(id, name),
    }),
    proseTokens,
    lead,
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
