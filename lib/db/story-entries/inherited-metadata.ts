import type { EntryMetadata } from './entry-metadata'

type InheritedScene = Pick<EntryMetadata, 'sceneEntities' | 'currentLocationId' | 'worldTime'>

export function inheritedEntryMetadata(
  tail:
    | Partial<Pick<EntryMetadata, 'sceneEntities' | 'currentLocationId' | 'worldTime'>>
    | null
    | undefined,
): InheritedScene {
  return {
    sceneEntities: tail?.sceneEntities ?? [],
    currentLocationId: tail?.currentLocationId ?? null,
    worldTime: tail?.worldTime ?? 0,
  }
}
