/**
 * Lorebook parsing logic for multiple formats
 */

import { createLogger } from '$lib/log'
import type { Entry, EntryInjectionMode } from '$lib/types'
import type { ImportedEntry, LorebookImportResult, SillyTavernEntry } from '../types'
import { inferEntryType } from './inferType'

const log = createLogger('LorebookImporter')

function determineInjectionMode(entry: SillyTavernEntry): EntryInjectionMode {
  if (entry.disable) {
    return 'never'
  }
  if (entry.constant) {
    return 'always'
  }
  if (entry.selective && entry.key?.length > 0) {
    return 'keyword'
  }
  return 'keyword'
}

function parseSillyTavern(jsonString: string): LorebookImportResult {
  const result: LorebookImportResult = {
    success: false,
    entries: [],
    errors: [],
    warnings: [],
    metadata: {
      format: 'unknown',
      totalEntries: 0,
      importedEntries: 0,
      skippedEntries: 0,
    },
  }

  try {
    const data = JSON.parse(jsonString)

    if (!data.entries || typeof data.entries !== 'object') {
      result.errors.push('Invalid lorebook format: missing "entries" object')
      return result
    }

    result.metadata.format = 'sillytavern'

    const entries = Object.values(data.entries) as SillyTavernEntry[]
    result.metadata.totalEntries = entries.length

    log('Parsing SillyTavern lorebook', {
      totalEntries: entries.length,
      name: data.name || 'Unnamed',
    })

    for (const entry of entries) {
      try {
        if (!entry.content?.trim() && !entry.comment?.trim()) {
          result.warnings.push(`Skipped empty entry (UID: ${entry.uid})`)
          result.metadata.skippedEntries++
          continue
        }

        let name = entry.comment?.trim()
        if (!name) {
          name = entry.key?.[0] || `Entry ${entry.uid}`
          result.warnings.push(`Entry UID ${entry.uid} has no name, using "${name}"`)
        }

        const keywords = [...(entry.key || []), ...(entry.keysecondary || [])].filter(
          (k) => k && k.trim(),
        )

        const importedEntry: ImportedEntry = {
          name,
          type: inferEntryType(name, entry.content || ''),
          description: entry.content || '',
          keywords,
          aliases: [],
          injectionMode: determineInjectionMode(entry),
          priority: entry.order ?? 100,
          originalData: entry,
        }

        result.entries.push(importedEntry)
        result.metadata.importedEntries++
      } catch (entryError) {
        const errorMsg = entryError instanceof Error ? entryError.message : 'Unknown error'
        result.errors.push(`Failed to parse entry UID ${entry.uid}: ${errorMsg}`)
        result.metadata.skippedEntries++
      }
    }

    result.success = result.metadata.importedEntries > 0

    log('Import complete', {
      imported: result.metadata.importedEntries,
      skipped: result.metadata.skippedEntries,
      errors: result.errors.length,
      warnings: result.warnings.length,
    })
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown error'
    result.errors.push(`Failed to parse JSON: ${errorMsg}`)
    log('Parse error:', parseError)
  }

  return result
}

function isAventuraFormat(data: unknown): data is Entry[] {
  if (!Array.isArray(data)) return false
  if (data.length === 0) return false

  const first = data[0]
  return (
    typeof first === 'object' &&
    first !== null &&
    'name' in first &&
    'type' in first &&
    'description' in first &&
    'injection' in first &&
    typeof first.injection === 'object' &&
    first.injection !== null &&
    'mode' in first.injection
  )
}

function parseAventura(jsonString: string): LorebookImportResult {
  const result: LorebookImportResult = {
    success: false,
    entries: [],
    errors: [],
    warnings: [],
    metadata: {
      format: 'aventura',
      totalEntries: 0,
      importedEntries: 0,
      skippedEntries: 0,
    },
  }

  try {
    const data = JSON.parse(jsonString)

    if (!isAventuraFormat(data)) {
      result.errors.push('Invalid Aventura format: expected array of Entry objects')
      result.metadata.format = 'unknown'
      return result
    }

    result.metadata.totalEntries = data.length

    log('Parsing Aventura lorebook', { totalEntries: data.length })

    for (const entry of data) {
      try {
        if (!entry.name?.trim()) {
          result.warnings.push(`Skipped entry with no name`)
          result.metadata.skippedEntries++
          continue
        }

        if (!entry.description?.trim() && !entry.hiddenInfo?.trim()) {
          result.warnings.push(`Skipped empty entry: ${entry.name}`)
          result.metadata.skippedEntries++
          continue
        }

        const importedEntry: ImportedEntry = {
          name: entry.name,
          type: entry.type || 'concept',
          description: entry.description || '',
          keywords: entry.injection?.keywords || [],
          aliases: entry.aliases ?? [],
          injectionMode: entry.injection?.mode || 'keyword',
          priority: entry.injection?.priority ?? 100,
          originalData: entry as unknown as SillyTavernEntry,
        }

        result.entries.push(importedEntry)
        result.metadata.importedEntries++
      } catch (entryError) {
        const errorMsg = entryError instanceof Error ? entryError.message : 'Unknown error'
        result.errors.push(`Failed to parse entry "${entry.name}": ${errorMsg}`)
        result.metadata.skippedEntries++
      }
    }

    result.success = result.metadata.importedEntries > 0

    log('Aventura import complete', {
      imported: result.metadata.importedEntries,
      skipped: result.metadata.skippedEntries,
      errors: result.errors.length,
      warnings: result.warnings.length,
    })
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown error'
    result.errors.push(`Failed to parse JSON: ${errorMsg}`)
    log('Parse error:', parseError)
  }

  return result
}

export function parse(jsonString: string): LorebookImportResult {
  try {
    const data = JSON.parse(jsonString)

    if (isAventuraFormat(data)) {
      log('Detected Aventura format')
      return parseAventura(jsonString)
    }

    if (data && typeof data === 'object' && 'entries' in data) {
      log('Detected SillyTavern format')
      return parseSillyTavern(jsonString)
    }

    return {
      success: false,
      entries: [],
      errors: ['Unknown lorebook format. Expected Aventura JSON array or SillyTavern format.'],
      warnings: [],
      metadata: {
        format: 'unknown',
        totalEntries: 0,
        importedEntries: 0,
        skippedEntries: 0,
      },
    }
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown error'
    return {
      success: false,
      entries: [],
      errors: [`Failed to parse JSON: ${errorMsg}`],
      warnings: [],
      metadata: {
        format: 'unknown',
        totalEntries: 0,
        importedEntries: 0,
        skippedEntries: 0,
      },
    }
  }
}
