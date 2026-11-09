import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { emptyEntityState, entities, type Entity } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'
import { CAST_SOFT_CAPS } from '@/lib/wizard'

import { entityWriteAction, fieldVerdicts } from './entity-write'
import {
  overSoftCap,
  restatedList,
  restatedText,
  sentList,
  sentText,
  softCapReason,
  type BoundedField,
  type CappedList,
  type SentText,
} from './fields'
import {
  writeToolSchema,
  type LostField,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
} from './tool'
import { CLOSE_REASON } from './verdict'

export const CHARACTER_SHAPE = {
  id: z.string().describe('The character, by the short id it is shown under (c1, c2…).'),
  traits: z
    .array(z.string())
    .optional()
    .describe(
      `The whole new list of traits, at most ${CAST_SOFT_CAPS.traits}. Leave it out if unchanged.`,
    ),
  drives: z
    .array(z.string())
    .optional()
    .describe(
      `The whole new list of drives (goals, fears, sore spots), at most ${CAST_SOFT_CAPS.drives}. Leave it out if unchanged.`,
    ),
  voice: z
    .string()
    .optional()
    .describe('How the character speaks, rewritten whole. Leave it out if unchanged.'),
  description: z
    .string()
    .optional()
    .describe(
      'Who the character is, rewritten whole: only when the chapter changes it materially, or it is blank.',
    ),
}

export const FACTION_SHAPE = {
  id: z.string().describe('The faction, by the short id it is shown under (f1, f2…).'),
  agenda: z
    .array(z.string())
    .optional()
    .describe(
      `The whole new list of current goals, at most ${CAST_SOFT_CAPS.agenda}. Leave it out if unchanged.`,
    ),
  standing: z
    .string()
    .optional()
    .describe("The faction's power and situation now, rewritten whole. Leave it out if unchanged."),
  description: z
    .string()
    .optional()
    .describe(
      'What the faction is, rewritten whole: only when the chapter changes it materially, or it is blank.',
    ),
}

type IdentityKind = 'character' | 'faction'

/** A field a tool takes: its argument, the delta path it lands at, and how it's read as sent. */
type FieldSpec<A extends string = string> =
  | { kind: 'list'; arg: A; path: string; cap: CappedList }
  | { kind: 'text'; arg: A; path: string; bound: BoundedField }

/** A field still sent after blanks and empty lists are dropped. */
type SentField =
  | { kind: 'list'; path: string; cap: CappedList; list: string[] }
  | { kind: 'text'; path: string; text: SentText }

const CHARACTER_FIELDS: readonly FieldSpec<keyof typeof CHARACTER_SHAPE>[] = [
  { kind: 'list', arg: 'traits', path: 'state.traits', cap: 'traits' },
  { kind: 'list', arg: 'drives', path: 'state.drives', cap: 'drives' },
  { kind: 'text', arg: 'voice', path: 'state.voice', bound: 'voice' },
  { kind: 'text', arg: 'description', path: 'description', bound: 'description' },
]

const FACTION_FIELDS: readonly FieldSpec<keyof typeof FACTION_SHAPE>[] = [
  { kind: 'list', arg: 'agenda', path: 'state.agenda', cap: 'agenda' },
  { kind: 'text', arg: 'standing', path: 'state.standing', bound: 'standing' },
  { kind: 'text', arg: 'description', path: 'description', bound: 'description' },
]

const NOT_OF_KIND: Readonly<Record<IdentityKind, string>> = {
  character: 'not-a-character',
  faction: 'not-a-faction',
}

const NOTHING_SENT =
  'every field is blank or empty: send only the fields you change, each with its whole new value'

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const landingValue = (field: SentField): unknown =>
  field.kind === 'list' ? field.list : field.text.bounded

function sentFields(
  args: Readonly<Record<string, unknown>>,
  specs: readonly FieldSpec[],
): SentField[] {
  const sent: SentField[] = []
  for (const spec of specs) {
    const raw = args[spec.arg]
    if (spec.kind === 'list') {
      const list = sentList(isStringList(raw) ? raw : undefined)
      if (list !== undefined) sent.push({ kind: 'list', path: spec.path, cap: spec.cap, list })
    } else {
      const text = sentText(typeof raw === 'string' ? raw : undefined, spec.bound)
      if (text !== undefined) sent.push({ kind: 'text', path: spec.path, text })
    }
  }
  return sent
}

// A delta path's stored value: 'description', or a key of state ('state.voice').
function storedAt(row: Entity, path: string): unknown {
  if (path === 'description') return row.description
  const state: unknown = row.state ?? emptyEntityState(row.kind)
  return isJsonObject(state) ? state[path.slice('state.'.length)] : undefined
}

function restated(row: Entity, field: SentField): boolean {
  const stored = storedAt(row, field.path)
  return field.kind === 'list' ? restatedList(stored, field.list) : restatedText(stored, field.text)
}

async function readEntity(ctx: WriteContext, id: string): Promise<Entity | undefined> {
  const [row] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, id)))
    .limit(1)
  return row
}

/** chapter-close.md → 3b: one entity's fields, as sent, past precedence and the soft caps. */
async function planIdentityWrite(
  kind: IdentityKind,
  specs: readonly FieldSpec[],
  args: Readonly<Record<string, unknown>> & { readonly id: string },
  ctx: WriteContext,
): Promise<WritePlan> {
  const { id } = args
  const sent = sentFields(args, specs)
  const row = await readEntity(ctx, id)
  const rows: ReportRow[] = [
    { table: 'entities', id, name: row?.name ?? ctx.ids.nameOfId(id) ?? '' },
  ]
  const proposed = Object.fromEntries(sent.map((field) => [field.path, landingValue(field)]))
  if (row === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows, values: proposed }
  if (row.kind !== kind)
    return { kind: 'refused', reason: NOT_OF_KIND[kind], rows, values: proposed }
  if (sent.length === 0) return { kind: 'refused', reason: NOTHING_SENT, rows }

  // Restated before the guard, so a restated protected field reads ok, not skipped (C11).
  const changed = sent.filter((field) => !restated(row, field))
  if (changed.length === 0) return { kind: 'write', actions: [], lost: [], rows, values: {} }

  const guard = await ctx.guard([{ table: 'entities', id }])
  const verdicts = fieldVerdicts(
    guard.row('entities', id),
    changed.map((field) => field.path),
  )
  const lost: LostField[] = []
  const wanted: Record<string, unknown> = {}
  for (const [index, field] of changed.entries()) {
    const verdict = verdicts[index]
    if (!verdict.free) {
      lost.push({ field: field.path, row: id, kind: 'protected', reason: verdict.reason })
      continue
    }
    // Only a list precedence leaves meets its cap: a protected one never reaches this check.
    if (field.kind === 'list') {
      const cap = CAST_SOFT_CAPS[field.cap]
      if (overSoftCap(field.list, storedAt(row, field.path), cap)) {
        const reason = softCapReason(field.cap, cap)
        lost.push({ field: field.path, row: id, kind: 'refused', reason })
        continue
      }
    }
    wanted[field.path] = landingValue(field)
  }
  const planned = Object.keys(wanted).length > 0 ? entityWriteAction(row, wanted) : undefined
  return {
    kind: 'write',
    actions: planned !== undefined && planned.fields.length > 0 ? [planned] : [],
    lost,
    rows,
    values: Object.fromEntries(changed.map((field) => [field.path, landingValue(field)])),
  }
}

/** chapter-close.md → 3b: a character's traits, drives, voice and description, one updateEntity. */
export const updateCharacterTool: WriteTool<typeof CHARACTER_SHAPE> = {
  kind: 'write',
  name: 'update_character',
  description: `Updates a character's identity from this chapter's turns. Send only the fields you change, each whole: a list replaces the stored one, so at its cap (traits ${CAST_SOFT_CAPS.traits}, drives ${CAST_SOFT_CAPS.drives}) replace an entry rather than add one.`,
  schema: writeToolSchema(CHARACTER_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['char_'] } },
  plan: (args, ctx) => planIdentityWrite('character', CHARACTER_FIELDS, args, ctx),
}

/** chapter-close.md → 3b: a faction's agenda, standing and description, one updateEntity. */
export const updateFactionTool: WriteTool<typeof FACTION_SHAPE> = {
  kind: 'write',
  name: 'update_faction',
  description: `Updates a faction from this chapter's turns. Send only the fields you change, each whole: the agenda replaces the stored one, so at its cap (${CAST_SOFT_CAPS.agenda}) replace a goal rather than add one.`,
  schema: writeToolSchema(FACTION_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['fact_'] } },
  plan: (args, ctx) => planIdentityWrite('faction', FACTION_FIELDS, args, ctx),
}
