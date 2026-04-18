/**
 * Extract embedded lorebooks from character cards
 */

import type { VaultLorebookEntry } from '$lib/types'
import type { LorebookImportResult } from '../types'
import { parse } from './parse'

export function extractEmbeddedLorebook(
  characterBook: unknown,
  cardName: string,
): { name: string; entries: VaultLorebookEntry[]; result: LorebookImportResult } | null {
  if (!characterBook || typeof characterBook !== 'object') return null

  const bookData = characterBook as Record<string, unknown>
  if (!bookData.entries || typeof bookData.entries !== 'object') return null

  // Embedded character_book entries use different field names than standalone lorebooks.
  // Normalize: keys→key, secondary_keys→keysecondary, id→uid, insertion_order→order, name→comment
  const rawEntries = bookData.entries as Record<string, unknown>[]
  const normalizedEntries: Record<string, Record<string, unknown>> = {}
  const entriesArray = Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries)

  for (let i = 0; i < entriesArray.length; i++) {
    const e = entriesArray[i] as Record<string, unknown>
    normalizedEntries[String(i)] = {
      ...e,
      uid: e.uid ?? e.id ?? i,
      key: e.key ?? e.keys ?? [],
      keysecondary: e.keysecondary ?? e.secondary_keys ?? [],
      comment: e.comment || e.name || '',
      order: e.order ?? e.insertion_order ?? 100,
    }
  }

  const normalized = { ...bookData, entries: normalizedEntries }
  const jsonString = JSON.stringify(normalized)
  const result = parse(jsonString)

  if (!result.success || result.entries.length === 0) return null

  const vaultEntries: VaultLorebookEntry[] = result.entries.map((e) => {
    const { originalData: _originalData, ...rest } = e
    return rest
  })

  return {
    name: (bookData.name as string) || `${cardName} - Lorebook`,
    entries: vaultEntries,
    result,
  }
}
