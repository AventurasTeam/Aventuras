/**
 * Convert imported entries to full Entry objects
 */

import type { Entry, EntryCreator, VaultLorebookEntry } from '$lib/types'
import type { ImportedEntry } from '../types'

export function entryToVaultEntry(entry: Entry): VaultLorebookEntry {
  return {
    name: entry.name,
    type: entry.type,
    description: entry.description,
    keywords: entry.injection.keywords,
    aliases: entry.aliases,
    injectionMode: entry.injection.mode,
    priority: entry.injection.priority,
  }
}

export function defaultEntryState(type: Entry['type']): Entry['state'] {
  switch (type) {
    case 'character':
      return {
        type: 'character',
        isPresent: false,
        lastSeenLocation: null,
        currentDisposition: null,
        relationship: { level: 0, status: 'unknown', history: [] },
        knownFacts: [],
        revealedSecrets: [],
      }
    case 'location':
      return {
        type: 'location',
        isCurrentLocation: false,
        visitCount: 0,
        changes: [],
        presentCharacters: [],
        presentItems: [],
      }
    case 'item':
      return { type: 'item', inInventory: false, currentLocation: null, condition: null, uses: [] }
    case 'faction':
      return { type: 'faction', playerStanding: 0, status: 'unknown', knownMembers: [] }
    case 'event':
      return { type: 'event', occurred: false, occurredAt: null, witnesses: [], consequences: [] }
    case 'concept':
    default:
      return { type: 'concept', revealed: false, comprehensionLevel: 'unknown', relatedEntries: [] }
  }
}

export function convertToEntries(
  importedEntries: ImportedEntry[],
  createdBy: EntryCreator = 'import',
  // An Aventura export states its aliases; an empty list there is deliberate.
  { keywordAliases = true }: { keywordAliases?: boolean } = {},
): Omit<Entry, 'id' | 'storyId'>[] {
  const now = Date.now()

  return importedEntries.map((imported) => ({
    name: imported.name,
    type: imported.type,
    description: imported.description,
    hiddenInfo: imported.hiddenInfo ?? null,
    aliases:
      imported.aliases.length > 0 || !keywordAliases
        ? imported.aliases
        : imported.keywords.slice(0, 5),
    state: defaultEntryState(imported.type),
    adventureState: null,
    creativeState: null,
    injection: {
      mode: imported.injectionMode,
      keywords: imported.keywords,
      priority: imported.priority,
    },
    createdBy,
    createdAt: now,
    updatedAt: now,
    loreManagementBlacklisted: imported.loreManagementBlacklisted ?? false,
    branchId: null,
  }))
}
