import { and, asc, eq } from 'drizzle-orm'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import type { PipelineAction } from '@/lib/actions/types'
import {
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happenings,
  type HappeningAwareness,
} from '@/lib/db'

import {
  runDispatchCalls,
  type DispatchRun,
  type DispatchTurns,
  type ScriptedCall,
  type ShownRow,
} from '../../__tests__/close-dispatch'
import type { CloseFixture } from '../../__tests__/close-fixture'
import { setPinTool } from '../awareness-tools'

// Real `prefix_<uuid>` ids: CloseIds hands handles for those only.
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const ARIA = `char_${uuid(1)}`
export const JORIN = `char_${uuid(2)}`
export const KAI = `char_${uuid(3)}`
export const LENA = `char_${uuid(4)}`
export const FIGHT = `hap_${uuid(11)}`
export const TOLL = `hap_${uuid(12)}`
export const CROSSING = `hap_${uuid(13)}`
// aw1…aw9, in the order SHOWN lists them.
export const PINNED = `haw_${uuid(21)}`
export const FREQUENT = `haw_${uuid(22)}`
export const USER_PINNED = `haw_${uuid(23)}`
export const LATER_PINNED = `haw_${uuid(24)}`
export const LATER_SOURCED = `haw_${uuid(25)}`
// Shown, never seeded: a row gone before the call.
const GONE = `haw_${uuid(26)}`
// Seeded frequent rows: not learned in the chapter.
export const LATER_FREQUENT = `haw_${uuid(27)}`
export const UNPINNED_FREQUENT = `haw_${uuid(28)}`
export const USER_FREQUENT = `haw_${uuid(29)}`

export const SHOWN: readonly ShownRow[] = [
  PINNED,
  FREQUENT,
  USER_PINNED,
  LATER_PINNED,
  LATER_SOURCED,
  GONE,
  LATER_FREQUENT,
  UNPINNED_FREQUENT,
  USER_FREQUENT,
].map((id): ShownRow => ({ table: 'happening_awareness', id, name: '' }))

/** The chapter: the second turn to the third reply, t1…t4 by position; E is that reply. */
const chapterOf = (fx: CloseFixture): string[] => fx.entries.slice(3, 7).map(({ id }) => id)
export const endOf = (fx: CloseFixture): string => fx.entries[6]!.id
/** The first reply, before the chapter. */
export const earlierReplyOf = (fx: CloseFixture): string => fx.entries[2]!.id
/** The fifth reply: past E, under the fixture's act_close_turn_5. */
export const laterReplyOf = (fx: CloseFixture): string => fx.replyIds[4]!

// As the Awareness start leaves the ids: the chapter's turns, then a frequent row's earlier one, t5.
export const awarenessTurns = (fx: CloseFixture): DispatchTurns => ({
  endEntryId: endOf(fx),
  taskEntryIds: chapterOf(fx),
  part: 0,
  chapterEntryIds: [...chapterOf(fx), earlierReplyOf(fx)],
})

// Written with no delta, as an import leaves a row: precedence reads only the edits after it.
export async function putCharacter(fx: CloseFixture, id: string, name: string): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id,
    branchId: fx.branchId,
    kind: 'character',
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    state: emptyEntityState('character'),
    keywords: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

export async function putHappening(
  fx: CloseFixture,
  row: { id: string; title: string; description?: string; occurredAtEntryId: string },
): Promise<void> {
  await fx.ctx.db.insert(happenings).values({
    id: row.id,
    branchId: fx.branchId,
    title: row.title,
    description: row.description ?? null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: row.occurredAtEntryId,
    commonKnowledge: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

type AwarenessSeed = Pick<
  HappeningAwareness,
  'id' | 'characterId' | 'happeningId' | 'learnedAtEntryId' | 'decayResistance'
> & { retrievalCount?: number; source?: string }

export async function putAwareness(fx: CloseFixture, row: AwarenessSeed): Promise<void> {
  await fx.ctx.db.insert(happeningAwareness).values({
    id: row.id,
    branchId: fx.branchId,
    happeningId: row.happeningId,
    characterId: row.characterId,
    learnedAtEntryId: row.learnedAtEntryId,
    decayResistance: row.decayResistance,
    retrievalCount: row.retrievalCount ?? 0,
    source: row.source ?? null,
  })
}

export async function apply(
  fx: CloseFixture,
  action: PipelineAction,
  actionId: string,
  entryId: string | null,
): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId, branchId: fx.branchId, entryId },
    fx.ctx,
  )
  if (result.status !== 'ok')
    throw new Error(`${action.kind} under ${actionId} refused: ${result.reason}`)
}

// user: after every turn's prose, unanchored. later-turn: the fifth turn's writer, past E.
export async function editAwareness(
  fx: CloseFixture,
  who: 'user' | 'later-turn',
  pair: { characterId: string; happeningId: string },
  fields: { decayResistance?: number; source?: string },
): Promise<void> {
  const user = who === 'user'
  await apply(
    fx,
    {
      kind: 'upsertHappeningAwareness',
      source: user ? 'user_edit' : 'per_turn_classifier',
      payload: { branchId: fx.branchId, ...pair, ...fields, proseEntryId: null },
    },
    user ? 'act_user_edit' : 'act_close_turn_5',
    user ? null : laterReplyOf(fx),
  )
}

export async function storedPin(fx: CloseFixture, id: string): Promise<number | null> {
  const [row] = await fx.ctx.db
    .select({ pin: happeningAwareness.decayResistance })
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, fx.branchId), eq(happeningAwareness.id, id)))
  if (row === undefined) throw new Error(`no awareness row ${id}`)
  return row.pin
}

export function runDeltas(fx: CloseFixture, actionId: string) {
  return fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

export const WHY = 'The chapter turns on it.'

export const pin = (
  id: string,
  value: number,
  turns: readonly string[] = ['t2'],
  why = WHY,
): ScriptedCall => ({ toolName: 'set_pin', input: { id, value, turns: [...turns], why } })

// As the Awareness start shows them: each listed row's pin, no pin as 0; a gone row has none.
export async function startPinned(
  fx: CloseFixture,
  rows: readonly ShownRow[],
): Promise<ShownRow[]> {
  const pins = new Map(
    (
      await fx.ctx.db
        .select({ id: happeningAwareness.id, pin: happeningAwareness.decayResistance })
        .from(happeningAwareness)
        .where(eq(happeningAwareness.branchId, fx.branchId))
    ).map(({ id, pin }) => [id, pin]),
  )
  return rows.map((row) => (pins.has(row.id) ? { ...row, startPin: pins.get(row.id) ?? 0 } : row))
}

export async function pinCalls(
  fx: CloseFixture,
  calls: readonly ScriptedCall[],
): Promise<DispatchRun> {
  return runDispatchCalls(fx, {
    task: 'awareness',
    tools: { set_pin: setPinTool },
    shown: await startPinned(fx, SHOWN),
    calls,
    turns: awarenessTurns(fx),
  })
}
