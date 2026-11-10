import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { entities, type Entity } from '@/lib/db'

import { entityWriteAction, fieldVerdicts, storedValue } from './entity-write'
import { restatedText, sentText, type BoundedField, type SentText } from './fields'
import { planPlacement, type PlacementArg } from './placement'
import { turnHandleIn, turnInTextReason } from './text-checks'
import {
  writeToolSchema,
  type LostField,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'
import { CLOSE_REASON } from './verdict'

export const UPDATE_PLACE_SHAPE = {
  id: z.string().describe('The place, by the short id it is shown under (l1, l2…).'),
  condition: z
    .string()
    .optional()
    .describe(
      'The place\'s ongoing state ("burned to the ground", "under siege"), rewritten whole: only when the chapter shows it changed while the scene was elsewhere. Leave it out if unchanged.',
    ),
  description: z
    .string()
    .optional()
    .describe(
      'What the place is, rewritten whole: only when the chapter changes it materially, or it is blank. Leave it out if unchanged.',
    ),
  parent: z
    .string()
    .optional()
    .describe(
      'The place this one sits inside, by its short id, when the chapter places or moves it. Read it with read_row first. Leave it out otherwise.',
    ),
  top: z
    .boolean()
    .optional()
    .describe(
      'true marks an unplaced place top level, when nothing on the map could contain it. Never with parent.',
    ),
}

export const UPDATE_ITEM_SHAPE = {
  id: z.string().describe('The item, by the short id it is shown under (i1, i2…).'),
  condition: z
    .string()
    .optional()
    .describe(
      'The item\'s ongoing state ("cracked", "soaked through"), rewritten whole: only when the chapter shows it changed while the scene was elsewhere. Leave it out if unchanged.',
    ),
  description: z
    .string()
    .optional()
    .describe(
      'What the item is, rewritten whole: only when the chapter changes it materially, or it is blank. Leave it out if unchanged.',
    ),
}

type PlaceArgs = z.output<WriteToolSchema<typeof UPDATE_PLACE_SHAPE>>
type ItemArgs = z.output<WriteToolSchema<typeof UPDATE_ITEM_SHAPE>>
type UpkeepKind = 'location' | 'item'

/** A text field a tool takes: its value in the parsed call, the delta path it lands at, its bound. */
type TextSpec<A> = { of: (args: A) => string | undefined; path: string; bound: BoundedField }
type SentField = { path: string; text: SentText }
/** A placement as sent: what planPlacement judges, and the path and value the report shows it at. */
type SentPlacement = { arg: PlacementArg; path: string; value: unknown }

const PARENT_PATH = 'state.parent_location_id'
const UNPLACED_PATH = 'state.unplaced'
// C4: the top mark changes only state.unplaced, so its value names the move.
const TOP_LEVEL_VALUE = 'top level'

const PLACE_TEXT: readonly TextSpec<PlaceArgs>[] = [
  { of: (args) => args.condition, path: 'state.condition', bound: 'condition' },
  { of: (args) => args.description, path: 'description', bound: 'description' },
]

const ITEM_TEXT: readonly TextSpec<ItemArgs>[] = [
  { of: (args) => args.condition, path: 'state.condition', bound: 'condition' },
  { of: (args) => args.description, path: 'description', bound: 'description' },
]

const NOT_OF_KIND: Readonly<Record<UpkeepKind, string>> = {
  location: 'not-a-place',
  item: 'not-an-item',
}

const NOTHING_SENT =
  'every field is blank or left out: send only the fields you change, each with its whole new value'
const PARENT_AND_TOP =
  'parent and top are both sent: send a parent to place the place under it, or top: true to mark an unplaced place top level, not both'

async function readEntity(ctx: WriteContext, id: string): Promise<Entity | undefined> {
  const [row] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, id)))
    .limit(1)
  return row
}

function sentTexts<A>(args: A, specs: readonly TextSpec<A>[]): SentField[] {
  return specs.flatMap((spec) => {
    const text = sentText(spec.of(args), spec.bound)
    return text === undefined ? [] : [{ path: spec.path, text }]
  })
}

// top: false reads as left out, as a blank text does.
function sentPlacement(args: PlaceArgs): SentPlacement | undefined {
  if (args.parent !== undefined)
    return { arg: { kind: 'under', parentId: args.parent }, path: PARENT_PATH, value: args.parent }
  if (args.top === true)
    return { arg: { kind: 'top' }, path: UNPLACED_PATH, value: TOP_LEVEL_VALUE }
  return undefined
}

/**
 * chapter-close.md → 3f: a place's or an item's condition and description, and a place's placement,
 * as one updateEntity; what can land does (C11). Rules refuse a field before precedence judges it,
 * as placeLocation judges a placement.
 */
async function planUpkeepWrite<A extends { readonly id: string }>(
  kind: UpkeepKind,
  specs: readonly TextSpec<A>[],
  args: A,
  placement: SentPlacement | undefined,
  ctx: WriteContext,
): Promise<WritePlan> {
  const { id } = args
  const sent = sentTexts(args, specs)
  const row = await readEntity(ctx, id)
  const rows: ReportRow[] = [
    { table: 'entities', id, name: row?.name ?? ctx.ids.nameOfId(id) ?? '' },
  ]
  const proposed: Record<string, unknown> = Object.fromEntries(
    sent.map((field) => [field.path, field.text.bounded]),
  )
  if (placement !== undefined) proposed[placement.path] = placement.value
  if (row === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }
  if (row.kind !== kind)
    return { kind: 'refused', reason: NOT_OF_KIND[kind], rows, values: proposed }
  if (sent.length === 0 && placement === undefined)
    return { kind: 'refused', reason: NOTHING_SENT, rows }

  // Restated first, so a value already stored is ok with nothing written, never refused or skipped.
  const changed = sent.filter((field) => !restatedText(storedValue(row, field.path), field.text))
  const values: Record<string, unknown> = Object.fromEntries(
    changed.map((field) => [field.path, field.text.bounded]),
  )
  const lost: LostField[] = []
  const free: SentField[] = []
  for (const field of changed) {
    const handle = turnHandleIn(field.text.sent, ctx.ids)
    if (handle === undefined) {
      free.push(field)
      continue
    }
    lost.push({ field: field.path, row: id, kind: 'refused', reason: turnInTextReason(handle) })
  }
  let move: { path: string; wanted: Record<string, unknown>; removed: string[] } | undefined
  if (placement !== undefined) {
    const planned = await planPlacement(row, placement.arg, ctx)
    if (!planned.ok) {
      values[placement.path] = placement.value
      lost.push({ field: placement.path, row: id, kind: 'refused', reason: planned.reason })
    } else if (!planned.restated) {
      values[placement.path] = placement.value
      move = { path: placement.path, wanted: planned.wanted, removed: planned.removed }
    }
  }
  if (free.length === 0 && move === undefined)
    return { kind: 'write', actions: [], lost, rows, values }

  // The guard reads a place's parent and unplaced mark as one field.
  const guard = await ctx.guard([{ table: 'entities', id }])
  const verdicts = fieldVerdicts(guard.row('entities', id), [
    ...free.map((field) => field.path),
    ...(move === undefined ? [] : [PARENT_PATH]),
  ])
  const wanted: Record<string, unknown> = {}
  const removed: string[] = []
  for (const [index, field] of free.entries()) {
    const verdict = verdicts[index]
    if (!verdict.free) {
      lost.push({ field: field.path, row: id, kind: 'protected', reason: verdict.reason })
      continue
    }
    wanted[field.path] = field.text.bounded
  }
  if (move !== undefined) {
    const verdict = verdicts[free.length]
    if (!verdict.free) {
      lost.push({ field: move.path, row: id, kind: 'protected', reason: verdict.reason })
    } else {
      Object.assign(wanted, move.wanted)
      removed.push(...move.removed)
    }
  }
  const landing = Object.keys(wanted).length > 0 || removed.length > 0
  return {
    kind: 'write',
    actions: landing ? [entityWriteAction(row, wanted, removed)] : [],
    lost,
    rows,
    values,
  }
}

async function planUpdatePlace(args: PlaceArgs, ctx: WriteContext): Promise<WritePlan> {
  if (args.parent !== undefined && args.top === true)
    return {
      kind: 'refused',
      reason: PARENT_AND_TOP,
      rows: [{ table: 'entities', id: args.id, name: ctx.ids.nameOfId(args.id) ?? '' }],
    }
  return planUpkeepWrite('location', PLACE_TEXT, args, sentPlacement(args), ctx)
}

/** chapter-close.md → 3f: a place's condition, description and placement, one updateEntity. */
export const updatePlaceTool: WriteTool<typeof UPDATE_PLACE_SHAPE> = {
  kind: 'write',
  name: 'update_place',
  description:
    "Updates a place from this chapter's turns: its condition when the chapter shows it changed while the scene was elsewhere, its description on a material change or when blank, and its placement: parent to put it inside another place, or top: true to mark an unplaced place top level when nothing on the map could contain it. Send only the fields you change, each whole. A placement the map can't take (a parent that isn't a live place, a loop, a move that would hide the story's place) is refused while the call's other fields land.",
  schema: writeToolSchema(UPDATE_PLACE_SHAPE),
  ids: {
    id: { shape: 'single', prefixes: ['loc_'] },
    parent: { shape: 'single', prefixes: ['char_', 'loc_', 'item_', 'fact_'] },
  },
  plan: planUpdatePlace,
}

/** chapter-close.md → 3f: an item's condition and description, one updateEntity. */
export const updateItemTool: WriteTool<typeof UPDATE_ITEM_SHAPE> = {
  kind: 'write',
  name: 'update_item',
  description:
    "Updates an item from this chapter's turns: its condition when the chapter shows it changed while the scene was elsewhere, and its description on a material change or when blank. Send only the fields you change, each whole.",
  schema: writeToolSchema(UPDATE_ITEM_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['item_'] } },
  plan: (args, ctx) => planUpkeepWrite('item', ITEM_TEXT, args, undefined, ctx),
}
