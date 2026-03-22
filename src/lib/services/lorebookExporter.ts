/**
 * Lorebook Exporter Service
 *
 * Exports lorebook entries to various formats.
 */

import type { Entry, EntryType } from '$lib/types'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'

export type ExportFormat = 'aventura' | 'sillytavern' | 'text'

interface LorebookExportOptions {
  format: ExportFormat
  entries: Entry[]
  filename?: string
}

// SillyTavern export format
interface SillyTavernEntry {
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
  excludeRecursion: boolean
  preventRecursion: boolean
  delayUntilRecursion: number
  probability: number
  useProbability: boolean
  depth: number
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
  displayIndex: number
}

interface SillyTavernLorebook {
  entries: Record<string, SillyTavernEntry>
  name?: string
  description?: string
  scan_depth?: number
  token_budget?: number
  recursive_scanning?: boolean
}

/**
 * Convert an Entry to SillyTavern format
 */
function entryToSillyTavern(entry: Entry, index: number): SillyTavernEntry {
  // Combine name and aliases as keywords
  const keywords = [entry.name, ...entry.aliases, ...entry.injection.keywords]

  return {
    uid: index,
    key: keywords,
    keysecondary: [],
    comment: entry.name,
    content: entry.description + (entry.hiddenInfo ? `\n\n[Hidden: ${entry.hiddenInfo}]` : ''),
    constant: entry.injection.mode === 'always',
    vectorized: false,
    selective: entry.injection.mode === 'keyword',
    selectiveLogic: 0, // AND
    addMemo: true,
    order: entry.injection.priority,
    position: 0,
    disable: entry.injection.mode === 'never',
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    probability: 100,
    useProbability: false,
    depth: 4,
    group: entry.type,
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: false,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: null,
    sticky: null,
    cooldown: null,
    delay: null,
    displayIndex: index,
  }
}

/**
 * Export entries to Aventura JSON format (full Entry objects)
 */
function exportToAventura(entries: Entry[]): string {
  return JSON.stringify(entries, null, 2)
}

/**
 * Export entries to SillyTavern format
 */
function exportToSillyTavern(entries: Entry[], name?: string): string {
  const stEntries: Record<string, SillyTavernEntry> = {}

  entries.forEach((entry, index) => {
    stEntries[index.toString()] = entryToSillyTavern(entry, index)
  })

  const lorebook: SillyTavernLorebook = {
    entries: stEntries,
    name: name ?? 'Aventura Export',
    description: `Exported from Aventura on ${new Date().toLocaleDateString()}`,
    scan_depth: 2,
    token_budget: 2048,
    recursive_scanning: false,
  }

  return JSON.stringify(lorebook, null, 2)
}

/**
 * Export entries to plain text format
 */
function exportToText(entries: Entry[]): string {
  const lines: string[] = [
    '# Lorebook Export',
    `# Exported on ${new Date().toLocaleDateString()}`,
    `# Total entries: ${entries.length}`,
    '',
  ]

  // Group by type
  const grouped = entries.reduce(
    (acc, entry) => {
      if (!acc[entry.type]) {
        acc[entry.type] = []
      }
      acc[entry.type].push(entry)
      return acc
    },
    {} as Record<EntryType, Entry[]>,
  )

  const typeOrder: EntryType[] = ['character', 'location', 'item', 'faction', 'concept', 'event']

  for (const type of typeOrder) {
    const typeEntries = grouped[type]
    if (!typeEntries || typeEntries.length === 0) continue

    lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s`)
    lines.push('')

    for (const entry of typeEntries) {
      lines.push(`### ${entry.name}`)
      if (entry.aliases.length > 0) {
        lines.push(`Aliases: ${entry.aliases.join(', ')}`)
      }
      lines.push('')
      lines.push(entry.description)
      if (entry.hiddenInfo) {
        lines.push('')
        lines.push(`Hidden: ${entry.hiddenInfo}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Get file extension for format
 */
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

/**
 * Save file using Tauri native dialog
 */
async function saveFile(content: string, defaultPath: string): Promise<boolean> {
  try {
    const filePath = await save({
      defaultPath,
      filters: [
        { name: 'Aventura Lorebook', extensions: ['json'] },
        { name: 'Text', extensions: ['txt'] },
      ],
    })

    if (!filePath) return false

    await writeTextFile(filePath, content)
    return true
  } catch (error) {
    console.error('[LorebookExporter] Failed to save file:', error)
    throw error
  }
}

/**
 * Export lorebook entries to the specified format
 */
export async function exportLorebook(options: LorebookExportOptions): Promise<boolean> {
  const { format, entries, filename } = options

  if (entries.length === 0) {
    throw new Error('No entries to export')
  }

  let content: string
  const baseFilename = filename ?? `lorebook-${new Date().toISOString().split('T')[0]}`
  const extension = getFileExtension(format)
  // Mime type not needed for Tauri save

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
 * Get export format display info
 */
export function getFormatInfo(format: ExportFormat): {
  label: string
  description: string
  extension: string
} {
  switch (format) {
    case 'aventura':
      return {
        label: 'Aventura JSON',
        description: 'Full entry data, can be re-imported with all fields',
        extension: '.json',
      }
    case 'sillytavern':
      return {
        label: 'SillyTavern',
        description: 'Compatible with SillyTavern and other tools',
        extension: '.json',
      }
    case 'text':
      return {
        label: 'Plain Text',
        description: 'Simple readable format, not importable',
        extension: '.txt',
      }
  }
}
