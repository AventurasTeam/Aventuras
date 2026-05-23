/**
 * Export functions for vault entities (lorebooks, characters, scenarios)
 * These convert vault entity types to exportable formats.
 */

import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { VaultLorebook, VaultLorebookEntry, VaultCharacter, VaultScenario } from '$lib/types'
import type { Entry, EntryType } from '$lib/types'
import type { ExportFormat } from '../types'
import { exportToAventura, exportToSillyTavern, exportToText } from './formats'

/**
 * Convert a VaultLorebookEntry to an Entry-like structure for export.
 * Synthesizes required fields that don't exist in vault entries.
 */
export function vaultEntryToEntryLike(vaultEntry: VaultLorebookEntry, index: number): Entry {
  const now = Date.now()
  return {
    id: `vault-export-${index}`,
    storyId: '',
    name: vaultEntry.name,
    type: vaultEntry.type,
    description: vaultEntry.description,
    hiddenInfo: null,
    aliases: vaultEntry.aliases ?? [],
    state: createDefaultState(vaultEntry.type),
    adventureState: null,
    creativeState: null,
    injection: {
      mode: vaultEntry.injectionMode,
      keywords: vaultEntry.keywords ?? [],
      priority: vaultEntry.priority,
    },
    firstMentioned: null,
    lastMentioned: null,
    mentionCount: 0,
    createdBy: 'user' as const,
    createdAt: now,
    updatedAt: now,
    loreManagementBlacklisted: false,
    branchId: null,
  }
}

/**
 * Create default state for a given entry type.
 */
function createDefaultState(type: EntryType): Entry['state'] {
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
      return {
        type: 'item',
        inInventory: false,
        currentLocation: null,
        condition: null,
        uses: [],
      }
    case 'faction':
      return {
        type: 'faction',
        playerStanding: 0,
        status: 'unknown',
        knownMembers: [],
      }
    case 'event':
      return {
        type: 'event',
        occurred: false,
        occurredAt: null,
        witnesses: [],
        consequences: [],
      }
    case 'concept':
    default:
      return {
        type: 'concept',
        revealed: false,
        comprehensionLevel: 'unknown',
        relatedEntries: [],
      }
  }
}

/**
 * Export a vault lorebook to a file.
 */
export async function exportVaultLorebook(
  lorebook: VaultLorebook,
  format: ExportFormat,
): Promise<boolean> {
  if (lorebook.entries.length === 0) {
    throw new Error('No entries to export')
  }

  const entries = lorebook.entries.map((e, i) => vaultEntryToEntryLike(e, i))
  const baseFilename = lorebook.name || `lorebook-${new Date().toISOString().split('T')[0]}`

  let content: string
  const extension = getFileExtension(format)

  switch (format) {
    case 'aventura':
      content = exportToAventura(entries)
      break
    case 'sillytavern':
      content = exportToSillyTavern(entries, baseFilename)
      break
    case 'text':
      content = exportToText(entries)
      break
  }

  return await saveFile(content, baseFilename + extension)
}

/**
 * Export a vault character to a JSON file.
 */
export async function exportVaultCharacter(character: VaultCharacter): Promise<boolean> {
  const baseFilename = character.name || `character-${new Date().toISOString().split('T')[0]}`
  const content = JSON.stringify(character, null, 2)
  return await saveFile(content, `${baseFilename}.json`)
}

/**
 * Export a vault scenario to a JSON file.
 */
export async function exportVaultScenario(scenario: VaultScenario): Promise<boolean> {
  const baseFilename = scenario.name || `scenario-${new Date().toISOString().split('T')[0]}`
  const content = JSON.stringify(scenario, null, 2)
  return await saveFile(content, `${baseFilename}.json`)
}

function getFileExtension(format: ExportFormat): string {
  switch (format) {
    case 'aventura':
      return '.json'
    case 'sillytavern':
      return '.json'
    case 'text':
      return '.txt'
  }
}

async function saveFile(content: string, defaultPath: string): Promise<boolean> {
  try {
    const filePath = await save({
      defaultPath,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    })

    if (!filePath) return false

    await writeTextFile(filePath, content)
    return true
  } catch (error) {
    console.error('[VaultExporter] Failed to save file:', error)
    throw error
  }
}
