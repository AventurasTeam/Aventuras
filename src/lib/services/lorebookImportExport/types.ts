/**
 * Shared types for lorebook import/export operations
 */

import type { Entry, EntryType, EntryInjectionMode } from '$lib/types'

// ===== Import Types =====

export type ImportedEntry = {
  name: string
  type: EntryType
  description: string
  keywords: string[]
  aliases: string[]
  injectionMode: EntryInjectionMode
  priority: number
  originalData?: SillyTavernEntry
}

export type LorebookImportResult = {
  success: boolean
  entries: ImportedEntry[]
  errors: string[]
  warnings: string[]
  metadata: {
    format: 'aventura' | 'sillytavern' | 'unknown'
    totalEntries: number
    importedEntries: number
    skippedEntries: number
  }
}

export type ImportProgress = {
  phase: 'parsing' | 'classifying' | 'converting' | 'inserting' | 'complete'
  current: number
  total: number
  message?: string
}

export type ImportOptions = {
  storyId: string
  useAIClassification: boolean
  storyMode: import('$lib/types').StoryMode
  onProgress?: (progress: ImportProgress) => void
}

export type ImportResult = {
  success: boolean
  entriesImported: number
  errors: string[]
  warnings: string[]
}

// ===== Export Types =====

export type ExportFormat = 'aventura' | 'sillytavern' | 'text'

export type LorebookExportOptions = {
  format: ExportFormat
  entries: Entry[]
  filename?: string
}

// ===== SillyTavern Format Types (Internal) =====

export type SillyTavernCharacterFilter = {
  isExclude: boolean
  names: string[]
  tags: string[]
}

export type SillyTavernEntry = {
  uid: number
  key: string[]
  keysecondary: string[]
  comment: string
  content: string
  constant: boolean
  vectorized: boolean
  selective: boolean
  selectiveLogic: number
  addMemo: boolean
  order: number
  position: number
  disable: boolean
  ignoreBudget: boolean
  excludeRecursion: boolean
  preventRecursion: boolean
  matchPersonaDescription: boolean
  matchCharacterDescription: boolean
  matchCharacterPersonality: boolean
  matchCharacterDepthPrompt: boolean
  matchScenario: boolean
  matchCreatorNotes: boolean
  delayUntilRecursion: number
  probability: number
  useProbability: boolean
  depth: number
  outletName: string
  group: string
  groupOverride: boolean
  groupWeight: number
  scanDepth: number | null
  caseSensitive: boolean | null
  matchWholeWords: boolean | null
  useGroupScoring: boolean | null
  automationId: string
  role: string | null
  sticky: boolean | null
  cooldown: number | null
  delay: number | null
  triggers: string[]
  displayIndex: number
  characterFilter: SillyTavernCharacterFilter
}

export type SillyTavernLorebook = {
  entries: Record<string, SillyTavernEntry>
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
}
