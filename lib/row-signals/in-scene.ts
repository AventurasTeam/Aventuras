import { inheritedEntryMetadata } from '@/lib/db'
import { resolveHeadTurn } from '@/lib/head-turn'

import type { SignalEntity, SignalEntry } from './types'

// principles.md → Scene presence is runtime-derived; never factions.
// Metadata is nullable, so a metadata-less tail falls back one entry.
export function selectInScene(
  entries: readonly SignalEntry[],
  entities: readonly SignalEntity[],
): ReadonlySet<string> {
  const head = resolveHeadTurn(entries)
  const triple = inheritedEntryMetadata(head?.tail.metadata ?? head?.previous?.metadata)
  const kinds = new Map(entities.map((e) => [e.id, e.kind]))
  const out = new Set<string>()
  for (const id of triple.sceneEntities) {
    const kind = kinds.get(id)
    if (kind === 'character' || kind === 'item') out.add(id)
  }
  const location = triple.currentLocationId
  if (location != null && kinds.get(location) === 'location') out.add(location)
  return out
}
