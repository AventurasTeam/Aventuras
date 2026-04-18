/**
 * Full import orchestration with progress tracking
 */

import { database } from '$lib/services/database'
import type { Entry } from '$lib/types'
import type { ImportOptions, ImportResult, LorebookImportResult } from '../types'
import { classifyEntries } from '../classify/classify'
import { convertToEntries } from './convert'

export async function importEntries(
  parseResult: LorebookImportResult,
  options: ImportOptions,
): Promise<ImportResult> {
  const { storyId, useAIClassification, storyMode, onProgress } = options
  const errors: string[] = []
  const warnings: string[] = [...parseResult.warnings]

  try {
    let entriesToImport = parseResult.entries

    // Phase 1: Classification (optional)
    if (useAIClassification && entriesToImport.length > 0) {
      onProgress?.({
        phase: 'classifying',
        current: 0,
        total: entriesToImport.length,
        message: 'Classifying entries...',
      })

      entriesToImport = await classifyEntries(
        entriesToImport,
        (current, total) => {
          onProgress?.({
            phase: 'classifying',
            current,
            total,
            message: `Classifying entries (${current}/${total})...`,
          })
        },
        storyMode,
      )
    }

    // Phase 2: Convert to Entry format
    onProgress?.({
      phase: 'converting',
      current: 0,
      total: entriesToImport.length,
      message: 'Converting entries...',
    })

    const entries = convertToEntries(entriesToImport, 'import')

    // Phase 3: Batch insert into database
    onProgress?.({
      phase: 'inserting',
      current: 0,
      total: entries.length,
      message: 'Saving entries to database...',
    })

    let insertedCount = 0
    for (const entryData of entries) {
      try {
        const entry: Entry = {
          ...entryData,
          id: crypto.randomUUID(),
          storyId,
        }
        await database.addEntry(entry)
        insertedCount++

        onProgress?.({
          phase: 'inserting',
          current: insertedCount,
          total: entries.length,
          message: `Saving entries (${insertedCount}/${entries.length})...`,
        })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        errors.push(`Failed to save entry "${entryData.name}": ${errorMsg}`)
      }
    }

    // Complete
    onProgress?.({
      phase: 'complete',
      current: insertedCount,
      total: entries.length,
      message: `Imported ${insertedCount} entries`,
    })

    return {
      success: insertedCount > 0,
      entriesImported: insertedCount,
      errors,
      warnings,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    errors.push(`Import failed: ${errorMsg}`)

    return {
      success: false,
      entriesImported: 0,
      errors,
      warnings,
    }
  }
}
