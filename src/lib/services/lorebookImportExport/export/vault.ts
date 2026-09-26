/**
 * Export functions for vault entities (lorebooks, characters, scenarios)
 * These convert vault entity types to exportable formats.
 */

import { writeTextFile } from '@tauri-apps/plugin-fs'
import { resolveSaveTarget } from '$lib/services/exportTarget'
import type { VaultLorebook, VaultLorebookEntry, VaultCharacter, VaultScenario } from '$lib/types'
import type { Entry } from '$lib/types'
import {
  characterToExchange,
  scenarioToExchange,
  serializeExchange,
  vaultLorebookToExchange,
  wrapExchange,
} from '$lib/services/exchange'
import type { ExportFormat } from '../types'
import { exportToSillyTavern, exportToText } from './formats'
import { getFormatInfo } from './metadata'
import { defaultEntryState } from '../import/convert'

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
    state: defaultEntryState(vaultEntry.type),
    adventureState: null,
    creativeState: null,
    injection: {
      mode: vaultEntry.injectionMode,
      keywords: vaultEntry.keywords ?? [],
      priority: vaultEntry.priority,
    },
    createdBy: 'user' as const,
    createdAt: now,
    updatedAt: now,
    loreManagementBlacklisted: false,
    branchId: null,
  }
}

/**
 * Export a vault lorebook to a file.
 */
export async function exportVaultLorebook(
  lorebook: VaultLorebook,
  format: ExportFormat,
): Promise<boolean> {
  if (lorebook.entries.length === 0 && format !== 'aventura') {
    throw new Error('No entries to export')
  }

  const entries = lorebook.entries.map((e, i) => vaultEntryToEntryLike(e, i))
  const baseFilename = lorebook.name || `lorebook-${new Date().toISOString().split('T')[0]}`

  let content: string
  const extension = getFormatInfo(format).extension

  switch (format) {
    case 'aventura':
      content = serializeExchange(wrapExchange('lorebook', vaultLorebookToExchange(lorebook)))
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
  const content = serializeExchange(wrapExchange('character', characterToExchange(character)))
  return await saveFile(content, `${baseFilename}.json`)
}

/**
 * Export a vault scenario to a JSON file.
 */
export async function exportVaultScenario(scenario: VaultScenario): Promise<boolean> {
  const baseFilename = scenario.name || `scenario-${new Date().toISOString().split('T')[0]}`
  const content = serializeExchange(wrapExchange('scenario', scenarioToExchange(scenario)))
  return await saveFile(content, `${baseFilename}.json`)
}

async function saveFile(content: string, defaultPath: string): Promise<boolean> {
  try {
    const target = await resolveSaveTarget(defaultPath, [
      { name: 'JSON', extensions: ['json'] },
      { name: 'Text', extensions: ['txt'] },
    ])
    if (!target) return false

    await writeTextFile(target.destPath, content)
    return true
  } catch (error) {
    console.error('[VaultExporter] Failed to save file:', error)
    throw error
  }
}
