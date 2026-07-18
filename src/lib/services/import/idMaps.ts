/**
 * Id translation for an import.
 *
 * Every imported row gets a fresh id so an import can never collide with existing data. The maps
 * are built up front, before any row is written, because several relationships are resolved out of
 * insertion order — branches reference fork entries, COW rows reference the entity they override,
 * and checkpoint snapshots reference chapters that are inserted later.
 */

import type { AventuraExport, IdMaps } from './types'

/**
 * Build every id table the import needs, in one pass over the export.
 */
export function buildIdMaps(data: AventuraExport): IdMaps {
  const oldToNewId = new Map<string, string>()
  const branchIdMap = new Map<string, string>()
  const checkpointIdMap = new Map<string, string>()

  const newStoryId = crypto.randomUUID()
  oldToNewId.set(data.story.id, newStoryId)

  // Entries first: branches can reference a fork entry.
  for (const entry of data.entries) {
    oldToNewId.set(entry.id, crypto.randomUUID())
  }

  // World-state entities are pre-mapped so COW `overridesId` references resolve during import
  // (an override row references the original entity's OLD id).
  //
  // Chapters are pre-mapped for a different reason: checkpoints are imported BEFORE chapters and
  // their snapshots reference chapter ids, so without a pre-map those snapshots would silently
  // keep the export's old ids and point at chapters that do not exist here.
  for (const collection of [
    data.characters,
    data.locations,
    data.items,
    data.storyBeats,
    data.lorebookEntries,
    data.chapters,
  ]) {
    for (const entity of collection ?? []) {
      oldToNewId.set(entity.id, crypto.randomUUID())
    }
  }

  for (const branch of data.branches ?? []) {
    branchIdMap.set(branch.id, crypto.randomUUID())
  }
  for (const checkpoint of data.checkpoints ?? []) {
    checkpointIdMap.set(checkpoint.id, crypto.randomUUID())
  }

  return { newStoryId, oldToNewId, branchIdMap, checkpointIdMap }
}

/** The lookup helpers used throughout the import, bound to one set of maps. */
export function createMappers(maps: IdMaps) {
  const { oldToNewId, branchIdMap } = maps

  return {
    mapBranchId: (branchId: string | null | undefined) =>
      branchId ? (branchIdMap.get(branchId) ?? null) : null,

    mapEntryId: (entryId: string | null | undefined) =>
      entryId ? (oldToNewId.get(entryId) ?? entryId) : null,

    /** COW overridesId: resolve to the new id, or null. Never keep the old id. */
    mapOverridesId: (id: string | null | undefined) => (id ? (oldToNewId.get(id) ?? null) : null),

    /** Best-effort remap that keeps the original id when it is not ours to translate. */
    remapEntityId: (id: string) => oldToNewId.get(id) ?? id,
  }
}

export type Mappers = ReturnType<typeof createMappers>
