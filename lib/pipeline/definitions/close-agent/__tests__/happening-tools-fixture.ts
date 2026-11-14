import { and, asc, eq } from 'drizzle-orm'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import type { PipelineAction } from '@/lib/actions/types'
import { deltas, happeningAwareness, happeningInvolvements, happenings } from '@/lib/db'
import { generateId } from '@/lib/ids'

import {
  runDispatchCalls,
  type DispatchRun,
  type ScriptedCall,
  type ShownRow,
} from '../../__tests__/close-dispatch'
import type { CloseFixture } from '../../__tests__/close-fixture'
import { mergeHappeningsTool } from '../happening-tools'
import type { CloseTool } from '../tool'

// Substitutable ids must be real uuids: CloseIds.show allocates handles for those only.
export const charId = (n: number): string =>
  `char_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const hapId = (n: number): string => `hap_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const WREN = charId(1)
export const TOBIN = charId(2)
export const MARA = charId(3)
export const CROSSING = hapId(11)
export const LIGHT = hapId(12)
export const PRICE = hapId(13)
export const TOLL = hapId(14)

// hp1…hp4, then c1…c3, in this order: as the Happenings start shows a cluster, then its cast.
const SHOWN: readonly ShownRow[] = [
  { table: 'happenings', id: CROSSING, name: 'Tobin poles Wren across' },
  { table: 'happenings', id: LIGHT, name: 'A light on the far bank' },
  { table: 'happenings', id: PRICE, name: 'Tobin names his price' },
  { table: 'happenings', id: TOLL, name: 'The Syndicate taxes the ferry' },
  { table: 'entities', id: WREN, name: 'Wren' },
  { table: 'entities', id: TOBIN, name: 'Tobin' },
  { table: 'entities', id: MARA, name: 'Mara' },
]
// The range embed's one cluster, in anchor order; TOLL is in none.
const CLUSTER: readonly string[] = [LIGHT, CROSSING, PRICE]

type AwarenessSeed = {
  characterId: string
  /** Index into the fixture's entries; null for no anchor. */
  at: number | null
  decayResistance: number | null
  retrievalCount: number
  source: string | null
}
type HappeningSeed = {
  id: string
  title: string
  description: string
  /** Index into the fixture's entries: t1 is 0, E (t7) is 6. */
  at: number
  involvements: readonly { entityId: string; role: string | null }[]
  awareness: readonly AwarenessSeed[]
}

const WORLD: readonly HappeningSeed[] = [
  {
    id: CROSSING,
    title: 'Tobin poles Wren across',
    description: 'Tobin takes Wren over the river at night.',
    at: 4,
    involvements: [
      { entityId: WREN, role: 'passenger' },
      { entityId: TOBIN, role: 'ferryman' },
    ],
    awareness: [
      {
        characterId: WREN,
        at: 4,
        decayResistance: 0.4,
        retrievalCount: 2,
        source: 'Wren crossed with Tobin',
      },
      {
        characterId: TOBIN,
        at: 4,
        decayResistance: 0.3,
        retrievalCount: 0,
        source: 'Tobin poled the boat',
      },
    ],
  },
  {
    id: LIGHT,
    title: 'A light on the far bank',
    description: 'A light moves on the far bank and goes out.',
    at: 2,
    involvements: [
      { entityId: WREN, role: 'witness' },
      { entityId: TOBIN, role: 'witness' },
      { entityId: MARA, role: 'watcher' },
    ],
    awareness: [
      {
        characterId: WREN,
        at: 2,
        decayResistance: 0.7,
        retrievalCount: 3,
        source: 'Wren saw the light',
      },
      { characterId: MARA, at: 2, decayResistance: null, retrievalCount: 1, source: null },
    ],
  },
  {
    id: PRICE,
    title: 'Tobin names his price',
    description: 'Tobin asks a price that would buy the boat twice.',
    at: 4,
    involvements: [
      { entityId: TOBIN, role: 'ferryman' },
      { entityId: MARA, role: 'onlooker' },
    ],
    awareness: [
      {
        characterId: WREN,
        at: 6,
        decayResistance: 0.5,
        retrievalCount: 4,
        source: 'Wren crossed with Tobin',
      },
      {
        characterId: MARA,
        at: 4,
        decayResistance: 0.2,
        retrievalCount: 2,
        source: 'Mara heard the haggling',
      },
    ],
  },
  {
    id: TOLL,
    title: 'The Syndicate taxes the ferry',
    description: 'The Syndicate taxes the ferry, the road and the bread.',
    at: 6,
    involvements: [],
    awareness: [],
  },
]

export const COMPOSITE =
  'Tobin names his price, then poles Wren across while a light moves on the far bank.'

// The chapter runs from the opening to the third reply (t1…t7); E is that reply.
export const endEntryIdOf = (fx: CloseFixture): string => fx.entries[6]!.id
const chapterEntryIdsOf = (fx: CloseFixture): string[] => fx.entries.slice(0, 7).map(({ id }) => id)

export type At = { actionId: string; entryId: string | null }
// A pass's write before the chapter: unanchored, under an action no turn owns.
const SEEDED: At = { actionId: 'act_seed_world', entryId: null }
// The user's edit: unanchored, after every turn's prose.
export const BY_USER: At = { actionId: 'act_user_edit', entryId: null }
// A later turn's write: anchored on the fifth reply, past E, under the turn that wrote it.
export const byLaterTurn = (fx: CloseFixture): At => ({
  actionId: 'act_close_turn_5',
  entryId: fx.replyIds[4]!,
})

export async function apply(
  fx: CloseFixture,
  action: PipelineAction,
  at: At = SEEDED,
): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: at.actionId, branchId: fx.branchId, entryId: at.entryId },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${action.kind} refused: ${result.reason}`)
}

export async function seedCharacter(fx: CloseFixture, id: string, name: string): Promise<void> {
  await apply(fx, {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id,
        branchId: fx.branchId,
        kind: 'character',
        name,
        description: null,
        status: 'active',
        injectionMode: 'auto',
        createdAt: 1,
        updatedAt: 1,
      },
    },
  })
}

async function seedHappening(fx: CloseFixture, seed: HappeningSeed): Promise<void> {
  await apply(fx, {
    kind: 'createHappening',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id: seed.id,
        branchId: fx.branchId,
        title: seed.title,
        description: seed.description,
        occurredAtEntryId: fx.entries[seed.at]!.id,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  })
  for (const { entityId, role } of seed.involvements)
    await apply(fx, {
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: generateId('hinv'),
          branchId: fx.branchId,
          happeningId: seed.id,
          entityId,
          role,
        },
      },
    })
  for (const row of seed.awareness) {
    await apply(fx, {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: {
        branchId: fx.branchId,
        characterId: row.characterId,
        happeningId: seed.id,
        learnedAtEntryId: row.at === null ? null : fx.entries[row.at]!.id,
        decayResistance: row.decayResistance,
        source: row.source,
        proseEntryId: null,
      },
    })
    // A pass's create starts at 0; the count retrieval bumps would leave, with no delta to read.
    if (row.retrievalCount > 0)
      await fx.ctx.db
        .update(happeningAwareness)
        .set({ retrievalCount: row.retrievalCount })
        .where(
          and(
            eq(happeningAwareness.branchId, fx.branchId),
            eq(happeningAwareness.happeningId, seed.id),
            eq(happeningAwareness.characterId, row.characterId),
          ),
        )
  }
}

export async function seedWorld(fx: CloseFixture): Promise<void> {
  await seedCharacter(fx, WREN, 'Wren')
  await seedCharacter(fx, TOBIN, 'Tobin')
  await seedCharacter(fx, MARA, 'Mara')
  for (const seed of WORLD) await seedHappening(fx, seed)
}

export async function happeningRow(fx: CloseFixture, id: string) {
  const [row] = await fx.ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, fx.branchId), eq(happenings.id, id)))
  return row
}

/** A happening's involvements as `entityId:role`, sorted. */
export async function involvementsOn(fx: CloseFixture, happeningId: string): Promise<string[]> {
  const rows = await fx.ctx.db
    .select({ entityId: happeningInvolvements.entityId, role: happeningInvolvements.role })
    .from(happeningInvolvements)
    .where(
      and(
        eq(happeningInvolvements.branchId, fx.branchId),
        eq(happeningInvolvements.happeningId, happeningId),
      ),
    )
  return rows.map(({ entityId, role }) => `${entityId}:${role ?? ''}`).sort()
}

export async function involvementId(
  fx: CloseFixture,
  happeningId: string,
  entityId: string,
): Promise<string> {
  const [row] = await fx.ctx.db
    .select({ id: happeningInvolvements.id })
    .from(happeningInvolvements)
    .where(
      and(
        eq(happeningInvolvements.branchId, fx.branchId),
        eq(happeningInvolvements.happeningId, happeningId),
        eq(happeningInvolvements.entityId, entityId),
      ),
    )
  if (row === undefined) throw new Error(`no involvement of ${entityId} on ${happeningId}`)
  return row.id
}

export async function awarenessOf(fx: CloseFixture, happeningId: string, characterId: string) {
  const [row] = await fx.ctx.db
    .select()
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.branchId, fx.branchId),
        eq(happeningAwareness.happeningId, happeningId),
        eq(happeningAwareness.characterId, characterId),
      ),
    )
  return row
}

export async function awarenessId(
  fx: CloseFixture,
  happeningId: string,
  characterId: string,
): Promise<string> {
  const row = await awarenessOf(fx, happeningId, characterId)
  if (row === undefined) throw new Error(`no awareness of ${characterId} on ${happeningId}`)
  return row.id
}

export function runDeltas(fx: CloseFixture, actionId: string) {
  return fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

export const HAPPENING_TOOLS: Readonly<Record<string, CloseTool>> = {
  merge_happenings: mergeHappeningsTool,
}

/** Runs `calls` as the Happenings task, part 0 over the chapter, with CLUSTER found. */
export function runCalls(
  fx: CloseFixture,
  calls: readonly ScriptedCall[],
  tools: Readonly<Record<string, CloseTool>> = HAPPENING_TOOLS,
  clusters: readonly (readonly string[])[] = [CLUSTER],
): Promise<DispatchRun> {
  return runDispatchCalls(fx, {
    task: 'happenings',
    tools,
    shown: SHOWN,
    calls,
    turns: { endEntryId: endEntryIdOf(fx), taskEntryIds: chapterEntryIdsOf(fx), part: 0 },
    clusters,
  })
}

/** The actions of every group the run emitted, in order: the payloads as sent. */
export const groupActions = (run: DispatchRun): PipelineAction[] =>
  run.events.flatMap((event) => (event.type === 'delta_group_emitted' ? [...event.actions] : []))

export type MergeInput = { keep: string; absorb: string[]; title?: string; description?: string }
export const merge = (args: MergeInput, turns: readonly string[] = ['t7']): ScriptedCall => ({
  toolName: 'merge_happenings',
  input: { ...args, turns: [...turns], why: 'The turns tell one crossing.' },
})

export const NOTE = {
  user: 'The user edited this after the cited turns; their value stands. Do not write it again.',
  laterTurn: 'A later turn wrote this; its value stands. Do not write it again.',
  gone: 'The row is gone; do not write to it again.',
} as const
export const CLOSE_WROTE =
  'this close already wrote a happening in absorb, and absorbing it would block undoing the close: keep that happening instead'
export const NO_KEEP =
  'this close already wrote more than one of these happenings, so they cannot be merged in this close: leave them apart'
