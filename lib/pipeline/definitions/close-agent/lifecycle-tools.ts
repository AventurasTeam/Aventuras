import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { entities, type Entity } from '@/lib/db'
import { flagStillHolds } from '@/lib/world'

import { charactersInSceneAfter } from './later-scene'
import { turnHandleIn, turnInTextReason } from './text-checks'
import {
  writeToolSchema,
  type ReportRow,
  type WriteContext,
  type WritePlan,
  type WriteTool,
  type WriteToolSchema,
} from './tool'
import { CLOSE_REASON } from './verdict'

// A place is taken, so the plan, not the id layer, answers why it can't retire.
const ENTITY_PREFIXES = ['char_', 'loc_', 'item_', 'fact_'] as const

export const RETIRE_SHAPE = {
  id: z
    .string()
    .describe('The character, item or faction to retire, by its short id (c1, i1, f1…).'),
}

export const FLAG_DUPLICATE_SHAPE = {
  id: z.string().describe('The row that is the same as another, by its short id.'),
  partner: z
    .string()
    .describe('The row it is the same as, by its short id: a row of the same kind.'),
}

type RetireArgs = z.output<WriteToolSchema<typeof RETIRE_SHAPE>>
type FlagArgs = z.output<WriteToolSchema<typeof FLAG_DUPLICATE_SHAPE>>

// The handlers' own strings (retireEntityHandler, raiseCollisionFlagHandler): C4 keeps one spelling.
const REFUSAL = {
  location: 'location',
  notActive: 'not-active',
  inSceneLater: 'in-scene-later',
  self: 'partner-is-self',
  otherKind: 'partner-not-of-kind',
} as const

const NOTE = {
  location: 'Only the user retires a place: leave it active.',
  notActive: 'Only an active row retires: a staged row is not in the story yet, so leave it.',
  inSceneLater:
    'A turn after this chapter still has this character in its scene, so the chapter is older evidence: leave it active.',
  whyHandle:
    'Your why becomes the retirement reason the user reads: send it again naming no turn id.',
  self: 'Name two different rows: the row, and the one it is the same as.',
  otherKind:
    'Only two rows of one kind can be the same: a character and a character, a place and a place.',
} as const

/** C4: a retirement records its status alone; its reason is the call's why. */
const RETIRED: Readonly<Record<string, unknown>> = { status: 'retired' }
const RETIREMENT_FIELDS = ['status', 'retiredReason'] as const
// Every column the raise writes, so a restated flag drops the partner value too (C4).
const FLAG_FIELDS = ['nameCollisionFlag', 'nameCollisionPartnerId', 'nameCollisionReason'] as const
const PARTNER_PATH = 'nameCollisionPartnerId'

async function readEntity(ctx: WriteContext, id: string): Promise<Entity | undefined> {
  const [row] = await ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, ctx.branchId), eq(entities.id, id)))
    .limit(1)
  return row
}

// A gone row keeps the name the model was shown it by.
function reportRow(ctx: WriteContext, id: string, row: Entity | undefined): ReportRow {
  return { table: 'entities', id, name: row?.name ?? ctx.ids.nameOfId(id) ?? '' }
}

/** chapter-close.md → Phase 4: hard finality only, never a place, nor a character seen later. */
async function planRetire(args: RetireArgs, ctx: WriteContext): Promise<WritePlan> {
  const { id } = args
  const row = await readEntity(ctx, id)
  const rows = [reportRow(ctx, id, row)]
  const refused = (reason: string, note?: string): WritePlan => ({
    kind: 'refused',
    reason,
    rows,
    values: RETIRED,
    ...(note === undefined ? {} : { note }),
  })
  if (row === undefined) return refused(CLOSE_REASON.rowGone)
  if (row.kind === 'location') return refused(REFUSAL.location, NOTE.location)
  if (row.status === 'retired') return { kind: 'write', actions: [], lost: [], rows, values: {} }
  if (row.status !== 'active') return refused(REFUSAL.notActive, NOTE.notActive)
  if (row.kind === 'character' && (await charactersInSceneAfter(ctx, ctx.endEntryId)).has(id))
    return refused(REFUSAL.inSceneLater, NOTE.inSceneLater)
  const verdicts = (await ctx.guard([{ table: 'entities', id }])).row('entities', id)
  if (verdicts.laterTurnWrote('status', []))
    return {
      kind: 'write',
      actions: [],
      lost: [{ field: 'status', row: id, kind: 'protected', reason: CLOSE_REASON.laterTurn }],
      rows,
      values: RETIRED,
    }
  // The why is stored: a turn handle in it would name another turn in a later prompt.
  const handle = turnHandleIn(args.why, ctx.ids)
  if (handle !== undefined) return refused(turnInTextReason(handle), NOTE.whyHandle)
  return {
    kind: 'write',
    actions: [
      {
        action: {
          kind: 'retireEntity',
          source: 'chapter_close',
          payload: {
            branchId: ctx.branchId,
            id,
            retiredReason: args.why.trim(),
            proseEntryId: ctx.proseEntryId,
          },
        },
        fields: RETIREMENT_FIELDS,
        row: id,
      },
    ],
    lost: [],
    rows,
    values: RETIRED,
  }
}

/** chapter-close.md → 3f: a `duplicate` flag for the user to merge, on the row holding the pair's. */
async function planFlagDuplicate(args: FlagArgs, ctx: WriteContext): Promise<WritePlan> {
  const row = await readEntity(ctx, args.id)
  const partner = await readEntity(ctx, args.partner)
  const named =
    args.id === args.partner
      ? [reportRow(ctx, args.id, row)]
      : [reportRow(ctx, args.id, row), reportRow(ctx, args.partner, partner)]
  const proposed = { [PARTNER_PATH]: args.partner }
  if (row === undefined || partner === undefined)
    return { kind: 'refused', reason: CLOSE_REASON.rowGone, rows: named, values: proposed }
  if (row.id === partner.id)
    return { kind: 'refused', reason: REFUSAL.self, rows: named, note: NOTE.self }
  if (row.kind !== partner.kind)
    return {
      kind: 'refused',
      reason: REFUSAL.otherKind,
      rows: named,
      values: proposed,
      note: NOTE.otherKind,
    }
  // A pair flagged from the partner's side is re-marked there, so it keeps one strip.
  const [flagged, other] =
    flagStillHolds(partner, row) && !flagStillHolds(row, partner) ? [partner, row] : [row, partner]
  const rows = [reportRow(ctx, flagged.id, flagged), reportRow(ctx, other.id, other)]
  const values = { [PARTNER_PATH]: other.id }
  // Not userWrote: a Keep after the cited turn must reach the handler's resolved-pair read.
  const verdicts = (await ctx.guard([{ table: 'entities', id: flagged.id }])).row(
    'entities',
    flagged.id,
  )
  if (verdicts.laterTurnWrote('nameCollisionFlag', []))
    return {
      kind: 'write',
      actions: [],
      lost: [
        { field: PARTNER_PATH, row: flagged.id, kind: 'protected', reason: CLOSE_REASON.laterTurn },
      ],
      rows,
      values,
    }
  return {
    kind: 'write',
    actions: [
      {
        action: {
          kind: 'raiseCollisionFlag',
          source: 'chapter_close',
          payload: {
            branchId: ctx.branchId,
            id: flagged.id,
            partnerId: other.id,
            reason: 'duplicate',
            proseEntryId: ctx.proseEntryId,
          },
        },
        fields: FLAG_FIELDS,
        row: flagged.id,
      },
    ],
    lost: [],
    rows,
    values,
  }
}

/** chapter-close.md → Phase 4: `retireEntity`, its reason the call's why. */
export const retireEntityTool: WriteTool<typeof RETIRE_SHAPE> = {
  kind: 'write',
  name: 'retire_entity',
  description:
    "Retire a character, an item or a faction the chapter shows gone for good: a death, a permanent exile, a destruction or a disbanding the cited turns state outright. Never a place: only the user retires one. Your why becomes the row's retirement reason, so write it as one plain sentence on how the row left the story, naming no turn id.",
  schema: writeToolSchema(RETIRE_SHAPE),
  ids: { id: { shape: 'single', prefixes: ENTITY_PREFIXES } },
  plan: planRetire,
}

/** chapter-close.md → 3f's collision bullet: a `duplicate` flag; the agent never merges. */
export const flagDuplicateTool: WriteTool<typeof FLAG_DUPLICATE_SHAPE> = {
  kind: 'write',
  name: 'flag_duplicate',
  description:
    'Flag two rows of one kind that the chapter shows are one person, place or thing under two names (the hooded stranger who turns out to be Kael), for the user to merge; it never merges them. A row whose flag already names a third row refuses it, and so does a pair the user already kept apart. A pair already flagged is marked as the same, whichever row holds the flag.',
  schema: writeToolSchema(FLAG_DUPLICATE_SHAPE),
  ids: {
    id: { shape: 'single', prefixes: ENTITY_PREFIXES },
    partner: { shape: 'single', prefixes: ENTITY_PREFIXES },
  },
  plan: planFlagDuplicate,
}
