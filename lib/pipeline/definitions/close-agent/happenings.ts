import { and, eq, inArray } from 'drizzle-orm'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import type { GuardRow } from '@/lib/actions/types'
import type { PromptHalves } from '@/lib/ai'
import { entities, happeningAwareness, happeningInvolvements, type StoryMode } from '@/lib/db'
import { compareId } from '@/lib/list-modules'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'

import { mergeHappeningsTool, readHappenings } from './happening-tools'
import { readRowTool, refsIn } from './read-tools'
import { readTurnsTool } from './read-turns'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import type { ReadFields } from './tool'
import { storyModeOf } from './turns'
import { closeClustersOf } from '../close-intermediates'

/** C11: the fields Happenings' start shows, so read_row returns the same and its rows count as read. */
export const HAPPENINGS_READ_FIELDS: ReadFields = {
  happening: ['title', 'description', 'commonKnowledge', 'occurredAtEntryId'],
}

type NamedEntity = { id: string; name: string }

/** A clustered happening as the template shows it: `id`, the cast's ids and `turn` are handles. */
export type HappeningClusterRow = {
  id: string
  title: string
  description: string
  cast: NamedEntity[]
  /** The characters with an awareness row of it. */
  knownBy: NamedEntity[]
  turn: string
  commonKnowledge: boolean
}

type HappeningsShow = { clusters: HappeningClusterRow[][]; mode: StoryMode }

type EntityLinks = {
  table: SQLiteTable
  branchId: AnySQLiteColumn<{ data: string; notNull: true }>
  happeningId: AnySQLiteColumn<{ data: string; notNull: true }>
  entityId: AnySQLiteColumn<{ data: string; notNull: true }>
}

const INVOLVEMENTS: EntityLinks = {
  table: happeningInvolvements,
  branchId: happeningInvolvements.branchId,
  happeningId: happeningInvolvements.happeningId,
  entityId: happeningInvolvements.entityId,
}

const AWARENESS: EntityLinks = {
  table: happeningAwareness,
  branchId: happeningAwareness.branchId,
  happeningId: happeningAwareness.happeningId,
  entityId: happeningAwareness.characterId,
}

/** Each happening's entities through a link table: those that still exist, by name then id. */
async function readLinked(
  ctx: TaskPromptContext,
  links: EntityLinks,
  happeningIds: readonly string[],
): Promise<ReadonlyMap<string, NamedEntity[]>> {
  const rows = await ctx.db
    .select({ happeningId: links.happeningId, id: entities.id, name: entities.name })
    .from(links.table)
    .innerJoin(
      entities,
      and(eq(entities.branchId, links.branchId), eq(entities.id, links.entityId)),
    )
    .where(and(eq(links.branchId, ctx.branchId), inArray(links.happeningId, [...happeningIds])))
  const linked = new Map<string, NamedEntity[]>()
  for (const { happeningId, id, name } of rows) {
    const members = linked.get(happeningId) ?? []
    if (!members.some((member) => member.id === id)) members.push({ id, name })
    linked.set(happeningId, members)
  }
  for (const members of linked.values())
    members.sort((a, b) => compareId(a.name, b.name) || compareId(a.id, b.id))
  return linked
}

// memory/chapter-close.md → Run order: the clusters the range embed found. A row gone since then
// drops out, and a cluster left with one row has nothing to merge.
async function startHappenings(ctx: TaskPromptContext): Promise<TaskStart<HappeningsShow> | null> {
  const clusters = closeClustersOf(ctx.phase.intermediates)
  if (clusters.length === 0) return null
  const stored = await readHappenings(ctx, clusters.flat())
  const listed = clusters
    .map((cluster) => cluster.flatMap((id) => stored.get(id) ?? []))
    .filter((cluster) => cluster.length >= 2)
  if (listed.length === 0) return null
  const rows = listed.flat()
  const rowIds = rows.map((row) => row.id)
  const casts = await readLinked(ctx, INVOLVEMENTS, rowIds)
  // Common knowledge reaches every character, so its awareness rows list no one and get no handle.
  const knownBy = await readLinked(
    ctx,
    AWARENESS,
    rows.filter((row) => row.commonKnowledge !== 1).map((row) => row.id),
  )
  // Handles in list order: happenings, then casts, then knownBy, so awareness-only entities never
  // move a cast number. A row a text cites is named, so a write copying its handle stores the name.
  for (const row of rows) ctx.ids.show(row.id, row.title)
  for (const row of rows)
    for (const member of casts.get(row.id) ?? []) ctx.ids.show(member.id, member.name)
  for (const row of rows)
    for (const member of knownBy.get(row.id) ?? []) ctx.ids.show(member.id, member.name)
  await refsIn(
    ctx,
    rows.map((row) => [row.title, row.description]),
  )
  const handled = (value: string): string => ctx.ids.withHandles(value)
  const named = (member: NamedEntity): NamedEntity => ({
    id: ctx.ids.show(member.id, member.name),
    name: handled(member.name),
  })
  return {
    show: {
      mode: await storyModeOf(ctx),
      clusters: listed.map((cluster) =>
        cluster.map(
          (row): HappeningClusterRow => ({
            id: ctx.ids.show(row.id, row.title),
            title: handled(row.title),
            description: handled(row.description ?? ''),
            cast: (casts.get(row.id) ?? []).map(named),
            knownBy: (knownBy.get(row.id) ?? []).map(named),
            turn: row.occurredAtEntryId === null ? '' : ctx.ids.showTurn(row.occurredAtEntryId),
            commonKnowledge: row.commonKnowledge === 1,
          }),
        ),
      ),
    },
    // C11: the start shows every field merge_happenings writes on a happening.
    seeds: rows.map((row): GuardRow => ({ table: 'happenings', id: row.id })),
  }
}

function renderHappenings(
  { show }: TaskStart<HappeningsShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  return renderTemplate(TEMPLATE_IDS.closeHappenings, {
    mode: show.mode,
    closeHappeningClusters: show.clusters,
    closeWritesSoFar: ctx.writesSoFar,
  })
}

/** memory/chapter-close.md → Run order: Happenings, 3e, chapter-wide before the parts. */
export const happeningsTask: CloseTaskDef<HappeningsShow> & { task: 'happenings' } = {
  task: 'happenings',
  tools: [readRowTool, readTurnsTool, mergeHappeningsTool],
  readFields: HAPPENINGS_READ_FIELDS,
  start: startHappenings,
  render: renderHappenings,
}
