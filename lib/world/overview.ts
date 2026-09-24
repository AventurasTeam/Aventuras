import { largestWholeTier, type CalendarSystem, type WholeTierSpan } from '@/lib/calendar'
import {
  inheritedEntryMetadata,
  VISUAL_CATEGORIES,
  type CharacterState,
  type Entity,
  type EntryMetadata,
} from '@/lib/db'
import { resolveHeadTurn, type TurnEntry } from '@/lib/head-turn'
import { collate, compareId } from '@/lib/list-modules'

import { stateOf } from './entity-draft'
import { parentChainIds, parentOfLocations } from './parent-chain'

function byName(a: Entity, b: Entity): number {
  return collate(a.name, b.name) || a.createdAt - b.createdAt || compareId(a.id, b.id)
}

/** The first `max` populated visual fields, in canon order (world.md → Character Overview). */
export function visualParts(visual: CharacterState['visual'], max = 2): string[] {
  return VISUAL_CATEGORIES.map((key) => visual[key]?.trim() ?? '')
    .filter((value) => value !== '')
    .slice(0, max)
}

export type ChipPreview = { shown: string[]; more: number }

export function chipPreview(values: readonly string[], max = 3): ChipPreview {
  const clean = values.map((v) => v.trim()).filter((v) => v !== '')
  return { shown: clean.slice(0, max), more: Math.max(0, clean.length - max) }
}

export type CarryingSummary = {
  stackables: { key: string; count: number }[]
  equipped: number
  carried: number
}

export function carryingSummary(state: CharacterState, max = 3): CarryingSummary {
  const stackables = Object.entries(state.stackables ?? {})
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || collate(a.key, b.key))
    .slice(0, max)
  return { stackables, equipped: state.equipped_items.length, carried: state.inventory.length }
}

export function charactersAt(locationId: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter(
      (e) => e.kind === 'character' && stateOf(e, 'character').current_location_id === locationId,
    )
    .sort(byName)
}

export function itemsAt(locationId: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => e.kind === 'item' && stateOf(e, 'item').at_location_id === locationId)
    .sort(byName)
}

/** data-model.md → ItemState: held items are found from the character side. */
export function holdersOf(itemId: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => {
      if (e.kind !== 'character') return false
      const s = stateOf(e, 'character')
      return s.equipped_items.includes(itemId) || s.inventory.includes(itemId)
    })
    .sort(byName)
}

export function membersOf(factionId: string, entities: readonly Entity[]): Entity[] {
  return entities
    .filter((e) => e.kind === 'character' && stateOf(e, 'character').faction_id === factionId)
    .sort(byName)
}

/** The resolvable ancestors of a location, nearest first; a dangling or non-location id ends the chain. */
export function locationAncestors(locationId: string, entities: readonly Entity[]): Entity[] {
  const byId = new Map(entities.map((e) => [e.id, e]))
  return parentChainIds(locationId, parentOfLocations(entities)).flatMap((id) => {
    const entity = byId.get(id)
    return entity?.kind === 'location' ? [entity] : []
  })
}

/** Elapsed in-world time since `lastSeenAt`; null when never seen or the span runs backwards. */
export function lastSeenSpan(
  lastSeenAt: CharacterState['lastSeenAt'],
  branchWorldTimeSeconds: number,
  calendar: CalendarSystem,
): WholeTierSpan | null {
  if (lastSeenAt == null) return null
  return largestWholeTier(calendar, branchWorldTimeSeconds - lastSeenAt.worldTime)
}

type TimedEntry = TurnEntry & { metadata: Partial<Pick<EntryMetadata, 'worldTime'>> | null }

/**
 * The branch's current world time: the narrative tail's, or the entry before a metadata-less
 * tail. `entries` MUST be ordered ascending by position.
 */
export function branchWorldTime(entries: readonly TimedEntry[]): number {
  const head = resolveHeadTurn(entries)
  return inheritedEntryMetadata(head?.tail.metadata ?? head?.previous?.metadata).worldTime
}
