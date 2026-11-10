import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { entities, happenings, type Entity, type Happening } from '@/lib/db'
import { dedupeTerms } from '@/lib/keyword-terms'

import { entityWriteAction, fieldVerdicts, storedValue, type StatePath } from './entity-write'
import { restatedText, sentText, type BoundedField, type SentText } from './fields'
import { keywordsRefusal, plannedKeywords, type SentKeywords } from './keyword-args'
import { termsOf } from './name-match'
import { planPlacement, type PlacementArg } from './placement'
import { turnHandleIn, turnInTextReason } from './text-checks'
import {
  sameValue,
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
 * chapter-close.md → 3f: condition, description and (places) placement as one updateEntity; what
 * can land does (C11). Placement rules run before precedence, the text handle check after, so a
 * protected text reads skipped.
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
  let move: { path: string; wanted: Record<string, unknown>; removed: StatePath[] } | undefined
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
  if (changed.length === 0 && move === undefined)
    return { kind: 'write', actions: [], lost, rows, values }

  // The guard reads a place's parent and unplaced mark as one field.
  const guard = await ctx.guard([{ table: 'entities', id }])
  const verdicts = fieldVerdicts(guard.row('entities', id), [
    ...changed.map((field) => field.path),
    ...(move === undefined ? [] : [PARENT_PATH]),
  ])
  const wanted: Record<string, unknown> = {}
  const removed: StatePath[] = []
  for (const [index, field] of changed.entries()) {
    const verdict = verdicts[index]
    if (!verdict.free) {
      lost.push({ field: field.path, row: id, kind: 'protected', reason: verdict.reason })
      continue
    }
    const handle = turnHandleIn(field.text.bounded, ctx.ids)
    if (handle !== undefined) {
      lost.push({ field: field.path, row: id, kind: 'refused', reason: turnInTextReason(handle) })
      continue
    }
    wanted[field.path] = field.text.bounded
  }
  if (move !== undefined) {
    const verdict = verdicts[changed.length]
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

export const SET_KEYWORDS_SHAPE = {
  id: z.string().describe('The row, by the short id it is shown under (c1, l1, i1, f1…).'),
  add: z
    .array(z.string())
    .optional()
    .describe(
      'Terms to add: names and aliases the chapter uses for the row. A term the row already has stays as it is.',
    ),
  remove: z
    .array(z.string())
    .optional()
    .describe(
      'Terms to remove: only a term an AI added that no longer fits. Removing a term the user added is rejected.',
    ),
}

export const MARK_COMMON_KNOWLEDGE_SHAPE = {
  id: z.string().describe('The happening, by the short id it is shown under (hp1, hp2…).'),
}

type KeywordArgs = z.output<WriteToolSchema<typeof SET_KEYWORDS_SHAPE>>
type MarkArgs = z.output<WriteToolSchema<typeof MARK_COMMON_KNOWLEDGE_SHAPE>>

const NO_TERMS = 'add and remove are both empty: send the terms to add, to remove, or both'

/**
 * chapter-close.md → 3f Keywords: one keywords write; the action judges authorship and user
 * removals as it lands. A later turn's list skips the call whole: an undo restores the prior list
 * (parked.md).
 */
async function planSetKeywords(args: KeywordArgs, ctx: WriteContext): Promise<WritePlan> {
  const { id } = args
  const sent: SentKeywords = {
    add: dedupeTerms(args.add ?? []),
    remove: dedupeTerms(args.remove ?? []),
  }
  const row = await readEntity(ctx, id)
  const rows: ReportRow[] = [
    { table: 'entities', id, name: row?.name ?? ctx.ids.nameOfId(id) ?? '' },
  ]
  const live = termsOf(row?.keywords)
  const proposed = { keywords: plannedKeywords(live, sent) }
  if (row === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }
  if (sent.add.length === 0 && sent.remove.length === 0)
    return { kind: 'refused', reason: NO_TERMS, rows }

  // Ahead of the guard: a list already as asked is ok, not skipped. A refused call is not restated.
  const refusal = keywordsRefusal(sent, ctx.ids)
  if (refusal === undefined && sameValue(proposed.keywords, live))
    return { kind: 'write', actions: [], lost: [], rows, values: {} }
  const verdicts = (await ctx.guard([{ table: 'entities', id }])).row('entities', id)
  if (verdicts.laterTurnWrote('keywords'))
    return {
      kind: 'write',
      actions: [],
      lost: [{ field: 'keywords', row: id, kind: 'protected', reason: CLOSE_REASON.laterTurn }],
      rows,
      values: proposed,
    }
  if (refusal !== undefined) return { kind: 'refused', reason: refusal, rows, values: proposed }
  return {
    kind: 'write',
    actions: [
      {
        action: {
          kind: 'setEntityKeywords',
          source: 'chapter_close',
          payload: {
            branchId: ctx.branchId,
            id,
            add: [...sent.add],
            remove: [...sent.remove],
            proseEntryId: ctx.proseEntryId,
          },
        },
        fields: ['keywords'],
        row: id,
      },
    ],
    lost: [],
    rows,
    values: proposed,
  }
}

async function readHappening(ctx: WriteContext, id: string): Promise<Happening | undefined> {
  const [row] = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, ctx.branchId), eq(happenings.id, id)))
    .limit(1)
  return row
}

/** chapter-close.md → 3f common_knowledge: sets 1, never 0. Read first for the title and the already-1 arm. */
async function planMarkCommonKnowledge(args: MarkArgs, ctx: WriteContext): Promise<WritePlan> {
  const { id } = args
  const row = await readHappening(ctx, id)
  const rows: ReportRow[] = [
    { table: 'happenings', id, name: row?.title ?? ctx.ids.nameOfId(id) ?? '' },
  ]
  const proposed = { commonKnowledge: 1 }
  if (row === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }
  if (row.commonKnowledge === 1) return { kind: 'write', actions: [], lost: [], rows, values: {} }
  const verdicts = (await ctx.guard([{ table: 'happenings', id }])).row('happenings', id)
  if (verdicts.laterTurnWrote('commonKnowledge'))
    return {
      kind: 'write',
      actions: [],
      lost: [
        { field: 'commonKnowledge', row: id, kind: 'protected', reason: CLOSE_REASON.laterTurn },
      ],
      rows,
      values: proposed,
    }
  return {
    kind: 'write',
    actions: [
      {
        action: {
          kind: 'updateHappening',
          source: 'chapter_close',
          payload: {
            branchId: ctx.branchId,
            id,
            patch: { commonKnowledge: 1 },
            proseEntryId: ctx.proseEntryId,
          },
        },
        fields: ['commonKnowledge'],
        row: id,
      },
    ],
    lost: [],
    rows,
    values: proposed,
  }
}

/** chapter-close.md → 3f Keywords: add and remove on any entity, one setEntityKeywords. */
export const setKeywordsTool: WriteTool<typeof SET_KEYWORDS_SHAPE> = {
  kind: 'write',
  name: 'set_keywords',
  description:
    "Adds and removes a row's keywords, the names and aliases retrieval finds it by. Add the aliases the chapter uses for a row, and a bare place's or item's first keywords. Remove only a term an AI added that no longer fits: removing a term the user added is rejected, naming it. A term is a word the prose uses, never an id.",
  schema: writeToolSchema(SET_KEYWORDS_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['char_', 'loc_', 'item_', 'fact_'] } },
  plan: planSetKeywords,
}

/** chapter-close.md → 3f common_knowledge: a happening known to every character, one updateHappening. */
export const markCommonKnowledgeTool: WriteTool<typeof MARK_COMMON_KNOWLEDGE_SHAPE> = {
  kind: 'write',
  name: 'mark_common_knowledge',
  description:
    'Marks a happening as common knowledge, known to every character, when the cited turns show outright that word of it has spread to everyone. A wrong mark makes every character aware of it, so leave anything less unmarked.',
  schema: writeToolSchema(MARK_COMMON_KNOWLEDGE_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['hap_'] } },
  plan: planMarkCommonKnowledge,
}
