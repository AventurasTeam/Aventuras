/**
 * Format-specific export functions
 */

import type { Entry, EntryType } from '$lib/types'
import type { SillyTavernEntry, SillyTavernLorebook } from '../types'
import { entryToSillyTavern } from './convert'

export function exportToAventura(entries: Entry[]): string {
  return JSON.stringify(entries, null, 2)
}

export function exportToSillyTavern(entries: Entry[], name?: string): string {
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

export function exportToText(entries: Entry[]): string {
  const lines: string[] = [
    '# Lorebook Export',
    `# Exported on ${new Date().toLocaleDateString()}`,
    `# Total entries: ${entries.length}`,
    '',
  ]

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
