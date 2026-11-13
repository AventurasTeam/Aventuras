import { and, asc, desc, eq, gt, inArray, type SQL } from 'drizzle-orm'

import type { GuardRow } from '@/lib/actions/types'
import type { PromptHalves } from '@/lib/ai'
import {
  chapters,
  chunked,
  entities,
  happeningAwareness,
  happenings,
  type StoryMode,
} from '@/lib/db'
import { compareId } from '@/lib/list-modules'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'

import { setPinTool } from './awareness-tools'
import { TURN_PREFIX } from './ids'
import { refsIn } from './read-tools'
import { readTurnsTool } from './read-turns'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import { storyModeOf } from './turns'
import { closeRangeOf } from '../close-intermediates'

/** chapter-close.md → 3d: the high-frequency set's size; tuning's to move. */
export const AWARENESS_TOP_N = 20

export type AwarenessListRow = {
  /** The row's aw handle. */
  id: string
  /** `id` is the character's handle. */
  character: { id: string; name: string }
  decayResistance: number | null
  source: string
  /** The t handle it was learned at; '' when unrecorded. */
  learnedAt: string
  list: 'chapter' | 'frequent'
}

export type AwarenessGroup = { happening: { id: string; title: string }; rows: AwarenessListRow[] }

type AwarenessShow = { groups: AwarenessGroup[]; summary: string; mode: StoryMode }

type ListedRow = {
  id: string
  happeningId: string
  characterId: string
  learnedAtEntryId: string | null
  decayResistance: number | null
  source: string | null
  title: string
  name: string
}
type Listed = { row: ListedRow; list: AwarenessListRow['list'] }
type Group = { id: string; title: string; listed: Listed[] }

const LIST_ORDER: Readonly<Record<AwarenessListRow['list'], number>> = { chapter: 0, frequent: 1 }

// A pin on a common-knowledge happening reaches nothing: the ranker skips its decay.
const NOT_COMMON_KNOWLEDGE = eq(happenings.commonKnowledge, 0)

// Never retrieval_count: the task sees membership in the set, not the count (3d).
function listable(ctx: TaskPromptContext, where: SQL) {
  return ctx.db
    .select({
      id: happeningAwareness.id,
      happeningId: happeningAwareness.happeningId,
      characterId: happeningAwareness.characterId,
      learnedAtEntryId: happeningAwareness.learnedAtEntryId,
      decayResistance: happeningAwareness.decayResistance,
      source: happeningAwareness.source,
      title: happenings.title,
      name: entities.name,
    })
    .from(happeningAwareness)
    .innerJoin(
      happenings,
      and(
        eq(happenings.branchId, happeningAwareness.branchId),
        eq(happenings.id, happeningAwareness.happeningId),
      ),
    )
    .innerJoin(
      entities,
      and(
        eq(entities.branchId, happeningAwareness.branchId),
        eq(entities.id, happeningAwareness.characterId),
      ),
    )
    .where(and(eq(happeningAwareness.branchId, ctx.branchId), NOT_COMMON_KNOWLEDGE, where))
}

async function chapterRows(ctx: TaskPromptContext): Promise<ListedRow[]> {
  const rows: ListedRow[] = []
  for (const ids of chunked(ctx.taskEntryIds))
    rows.push(...(await listable(ctx, inArray(happeningAwareness.learnedAtEntryId, ids))))
  return rows
}

// Read when the task starts, after Happenings' merges, so a count a merge summed counts.
async function frequentRows(ctx: TaskPromptContext): Promise<ListedRow[]> {
  return listable(ctx, gt(happeningAwareness.retrievalCount, 0))
    .orderBy(desc(happeningAwareness.retrievalCount), asc(happeningAwareness.id))
    .limit(AWARENESS_TOP_N)
}

// Code units, never localeCompare: host locale would make the prompt's order device-dependent.
function byHappening(listed: readonly Listed[]): Group[] {
  const groups = new Map<string, Group>()
  for (const item of listed) {
    const group = groups.get(item.row.happeningId) ?? {
      id: item.row.happeningId,
      title: item.row.title,
      listed: [],
    }
    group.listed.push(item)
    groups.set(group.id, group)
  }
  return [...groups.values()]
    .sort((a, b) => compareId(a.title, b.title) || compareId(a.id, b.id))
    .map((group) => ({
      ...group,
      listed: [...group.listed].sort(
        (a, b) =>
          LIST_ORDER[a.list] - LIST_ORDER[b.list] ||
          compareId(a.row.name, b.row.name) ||
          compareId(a.row.id, b.row.id),
      ),
    }))
}

// An entry outside the chapter takes the next t handle, so read_turns can show a row's origin.
function learnedAtHandle(ctx: TaskPromptContext, entryId: string | null): string {
  return entryId !== null && entryId.startsWith(TURN_PREFIX) ? ctx.ids.showTurn(entryId) : ''
}

async function chapterSummary(ctx: TaskPromptContext): Promise<string> {
  const range = closeRangeOf(ctx.phase.intermediates)
  if (range === undefined)
    throw new Error('awareness: the close holds no range to read its chapter from')
  const [row] = await ctx.db
    .select({ summary: chapters.summary })
    .from(chapters)
    .where(and(eq(chapters.branchId, ctx.branchId), eq(chapters.id, range.chapterId)))
    .limit(1)
  return row?.summary ?? ''
}

// memory/chapter-close.md → 3d: the chapter's rows and the high-frequency set, with the chapter's
// summary. Each row shows the pin set_pin writes, so the start counts it as read (C11).
async function startAwareness(ctx: TaskPromptContext): Promise<TaskStart<AwarenessShow> | null> {
  const ofChapter = await chapterRows(ctx)
  const inChapter = new Set(ofChapter.map((row) => row.id))
  const frequent = (await frequentRows(ctx)).filter((row) => !inChapter.has(row.id))
  if (ofChapter.length === 0 && frequent.length === 0) return null
  const groups = byHappening([
    ...ofChapter.map((row): Listed => ({ row, list: 'chapter' })),
    ...frequent.map((row): Listed => ({ row, list: 'frequent' })),
  ])
  // Handles in the order shown; a row a shown text cites is named, so a write copying it stores
  // the name, not the handle.
  for (const group of groups) {
    ctx.ids.show(group.id, group.title)
    for (const { row } of group.listed) {
      ctx.ids.showAwareness(row.id)
      ctx.ids.show(row.characterId, row.name)
      learnedAtHandle(ctx, row.learnedAtEntryId)
    }
  }
  const listed = groups.flatMap((group) => group.listed)
  await refsIn(
    ctx,
    listed.map(({ row }) => [row.title, row.name, row.source ?? '']),
  )
  const handled = (value: string): string => ctx.ids.withHandles(value)
  return {
    show: {
      groups: groups.map((group) => ({
        happening: { id: ctx.ids.show(group.id, group.title), title: handled(group.title) },
        rows: group.listed.map(({ row, list }) => ({
          id: ctx.ids.showAwareness(row.id),
          character: { id: ctx.ids.show(row.characterId, row.name), name: handled(row.name) },
          decayResistance: row.decayResistance,
          source: handled(row.source ?? ''),
          learnedAt: learnedAtHandle(ctx, row.learnedAtEntryId),
          list,
        })),
      })),
      summary: handled(await chapterSummary(ctx)),
      mode: await storyModeOf(ctx),
    },
    seeds: listed.map(({ row }): GuardRow => ({ table: 'happening_awareness', id: row.id })),
  }
}

// The task shows no prose, so the template names the turns its writes may cite.
function chapterTurns(ctx: TaskPromptContext): { first: string; last: string } {
  const handle = (id: string | undefined): string =>
    id === undefined ? '' : (ctx.ids.handleOf(id) ?? '')
  return { first: handle(ctx.taskEntryIds[0]), last: handle(ctx.taskEntryIds.at(-1)) }
}

function renderAwareness(
  { show }: TaskStart<AwarenessShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  return renderTemplate(TEMPLATE_IDS.closeAwareness, {
    mode: show.mode,
    closeAwarenessRows: show.groups,
    closeChapterSummary: show.summary,
    closeChapterTurns: chapterTurns(ctx),
    closeWritesSoFar: ctx.writesSoFar,
  })
}

/** memory/chapter-close.md → Run order: Awareness, 3d, once after the parts. */
export const awarenessTask: CloseTaskDef<AwarenessShow> & { task: 'awareness' } = {
  task: 'awareness',
  tools: [readTurnsTool, setPinTool],
  readFields: {},
  start: startAwareness,
  render: renderAwareness,
}
