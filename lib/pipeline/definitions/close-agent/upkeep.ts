import { and, eq, inArray, type SQL } from 'drizzle-orm'

import type { GuardRow } from '@/lib/actions/types'
import type { PromptHalves } from '@/lib/ai'
import {
  chunked,
  entities,
  happenings,
  type Entity,
  type Happening,
  type StoryMode,
} from '@/lib/db'
import { dedupeTerms } from '@/lib/keyword-terms'
import { compareId } from '@/lib/list-modules'
import { TEMPLATE_IDS } from '@/lib/prompts'
import { oneLine } from '@/lib/text'
import { realPlacementOf } from '@/lib/world'

import { namedInProse } from './name-match'
import { readRowTool, refsIn, searchWorldTool } from './read-tools'
import { byNameThenId, stateOf, strings, text } from './row-values'
import type { CloseTaskDef, TaskPromptContext, TaskStart } from './task'
import type { ReadFields } from './tool'
import { hasTurns, readTaskTurns, renderClosePrompt, storyModeOf, type CloseTurns } from './turns'
import {
  markCommonKnowledgeTool,
  setKeywordsTool,
  updateItemTool,
  updatePlaceTool,
} from './upkeep-tools'
import type { CloseRangeEntry } from '../chapter-context'
import { readHappeningsMadeFrom } from '../entry-reads'

// C11: the fields its start shows and read_row returns; a happening's title and description are read only.
export const UPKEEP_READ_FIELDS: ReadFields = {
  location: [
    'description',
    'keywords',
    'state.condition',
    'state.parent_location_id',
    'state.unplaced',
  ],
  item: ['description', 'keywords', 'state.condition'],
  character: ['keywords'],
  faction: ['keywords'],
  happening: ['title', 'description', 'commonKnowledge'],
}

/** A starting row as the template shows it: `id` is its handle, a field its kind lacks ''. */
export type UpkeepRow = {
  id: string
  kind: 'character' | 'location' | 'item' | 'faction'
  name: string
  status: Entity['status']
  description: string
  keywords: string[]
  condition: string
  /** A place's: `under <name> (<handle>)`, `top level` or `unplaced`. */
  placement: string
  /** A bare place or item in the part's scene, not a row the part names off the scene. */
  inScene: boolean
}

export type UpkeepShow = {
  mode: StoryMode
  closeTurns: CloseTurns
  /** readTaskTurns' stored count of the turns, which primes the system half's count. */
  proseTokens: number
  rows: UpkeepRow[]
  happenings: { id: string; title: string }[]
}

/** data-model.md → Entry metadata shape: a part's scene, its characters and items and its place. */
function sceneIdsOf(entries: readonly CloseRangeEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    for (const id of strings(entry.metadata?.sceneEntities)) ids.add(id)
    const place = entry.metadata?.currentLocationId
    if (typeof place === 'string') ids.add(place)
  }
  return ids
}

// 3f: a place's or an item's first keywords; 3b: a blank description the turns may fill.
const isBare = (row: Entity): boolean =>
  (row.kind === 'location' || row.kind === 'item') &&
  (dedupeTerms(strings(row.keywords)).length === 0 || text(row.description).trim() === '')

/** The part's happenings not marked common knowledge: set at one of its entries, or made from one. */
async function openHappenings(
  ctx: TaskPromptContext,
  entries: readonly CloseRangeEntry[],
): Promise<Happening[]> {
  const entryIds = entries.map((entry) => entry.id)
  const madeFrom = await readHappeningsMadeFrom(ctx.db, ctx.branchId, new Set(entryIds))
  const openWhere = (match: SQL) =>
    ctx.db
      .select()
      .from(happenings)
      .where(and(eq(happenings.branchId, ctx.branchId), eq(happenings.commonKnowledge, 0), match))
  const open = new Map<string, Happening>()
  for (const ids of chunked(entryIds))
    for (const row of await openWhere(inArray(happenings.occurredAtEntryId, ids)))
      open.set(row.id, row)
  for (const ids of chunked([...madeFrom]))
    for (const row of await openWhere(inArray(happenings.id, ids))) open.set(row.id, row)
  return [...open.values()].sort((a, b) => compareId(a.title, b.title) || compareId(a.id, b.id))
}

// Upkeep writes a place's and an item's texts; a character or a faction shows only its keywords.
const ownsText = (row: Entity): boolean => row.kind === 'location' || row.kind === 'item'

// The text a start shows of a row, which is all an id it cites can reach the model through.
const shownText = (row: Entity): unknown => [
  row.name,
  ...(ownsText(row) ? [row.description, stateOf(row).condition] : []),
  row.keywords,
]

// memory/chapter-close.md → Run order: off-scene rows the part mentions, bare places and items in
// its scene, and its happenings not yet common knowledge.
async function startUpkeep(ctx: TaskPromptContext): Promise<TaskStart<UpkeepShow> | null> {
  const { entries, closeTurns, proseTokens } = await readTaskTurns(ctx)
  if (!hasTurns(closeTurns)) return null
  const scene = sceneIdsOf(entries)
  const prose = closeTurns.map((turn) => turn.content).join('\n\n')
  const branchRows = await ctx.db.select().from(entities).where(eq(entities.branchId, ctx.branchId))
  const live = branchRows.filter((row) => row.status !== 'retired')
  const offScene = live
    .filter((row) => !scene.has(row.id) && namedInProse(prose, row))
    .sort(byNameThenId)
  const bare = live.filter((row) => scene.has(row.id) && isBare(row)).sort(byNameThenId)
  const open = await openHappenings(ctx, entries)
  if (offScene.length === 0 && bare.length === 0 && open.length === 0) return null

  const shown = [
    ...offScene.map((row) => ({ row, inScene: false })),
    ...bare.map((row) => ({ row, inScene: true })),
  ]
  const locations = branchRows.filter((row) => row.kind === 'location')
  const placed = realPlacementOf(locations)
  const byId = new Map(locations.map((row) => [row.id, row]))
  const parentOf = (row: Entity): Entity | undefined => {
    if (row.kind !== 'location') return undefined
    const at = placed(row.id)
    return at.kind === 'under' ? byId.get(at.parentId) : undefined
  }
  const parents = shown.flatMap(({ row }) => parentOf(row) ?? [])
  // Handles in the order shown: the rows, the happenings, then the parents a placement names. A row
  // a shown text cites is named, so a write copying its handle stores the name, not the handle.
  for (const { row } of shown) ctx.ids.show(row.id, row.name)
  for (const row of open) ctx.ids.show(row.id, row.title)
  for (const parent of parents) ctx.ids.show(parent.id, parent.name)
  await refsIn(ctx, [
    ...shown.map(({ row }) => shownText(row)),
    ...open.map((row) => row.title),
    ...parents.map((row) => row.name),
  ])
  const handled = (value: string): string => ctx.ids.withHandles(value)
  const placement = (row: Entity): string => {
    if (row.kind !== 'location') return ''
    const parent = parentOf(row)
    if (parent !== undefined)
      return `under ${oneLine(handled(parent.name))} (${ctx.ids.show(parent.id, parent.name)})`
    return placed(row.id).kind === 'top' ? 'top level' : 'unplaced'
  }
  return {
    show: {
      mode: await storyModeOf(ctx),
      closeTurns,
      proseTokens,
      rows: shown.map(({ row, inScene }) => ({
        id: ctx.ids.show(row.id, row.name),
        kind: row.kind,
        name: handled(row.name),
        status: row.status,
        description: ownsText(row) ? handled(text(row.description)) : '',
        keywords: strings(row.keywords).map(handled),
        condition: ownsText(row) ? handled(text(stateOf(row).condition)) : '',
        placement: placement(row),
        inScene,
      })),
      happenings: open.map((row) => ({
        id: ctx.ids.show(row.id, row.title),
        title: handled(row.title),
      })),
    },
    // C11: each shown row and happening shows the fields its tools write; a parent only its name.
    seeds: [
      ...shown.map(({ row }): GuardRow => ({ table: 'entities', id: row.id })),
      ...open.map((row): GuardRow => ({ table: 'happenings', id: row.id })),
    ],
  }
}

function renderUpkeep(
  { show }: TaskStart<UpkeepShow>,
  ctx: TaskPromptContext & { writesSoFar: string },
): PromptHalves {
  return renderClosePrompt(
    TEMPLATE_IDS.closeUpkeep,
    show.closeTurns,
    {
      mode: show.mode,
      closeUpkeepRows: show.rows,
      closeUpkeepHappenings: show.happenings,
      closeWritesSoFar: ctx.writesSoFar,
    },
    show.proseTokens,
  )
}

/** memory/chapter-close.md → Run order: Upkeep, 3f, per part. */
export const upkeepTask: CloseTaskDef<UpkeepShow> & { task: 'upkeep' } = {
  task: 'upkeep',
  tools: [
    searchWorldTool,
    readRowTool,
    updatePlaceTool,
    updateItemTool,
    setKeywordsTool,
    markCommonKnowledgeTool,
  ],
  readFields: UPKEEP_READ_FIELDS,
  start: startUpkeep,
  render: renderUpkeep,
}
