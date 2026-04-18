/**
 * Type definitions and constants for the Setup Wizard
 */

import type { Wand2 } from 'lucide-svelte'
import type { Genre, Tense } from '$lib/services/ai/wizard'
import { LorebookImportExport } from '$lib/services/lorebookImportExport'
import type { POV, EntryType } from '$lib/types'

/**
 * An imported lorebook with its entries and metadata
 */
export interface ImportedLorebookItem {
  id: string
  vaultId?: string // If imported from vault
  filename: string
  result: LorebookImportExport.LorebookImportResult
  entries: LorebookImportExport.ImportedEntry[]
  expanded: boolean
  /** Whether this lorebook is currently being processed (parsing or classifying) */
  isLoading?: boolean
  /** Current loading phase message (e.g., "Parsing...", "Classifying entries...") */
  loadingMessage?: string
  /** Classification progress for this specific lorebook */
  classificationProgress?: { current: number; total: number }
}

/**
 * Genre option for display in the wizard
 */
export interface GenreOption {
  id: Genre
  name: string
  icon: typeof Wand2
  description: string
}

/**
 * POV option for display in the wizard
 */
export interface POVOption {
  id: POV
  label: string
  example: string
}

/**
 * Tense option for display in the wizard
 */
export interface TenseOption {
  id: Tense
  label: string
  example: string
}

/**
 * Get entry type color class
 */
export function getTypeColor(type: EntryType): string {
  switch (type) {
    case 'character':
      return 'text-blue-400'
    case 'location':
      return 'text-green-400'
    case 'item':
      return 'text-yellow-400'
    case 'faction':
      return 'text-purple-400'
    case 'concept':
      return 'text-cyan-400'
    case 'event':
      return 'text-red-400'
    default:
      return 'text-surface-400'
  }
}

/**
 * Get type counts from entries array
 */
export function getTypeCounts(
  entries: LorebookImportExport.ImportedEntry[],
): Record<string, number> {
  return {
    character: entries.filter((e) => e.type === 'character').length,
    location: entries.filter((e) => e.type === 'location').length,
    item: entries.filter((e) => e.type === 'item').length,
    faction: entries.filter((e) => e.type === 'faction').length,
    concept: entries.filter((e) => e.type === 'concept').length,
    event: entries.filter((e) => e.type === 'event').length,
  }
}

/**
 * Style {{user}} placeholders in text for display
 */
export function styleUserPlaceholders(text: string): string {
  return text.replace(
    /\{\{user\}\}/gi,
    '<span class="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-primary-600/30 text-primary-300 text-xs font-mono border border-primary-500/40">{{user}}</span>',
  )
}

/**
 * Replace {{user}} placeholders with actual name
 */
export function replaceUserPlaceholders(text: string, name: string): string {
  if (!text) return text
  return text.replace(/\{\{user\}\}/gi, name)
}

/**
 * Tone presets for writing style
 */
export const tonePresets = [
  'Immersive and engaging',
  'Dark and atmospheric',
  'Light and whimsical',
  'Gritty and realistic',
  'Poetic and lyrical',
  'Action-packed and fast-paced',
]

/**
 * Tense options
 */
export const tenseOptions: TenseOption[] = [
  { id: 'present', label: 'Present', example: 'You see a door.' },
  { id: 'past', label: 'Past', example: 'You saw a door.' },
]
