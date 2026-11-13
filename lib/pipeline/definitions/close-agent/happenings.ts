import { and, eq, inArray } from 'drizzle-orm'

import type { GuardRow } from '@/lib/actions/types'
import type { PromptHalves } from '@/lib/ai'
import {
  entities,
  happeningInvolvements,
  happenings,
  type Happening,
  type StoryMode,
} from '@/lib/db'
import { compareId } from '@/lib/list-modules'
import { renderTemplate, TEMPLATE_IDS } from '@/lib/prompts'

import { mergeHappeningsTool } from './happening-tools'
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

/** A clustered happening as the template shows it: `id`, the cast's ids and `turn` are handles. */
export type HappeningClusterRow = {
  id: string
  title: string
  description: string
  cast: { id: string; name: string }[]
  turn: string
  commonKnowledge: boolean
}

type HappeningsShow = { clusters: HappeningClusterRow[][]; mode: StoryMode }
type CastMember = { id: string; name: string }

async function readClusterRows(
  ctx: TaskPromptContext,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Happening>> {
  const rows = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, ctx.branchId), inArray(happenings.id, [...new Set(ids)])))
  return new Map(rows.map((row) => [row.id, row]))
}

/** Each happening's cast: the entities its involvements name that still exist, by name then id. */
async function readCasts(
  ctx: TaskPromptContext,
  happeningIds: readonly string[],
): Promise<ReadonlyMap<string, CastMember[]>> {
  const rows = await ctx.db
    .select({
      happeningId: happeningInvolvements.happeningId,
      id: entities.id,
      name: entities.name,
    })
    .from(happeningInvolvements)
    .innerJoin(
      entities,
      and(
        eq(entities.branchId, happeningInvolvements.branchId),
        eq(entities.id, happeningInvolvements.entityId),
      ),
    )
    .where(
      and(
        eq(happeningInvolvements.branchId, ctx.branchId),
        inArray(happeningInvolvements.happeningId, [...happeningIds]),
      ),
    )
  const casts = new Map<string, CastMember[]>()
  for (const { happeningId, id, name } of rows) {
    const cast = casts.get(happeningId) ?? []
    if (!cast.some((member) => member.id === id)) cast.push({ id, name })
    casts.set(happeningId, cast)
  }
  for (const cast of casts.values())
    cast.sort((a, b) => compareId(a.name, b.name) || compareId(a.id, b.id))
  return casts
}

// memory/chapter-close.md → Run order: the clusters the range embed found. A row gone since then
// drops out, and a cluster left with one row has nothing to merge.
async function startHappenings(ctx: TaskPromptContext): Promise<TaskStart<HappeningsShow> | null> {
  const clusters = closeClustersOf(ctx.phase.intermediates)
  if (clusters.length === 0) return null
  const stored = await readClusterRows(ctx, clusters.flat())
  const listed = clusters
    .map((cluster) => cluster.flatMap((id) => stored.get(id) ?? []))
    .filter((cluster) => cluster.length >= 2)
  if (listed.length === 0) return null
  const rows = listed.flat()
  const casts = await readCasts(
    ctx,
    rows.map((row) => row.id),
  )
  // Every happening's handle first, so one a text names keeps the number of its place in the list;
  // a row a text cites is named, so a write copying its handle stores the name, not the handle.
  for (const row of rows) ctx.ids.show(row.id, row.title)
  for (const row of rows)
    for (const member of casts.get(row.id) ?? []) ctx.ids.show(member.id, member.name)
  await refsIn(
    ctx,
    rows.map((row) => [row.title, row.description]),
  )
  const handled = (value: string): string => ctx.ids.withHandles(value)
  return {
    show: {
      mode: await storyModeOf(ctx),
      clusters: listed.map((cluster) =>
        cluster.map(
          (row): HappeningClusterRow => ({
            id: ctx.ids.show(row.id, row.title),
            title: handled(row.title),
            description: handled(row.description ?? ''),
            cast: (casts.get(row.id) ?? []).map((member) => ({
              id: ctx.ids.show(member.id, member.name),
              name: handled(member.name),
            })),
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
