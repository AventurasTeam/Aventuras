import type { FlagClearPatch, PipelineAction } from '@/lib/actions'
import type { Entity, EntityKind } from '@/lib/db'

import {
  flagStillHolds,
  pairSideOf,
  stillPaired,
  type CollisionPair,
  type PairSide,
} from './collision-pair'
import { nameBasis } from './namesakes'

type EntityUpdate = Extract<PipelineAction, { kind: 'updateEntity' }>
type EntityPatch = EntityUpdate['payload']['patch']

/** The patch that clears a collision flag: the flag, its partner and its reason together. */
export const FLAG_CLEAR = {
  nameCollisionFlag: 0,
  nameCollisionPartnerId: null,
  nameCollisionReason: null,
} as const satisfies FlagClearPatch

/**
 * Whether a same-kind row outside `exclude` already has `name` (staged and retired rows count):
 * world.md → Rename's hint, which warns and never blocks.
 */
export function nameTakenByOther(input: {
  kind: EntityKind
  name: string
  /** The branch's entities. */
  entities: readonly Entity[]
  exclude: ReadonlySet<string>
}): boolean {
  return input.entities.some(
    (e) =>
      e.kind === input.kind &&
      !input.exclude.has(e.id) &&
      nameBasis(e.name, input.name) === 'same-name',
  )
}

/** Rows outside `removed` whose flag names a row in it: world.md → Delete. */
export function flagsNaming(entities: readonly Entity[], removed: ReadonlySet<string>): string[] {
  return entities
    .filter(
      (e) =>
        !removed.has(e.id) &&
        e.nameCollisionPartnerId != null &&
        removed.has(e.nameCollisionPartnerId),
    )
    .map((e) => e.id)
}

/**
 * Flagged rows a write leaves no longer paired with their live partner: not namesakes any more, or
 * a `same-parent` pair split across parents (world.md → Surfacing). Only pairs with a side in
 * `after` are judged; a dormant flag stays, and a flag with no reason never holds.
 */
export function brokenFlags(input: {
  entities: readonly Entity[]
  /** id → that row's name, keywords and parent after the write. */
  after: ReadonlyMap<string, PairSide>
}): string[] {
  const { entities, after } = input
  const byId = new Map(entities.map((e) => [e.id, e]))
  const side = (e: Entity): PairSide => after.get(e.id) ?? pairSideOf(e)
  return entities
    .filter((row) => {
      if (row.nameCollisionPartnerId == null) return false
      const partner = byId.get(row.nameCollisionPartnerId)
      if (partner == null || (!after.has(row.id) && !after.has(partner.id))) return false
      const reason = row.nameCollisionReason
      return reason == null || !stillPaired(reason, side(row), side(partner))
    })
    .map((row) => row.id)
}

/**
 * The pair's flagged rows whose partner is the other row, or whose flag is dormant in `entities`
 * after the write (world.md → Keep as distinct, Rename). A live flag naming a third row stays.
 */
export function pairFlagsToClear(
  pair: CollisionPair,
  entities: readonly Entity[],
  /** id → that row's name, keywords and parent after the write; other rows read as stored. */
  after: ReadonlyMap<string, PairSide> = new Map(),
): string[] {
  const byId = new Map(entities.map((e) => [e.id, e]))
  const side = (e: Entity): PairSide => after.get(e.id) ?? pairSideOf(e)
  return pair
    .filter((row, index) => {
      const partner = row.nameCollisionPartnerId
      if (row.nameCollisionFlag !== 1) return false
      if (partner === pair[1 - index].id) return true
      return !flagStillHolds(row, partner == null ? undefined : byId.get(partner), side)
    })
    .map((row) => row.id)
}

/** A flag write World makes: the flag cleared with its partner and reason, or re-pointed. */
export type FlagWrite =
  | { id: string; clear: true }
  /** Targets a flagged row other than its new partner; the update handler refuses anything else. */
  | { id: string; partnerId: string }

function isUserUpdateOf(action: PipelineAction, id: string): action is EntityUpdate {
  return action.kind === 'updateEntity' && action.source === 'user_edit' && action.payload.id === id
}

/** One write per row, in first-seen order: a clear wins over a re-point. */
function onePerRow(writes: readonly FlagWrite[]): FlagWrite[] {
  const byId = new Map<string, FlagWrite>()
  for (const write of writes) {
    if (!byId.has(write.id) || 'clear' in write) byId.set(write.id, write)
  }
  return [...byId.values()]
}

function withWrite(patch: EntityPatch, write: FlagWrite): EntityPatch {
  if ('clear' in write) return { ...patch, ...FLAG_CLEAR }
  // A row this group already clears keeps the clear.
  if (patch.nameCollisionFlag === 0) return patch
  return { ...patch, nameCollisionPartnerId: write.partnerId }
}

/**
 * `actions` with each flag write folded into that row's first user `updateEntity` (one delta per
 * row), else appended as its own update.
 */
export function withFlagWrites(
  actions: readonly PipelineAction[],
  branchId: string,
  writes: readonly FlagWrite[],
): PipelineAction[] {
  const out = [...actions]
  for (const write of onePerRow(writes)) {
    const index = out.findIndex((action) => isUserUpdateOf(action, write.id))
    const update = out[index]
    if (index === -1 || !isUserUpdateOf(update, write.id)) {
      out.push({
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId, id: write.id, patch: withWrite({}, write) },
      })
      continue
    }
    out[index] = {
      ...update,
      payload: { ...update.payload, patch: withWrite(update.payload.patch, write) },
    }
  }
  return out
}

/** `withFlagWrites` clearing each of `ids`. */
export function withFlagClears(
  actions: readonly PipelineAction[],
  branchId: string,
  ids: readonly string[],
): PipelineAction[] {
  return withFlagWrites(
    actions,
    branchId,
    ids.map((id) => ({ id, clear: true }) as const),
  )
}
