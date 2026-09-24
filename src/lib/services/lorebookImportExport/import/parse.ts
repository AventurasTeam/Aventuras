/**
 * Lorebook parsing logic for multiple formats
 */

import { createLogger } from '$lib/log'
import type { EntryInjectionMode } from '$lib/types'
import { parseExchange } from '$lib/services/exchange'
import type { ImportedEntry, LorebookImportResult, SillyTavernEntry } from '../types'
import { inferEntryType } from './inferType'

const log = createLogger('LorebookImporter')

function emptyResult(format: LorebookImportResult['metadata']['format']): LorebookImportResult {
  return {
    success: false,
    entries: [],
    errors: [],
    warnings: [],
    metadata: { format, totalEntries: 0, importedEntries: 0, skippedEntries: 0 },
  }
}

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
  const result = emptyResult('unknown')

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

/** An Aventura export is read literally: no type inference, no skipping, no fallbacks. */
export function parse(jsonString: string): LorebookImportResult {
  const exchange = parseExchange(jsonString, 'lorebook')

  if (exchange.kind === 'invalid') {
    const result = emptyResult('aventura')
    result.errors.push(exchange.error)
    return result
  }

  if (exchange.kind === 'exchange') {
    const { data } = exchange.document
    const result = emptyResult('aventura')
    result.warnings.push(...exchange.warnings)
    result.lorebook = {
      name: data.name,
      description: data.description,
      tags: data.tags,
      favorite: data.favorite,
      metadata: data.metadata,
    }
    result.entries = data.entries.map((e) => ({
      name: e.name,
      type: e.type,
      description: e.description,
      keywords: e.keywords,
      aliases: e.aliases,
      injectionMode: e.injectionMode,
      priority: e.priority,
      hiddenInfo: e.hiddenInfo ?? null,
      loreManagementBlacklisted: e.loreManagementBlacklisted ?? false,
    }))
    result.metadata.totalEntries = data.entries.length
    result.metadata.importedEntries = data.entries.length
    result.success = true
    log('Parsed Aventura lorebook', { name: data.name, totalEntries: data.entries.length })
    return result
  }

  try {
    const data = JSON.parse(jsonString)

    if (data && typeof data === 'object' && !Array.isArray(data) && 'entries' in data) {
      log('Detected SillyTavern format')
      return parseSillyTavern(jsonString)
    }

    const result = emptyResult('unknown')
    result.errors.push(
      'Unknown lorebook format. Expected an Aventuras lorebook export or a SillyTavern lorebook.',
    )
    return result
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown error'
    const result = emptyResult('unknown')
    result.errors.push(`Failed to parse JSON: ${errorMsg}`)
    return result
  }
}
