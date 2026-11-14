import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { USER_EDITED_SINCE_PROSE, type PipelineAction } from '@/lib/actions/types'
import {
  entities,
  happeningAwareness,
  happenings,
  type CloseReasonKey,
  type HappeningAwareness,
} from '@/lib/db'

import {
  protectedField,
  writeToolSchema,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'
import { CLOSE_REASON } from './verdict'

export const SET_PIN_SHAPE = {
  id: z.string().describe('The awareness row, by the short id it is shown under (aw1, aw2…).'),
  value: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "The row's new pin, from 0 to 1: how slowly the character forgets the happening as chapters pass. At 1 it never fades.",
    ),
}

type SetPinArgs = z.output<WriteToolSchema<typeof SET_PIN_SHAPE>>
// The upsert's update arm writes a chapter_close payload's anchor and count: a pin carries neither.
type PinPayload = Omit<
  Extract<PipelineAction, { kind: 'upsertHappeningAwareness' }>['payload'],
  'retrievalCount' | 'learnedAtEntryId'
>

// decay_resistance: the delta path the report shows and the column the guard reads.
const PIN_PATH = 'decayResistance'
// chapter-close.md → 3d's one-way frequency signal: a row listed for coming up often only rises.
export const FREQUENT_PIN_LOWERED: CloseReasonKey = 'frequent-pin-lowered'
export const PIN_RAISE_TOO_LARGE: CloseReasonKey = 'pin-raise-too-large'
export const NO_START_PIN: CloseReasonKey = 'no-start-pin'
// A pin climbs at most this far above its start pin in one close.
const PIN_STEP = 0.2
// Float slack: 0.7 + 0.2 comes to a hair under 0.9, which must land.
const PIN_SLACK = 1e-9
// Float noise rounded off at 12 places, then cut to 10: within the slack, so the ceiling lands.
const notedCeiling = (ceiling: number): string => String(Number(ceiling.toFixed(12).slice(0, -2)))

async function readAwareness(
  ctx: WriteContext,
  id: string,
): Promise<HappeningAwareness | undefined> {
  const [row] = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, ctx.branchId), eq(happeningAwareness.id, id)))
    .limit(1)
  return row
}

/** The link's character name and its report name: `<character> on <happening>`. */
async function linkNames(
  ctx: WriteContext,
  row: HappeningAwareness,
): Promise<{ character: string; row: string }> {
  const [character] = await ctx.db
    .select({ name: entities.name })
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, row.characterId)))
    .limit(1)
  const [happening] = await ctx.db
    .select({ title: happenings.title })
    .from(happenings)
    .where(and(eq(happenings.branchId, ctx.branchId), eq(happenings.id, row.happeningId)))
    .limit(1)
  const name = character?.name ?? ''
  return { character: name, row: `${name} on ${happening?.title ?? ''}` }
}

/**
 * chapter-close.md → 3d. Read by id first: the upsert finds its row by character and happening.
 * A pin the user ever wrote is skipped here; the action's precedence covers only post-prose edits.
 */
async function planSetPin(args: SetPinArgs, ctx: WriteContext): Promise<WritePlan> {
  const { id, value } = args
  const proposed = { [PIN_PATH]: value }
  const row = await readAwareness(ctx, id)
  if (row === undefined)
    return {
      kind: 'refused',
      reason: CLOSE_REASON.rowGone,
      rows: [{ table: 'happening_awareness', id, name: '' }],
      values: proposed,
    }
  const names = await linkNames(ctx, row)
  // The character is the write's row: its handle needs a name for prose naming it to resolve.
  ctx.ids.show(row.characterId, names.character)
  const rows: ReportRow[] = [{ table: 'happening_awareness', id, name: names.row }]

  // Ahead of the guard: a pin already stored is ok, not skipped.
  const restated = row.decayResistance === value
  if (restated) return { kind: 'write', actions: [], lost: [], rows, values: {} }
  const verdicts = (await ctx.guard([{ table: 'happening_awareness', id }])).row(
    'happening_awareness',
    id,
  )
  if (verdicts.laterTurnWrote(PIN_PATH))
    return {
      kind: 'write',
      actions: [],
      lost: [protectedField(PIN_PATH, row.characterId, CLOSE_REASON.laterTurn)],
      rows,
      values: proposed,
    }
  // A pin the user ever wrote stays theirs, whatever turn is cited. Ahead of the bounds: it answers
  // skipped, not a refusal the model would retry.
  if (verdicts.userEverWrote(PIN_PATH))
    return {
      kind: 'write',
      actions: [],
      lost: [protectedField(PIN_PATH, row.characterId, USER_EDITED_SINCE_PROSE)],
      rows,
      values: proposed,
    }
  // The bounds hold from the pin the start showed, so a pin moves freely inside them in one close.
  const startPin = ctx.ids.startPinOf(id)
  if (startPin === undefined)
    return {
      kind: 'refused',
      reason: NO_START_PIN,
      rows,
      values: proposed,
      note: 'The task showed no pin for this row, so it cannot be pinned: leave it.',
    }
  // The read gate admits only rows the start listed, so a row not learned in the chapter is a
  // frequent one.
  const ofChapter = row.learnedAtEntryId !== null && ctx.taskEntryIds.includes(row.learnedAtEntryId)
  if (!ofChapter && value < startPin)
    return {
      kind: 'refused',
      reason: FREQUENT_PIN_LOWERED,
      rows,
      values: proposed,
      note: `This row is listed because it keeps coming up, not for this chapter, so its pin only rises: send ${startPin} or more, or leave it.`,
    }
  const ceiling = startPin + PIN_STEP
  if (value > ceiling + PIN_SLACK) {
    const noted = notedCeiling(ceiling)
    return {
      kind: 'refused',
      reason: PIN_RAISE_TOO_LARGE,
      rows,
      values: proposed,
      note: `This close can raise it to ${noted} at most: send ${noted} or less, or leave it.`,
    }
  }
  const payload: PinPayload = {
    branchId: ctx.branchId,
    characterId: row.characterId,
    happeningId: row.happeningId,
    decayResistance: value,
    proseEntryId: ctx.proseEntryId,
  }
  return {
    kind: 'write',
    actions: [
      {
        action: { kind: 'upsertHappeningAwareness', source: 'chapter_close', payload },
        fields: [PIN_PATH],
        row: row.characterId,
      },
    ],
    lost: [],
    rows,
    values: proposed,
  }
}

/** chapter-close.md → 3d: an awareness row's pin, decay_resistance; one upsertHappeningAwareness. */
export const setPinTool: WriteTool<typeof SET_PIN_SHAPE> = {
  kind: 'write',
  name: 'set_pin',
  description:
    "Sets an awareness row's pin, decay_resistance, from 0 to 1: how slowly the character forgets the happening as chapters pass. Raise it for a happening the character's story now turns on; lower it only on a row learned this chapter that was pinned high and proved incidental. A close raises a pin at most 0.2 above the pin it was shown with; a bigger raise is refused, and a pin moves freely up to that in the same close. A row listed because it keeps coming up never goes below the pin it was shown with: a lower value is refused.",
  schema: writeToolSchema(SET_PIN_SHAPE),
  ids: { id: { shape: 'single', prefixes: ['haw_'] } },
  plan: planSetPin,
}
