import { database } from '#lib/services/database.ts'
import {
  characterToExchange,
  scenarioToExchange,
  serializeExchange,
  vaultLorebookToExchange,
  wrapExchange,
} from '#lib/services/exchange/index.ts'
import { importExportService } from '#lib/services/packs/import-export.ts'
import type { SyncEntityType, SyncLocalItem, SyncSection } from '#lib/types/sync.ts'
import type { ExportTracking } from '#lib/services/export.ts'
import { syncService } from './service'

export const SECTION_ENTITY: Record<SyncSection, SyncEntityType> = {
  stories: 'story',
  characters: 'character',
  lorebooks: 'lorebook',
  scenarios: 'scenario',
  packs: 'pack',
}

/** Unnamed vault records stay out: the exchange format refuses them. */
export async function listLocalItems(section: SyncSection): Promise<SyncLocalItem[]> {
  const [items, records] = await Promise.all([
    database.getSyncListing(section),
    database.getSyncRecords(SECTION_ENTITY[section]),
  ])
  return items
    .filter((item) => item.name.trim())
    .map((item) => {
      const record = records.get(item.localId)
      return {
        ...item,
        syncId: record?.syncId ?? null,
        vector: record?.vector ?? null,
        lastSynced: record?.lastSynced ?? {},
      }
    })
}

export async function exportDocument(
  section: SyncSection,
  localId: string,
  tracking: ExportTracking,
): Promise<string> {
  const missing = new Error('That item no longer exists')
  switch (section) {
    case 'stories':
      return syncService.exportStoryToJson(localId, tracking)
    case 'characters': {
      const character = await database.getVaultCharacter(localId)
      if (!character) throw missing
      return serializeExchange(wrapExchange('character', characterToExchange(character)))
    }
    case 'lorebooks': {
      const lorebook = await database.getVaultLorebook(localId)
      if (!lorebook) throw missing
      return serializeExchange(wrapExchange('lorebook', vaultLorebookToExchange(lorebook)))
    }
    case 'scenarios': {
      const scenario = await database.getVaultScenario(localId)
      if (!scenario) throw missing
      return serializeExchange(wrapExchange('scenario', scenarioToExchange(scenario)))
    }
    case 'packs': {
      const pack = await importExportService.packExportData(localId)
      if (!pack) throw missing
      return JSON.stringify(pack)
    }
  }
}
