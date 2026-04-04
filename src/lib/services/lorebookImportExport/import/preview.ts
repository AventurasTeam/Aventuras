/**
 * Preview and summary utilities for lorebook imports
 */

import type { EntryType, EntryInjectionMode } from '$lib/types'
import type { ImportedEntry } from '../types'
import { parse } from './parse'

export function previewLorebook(jsonString: string): {
  success: boolean
  preview: {
    name: string
    type: EntryType
    hasContent: boolean
    keywordCount: number
    injectionMode: EntryInjectionMode
  }[]
  errors: string[]
  totalCount: number
} {
  const result = parse(jsonString)

  return {
    success: result.success,
    preview: result.entries.map((e) => ({
      name: e.name,
      type: e.type,
      hasContent: e.description.length > 0,
      keywordCount: e.keywords.length,
      injectionMode: e.injectionMode,
    })),
    errors: result.errors,
    totalCount: result.metadata.totalEntries,
  }
}

export function groupEntriesByType(entries: ImportedEntry[]): Record<EntryType, ImportedEntry[]> {
  const grouped: Record<EntryType, ImportedEntry[]> = {
    character: [],
    location: [],
    item: [],
    faction: [],
    concept: [],
    event: [],
  }

  for (const entry of entries) {
    grouped[entry.type].push(entry)
  }

  return grouped
}

export function getImportSummary(entries: ImportedEntry[]): {
  total: number
  byType: Record<EntryType, number>
  withContent: number
  withKeywords: number
  alwaysInject: number
  disabled: number
} {
  const byType: Record<EntryType, number> = {
    character: 0,
    location: 0,
    item: 0,
    faction: 0,
    concept: 0,
    event: 0,
  }

  let withContent = 0
  let withKeywords = 0
  let alwaysInject = 0
  let disabled = 0

  for (const entry of entries) {
    byType[entry.type]++
    if (entry.description.length > 0) withContent++
    if (entry.keywords.length > 0) withKeywords++
    if (entry.injectionMode === 'always') alwaysInject++
    if (entry.injectionMode === 'never') disabled++
  }

  return {
    total: entries.length,
    byType,
    withContent,
    withKeywords,
    alwaysInject,
    disabled,
  }
}
