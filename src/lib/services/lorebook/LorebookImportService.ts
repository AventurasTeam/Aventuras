/**
 * LorebookImportService
 *
 * Orchestrates lorebook import operations:
 * - File parsing (parseLorebook)
 * - LLM classification with progress callbacks
 * - Entry conversion
 * - Batch database insertion
 */

import type { Entry } from '$lib/types'
import { database } from '$lib/services/database'
import {
  parseLorebook,
  classifyEntriesWithLLM,
  convertToEntries,
  type ImportedEntry,
  type LorebookImportResult,
} from '$lib/services/lorebookImporter'

export interface ImportProgress {
  phase: 'parsing' | 'classifying' | 'converting' | 'inserting' | 'complete'
  current: number
  total: number
  message?: string
}

export interface ImportOptions {
  storyId: string
  useAIClassification: boolean
  onProgress?: (progress: ImportProgress) => void
}

export interface ImportResult {
  success: boolean
  entriesImported: number
  errors: string[]
  warnings: string[]
}

export class LorebookImportService {
  /**
   * Parse a lorebook file and return the parsed result
   */
  parseFile(content: string, filename: string): LorebookImportResult | null {
    const lowerFilename = filename.toLowerCase()
    if (!lowerFilename.endsWith('.json') && !lowerFilename.endsWith('.avt')) {
      return null
    }

    return parseLorebook(content)
  }

  /**
   * Run LLM classification on parsed entries
   */
  async classifyEntries(
    entries: ImportedEntry[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<ImportedEntry[]> {
    return classifyEntriesWithLLM(
      entries,
      onProgress ? (current, total) => onProgress(current, total) : undefined,
    )
  }

  /**
   * Import entries into the database
   *
   * This is the main import method that orchestrates the full flow:
   * 1. Optionally classify entries with LLM
   * 2. Convert to Entry format
   * 3. Insert into database in batch
   */
  async importEntries(
    parseResult: LorebookImportResult,
    options: ImportOptions,
  ): Promise<ImportResult> {
    const { storyId, useAIClassification, onProgress } = options
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

        entriesToImport = await this.classifyEntries(entriesToImport, (current, total) => {
          onProgress?.({
            phase: 'classifying',
            current,
            total,
            message: `Classifying entries (${current}/${total})...`,
          })
        })
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

  /**
   * Get all entries for a story from the database
   */
  async getStoryEntries(storyId: string): Promise<Entry[]> {
    return database.getEntries(storyId)
  }
}

// Singleton instance
export const lorebookImportService = new LorebookImportService()
