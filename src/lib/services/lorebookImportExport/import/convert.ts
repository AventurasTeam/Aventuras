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

export function convertToEntries(
  importedEntries: ImportedEntry[],
  createdBy: EntryCreator = 'import',
): Omit<Entry, 'id' | 'storyId'>[] {
  const now = Date.now()

  return importedEntries.map((imported) => {
    const original = imported.originalData as unknown as Partial<Entry>
    const isAventuraEntry =
      original && 'state' in original && 'injection' in original && original.injection?.mode

    if (isAventuraEntry && original.state) {
      return {
        name: original.name || imported.name,
        type: original.type || imported.type,
        description: original.description || imported.description,
        hiddenInfo: original.hiddenInfo || null,
        aliases: original.aliases || [],
        state: original.state,
        adventureState: original.adventureState || null,
        creativeState: original.creativeState || null,
        injection: original.injection || {
          mode: imported.injectionMode,
          keywords: imported.keywords,
          priority: imported.priority,
        },
        firstMentioned: original.firstMentioned || null,
        lastMentioned: original.lastMentioned || null,
        mentionCount: original.mentionCount || 0,
        createdBy,
        createdAt: now,
        updatedAt: now,
        loreManagementBlacklisted: original.loreManagementBlacklisted || false,
        branchId: null,
      }
    }

    const baseState = { type: imported.type }

    let state: Entry['state']
    switch (imported.type) {
      case 'character':
        state = {
          ...baseState,
          type: 'character',
          isPresent: false,
          lastSeenLocation: null,
          currentDisposition: null,
          relationship: {
            level: 0,
            status: 'unknown',
            history: [],
          },
          knownFacts: [],
          revealedSecrets: [],
        }
        break
      case 'location':
        state = {
          ...baseState,
          type: 'location',
          isCurrentLocation: false,
          visitCount: 0,
          changes: [],
          presentCharacters: [],
          presentItems: [],
        }
        break
      case 'item':
        state = {
          ...baseState,
          type: 'item',
          inInventory: false,
          currentLocation: null,
          condition: null,
          uses: [],
        }
        break
      case 'faction':
        state = {
          ...baseState,
          type: 'faction',
          playerStanding: 0,
          status: 'unknown',
          knownMembers: [],
        }
        break
      case 'event':
        state = {
          ...baseState,
          type: 'event',
          occurred: false,
          occurredAt: null,
          witnesses: [],
          consequences: [],
        }
        break
      case 'concept':
      default:
        state = {
          ...baseState,
          type: 'concept',
          revealed: false,
          comprehensionLevel: 'unknown',
          relatedEntries: [],
        }
        break
    }

    return {
      name: imported.name,
      type: imported.type,
      description: imported.description,
      hiddenInfo: null,
      aliases: imported.aliases.length > 0 ? imported.aliases : imported.keywords.slice(0, 5),
      state,
      adventureState: null,
      creativeState: null,
      injection: {
        mode: imported.injectionMode,
        keywords: imported.keywords,
        priority: imported.priority,
      },
      firstMentioned: null,
      lastMentioned: null,
      mentionCount: 0,
      createdBy,
      createdAt: now,
      updatedAt: now,
      loreManagementBlacklisted: false,
      branchId: null,
    }
  })
}
