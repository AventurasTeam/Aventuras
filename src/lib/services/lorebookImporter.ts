/**
 * Lorebook Importer Service
 *
 * Imports lorebooks from various formats (primarily SillyTavern) into Aventura's Entry system.
 */

import type {
  Entry,
  EntryType,
  EntryInjectionMode,
  EntryCreator,
  VaultLorebookEntry,
} from '$lib/types'
import type { StoryMode } from '$lib/types'
import { ContextBuilder } from '$lib/services/context'
import { generateStructured } from './ai/sdk/generate'
import { lorebookClassificationResultSchema } from './ai/sdk/schemas/lorebook'
import { createLogger } from './ai/core/config'
import { settings } from '$lib/stores/settings.svelte'

const log = createLogger('LorebookImporter')

// ===== SillyTavern Format Types =====

interface SillyTavernCharacterFilter {
  isExclude: boolean
  names: string[]
  tags: string[]
}

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

// ===== Import Result Types =====

export interface ImportedEntry {
  name: string
  type: EntryType
  description: string
  keywords: string[]
  aliases: string[]
  injectionMode: EntryInjectionMode
  priority: number
  originalData?: SillyTavernEntry
}

export interface LorebookImportResult {
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

// ===== Entry Type Inference =====

const TYPE_KEYWORDS: Record<EntryType, string[]> = {
  character: [
    'character',
    'person',
    'npc',
    'protagonist',
    'antagonist',
    'villain',
    'hero',
    'he is',
    'she is',
    'they are',
    'personality',
    'appearance',
    'occupation',
    'age:',
    'gender:',
    'species:',
    'race:',
    'class:',
  ],
  location: [
    'location',
    'place',
    'area',
    'region',
    'city',
    'town',
    'village',
    'building',
    'room',
    'forest',
    'mountain',
    'ocean',
    'river',
    'located in',
    'found at',
    'geography',
    'terrain',
    'climate',
  ],
  item: [
    'item',
    'weapon',
    'armor',
    'tool',
    'artifact',
    'object',
    'equipment',
    'potion',
    'scroll',
    'key',
    'contains',
    'grants',
    'provides',
    'equip',
  ],
  faction: [
    'faction',
    'organization',
    'guild',
    'group',
    'clan',
    'tribe',
    'kingdom',
    'empire',
    'alliance',
    'order',
    'members',
    'leader',
    'founded',
  ],
  concept: [
    'concept',
    'magic',
    'system',
    'rule',
    'lore',
    'history',
    'tradition',
    'technology',
    'science',
    'religion',
    'culture',
    'custom',
    'law',
  ],
  event: [
    'event',
    'war',
    'battle',
    'ceremony',
    'festival',
    'disaster',
    'catastrophe',
    'happened',
    'occurred',
    'took place',
    'anniversary',
    'historical',
  ],
}

function inferEntryType(name: string, content: string): EntryType {
  const textToAnalyze = `${name} ${content}`.toLowerCase()

  const scores: Record<EntryType, number> = {
    character: 0,
    location: 0,
    item: 0,
    faction: 0,
    concept: 0,
    event: 0,
  }

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS) as [EntryType, string[]][]) {
    for (const keyword of keywords) {
      if (textToAnalyze.includes(keyword)) {
        scores[type]++
      }
    }
  }

  let maxType: EntryType = 'concept'
  let maxScore = 0

  for (const [type, score] of Object.entries(scores) as [EntryType, number][]) {
    if (score > maxScore) {
      maxScore = score
      maxType = type
    }
  }

  return maxType
}

/**
 * LLM-based entry type classification.
 * Classifies entries in batches to avoid token limits.
 */
export async function classifyEntriesWithLLM(
  entries: ImportedEntry[],
  onProgress?: (classified: number, total: number) => void,
  mode: StoryMode = 'adventure',
): Promise<ImportedEntry[]> {
  if (entries.length === 0) return entries

  const lorebookSettings = settings.serviceSpecificSettings?.lorebookClassifier
  const BATCH_SIZE = lorebookSettings?.batchSize ?? 50
  const MAX_CONCURRENT = lorebookSettings?.maxConcurrent ?? 5

  const result = [...entries]
  let classified = 0

  // Build all batch indices
  const batchStarts: number[] = []
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batchStarts.push(i)
  }

  // Process batches with concurrency limit
  for (let ci = 0; ci < batchStarts.length; ci += MAX_CONCURRENT) {
    const concurrentStarts = batchStarts.slice(ci, ci + MAX_CONCURRENT)

    const batchPromises = concurrentStarts.map(async (startIndex) => {
      const batch = entries.slice(startIndex, startIndex + BATCH_SIZE)

      // Build entries JSON for the prompt
      const entriesJson = JSON.stringify(
        batch.map((entry, batchIndex) => ({
          index: batchIndex,
          name: entry.name,
          content: entry.description.slice(0, 500), // Limit content length
          keywords: entry.keywords.slice(0, 10),
        })),
        null,
        2,
      )

      // Render prompts via ContextBuilder pipeline
      const ctx = new ContextBuilder()
      ctx.add({
        mode,
        pov: 'second',
        tense: 'present',
        protagonistName: '',
        entriesJson,
      })
      const { system, user: prompt } = await ctx.render('lorebook-classifier')

      const classifications = await generateStructured(
        {
          presetId: 'classification',
          schema: lorebookClassificationResultSchema,
          system,
          prompt,
        },
        'lorebook-classifier',
      )

      return { startIndex, batch, classifications }
    })

    const batchResults = await Promise.all(batchPromises)

    // Apply classifications from all concurrent batches
    for (const { startIndex, batch, classifications } of batchResults) {
      for (const classification of classifications) {
        const globalIndex = startIndex + classification.index
        if (globalIndex < result.length) {
          result[globalIndex] = {
            ...result[globalIndex],
            type: classification.type as EntryType,
          }
        }
      }

      classified += batch.length
      if (onProgress) {
        onProgress(classified, entries.length)
      }

      log('Classified batch', {
        batchStart: startIndex,
        batchSize: BATCH_SIZE,
        maxConcurrent: MAX_CONCURRENT,
        classified,
        total: entries.length,
      })
    }
  }

  return result
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

export function parseSillyTavernLorebook(jsonString: string): LorebookImportResult {
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

export function parseAventuraLorebook(jsonString: string): LorebookImportResult {
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

export function parseLorebook(jsonString: string): LorebookImportResult {
  try {
    const data = JSON.parse(jsonString)

    if (isAventuraFormat(data)) {
      log('Detected Aventura format')
      return parseAventuraLorebook(jsonString)
    }

    if (data && typeof data === 'object' && 'entries' in data) {
      log('Detected SillyTavern format')
      return parseSillyTavernLorebook(jsonString)
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

export function convertToEntries(
  importedEntries: ImportedEntry[],
  createdBy: EntryCreator = 'import',
): Omit<Entry, 'id' | 'storyId'>[] {
  const now = Date.now()

  return importedEntries.map((imported) => {
    const original = imported.originalData as unknown as Partial<Entry>
    const isAventuraEntry =
      original && 'state' in original && 'injection' in original && original.injection?.mode

    if (isAventuraEntry && original.state) {
      return {
        name: original.name || imported.name,
        type: original.type || imported.type,
        description: original.description || imported.description,
        hiddenInfo: original.hiddenInfo || null,
        aliases: original.aliases || [],
        state: original.state,
        adventureState: original.adventureState || null,
        creativeState: original.creativeState || null,
        injection: original.injection || {
          mode: imported.injectionMode,
          keywords: imported.keywords,
          priority: imported.priority,
        },
        firstMentioned: original.firstMentioned || null,
        lastMentioned: original.lastMentioned || null,
        mentionCount: original.mentionCount || 0,
        createdBy,
        createdAt: now,
        updatedAt: now,
        loreManagementBlacklisted: original.loreManagementBlacklisted || false,
        branchId: null,
      }
    }

    const baseState = { type: imported.type }

    let state: Entry['state']
    switch (imported.type) {
      case 'character':
        state = {
          ...baseState,
          type: 'character',
          isPresent: false,
          lastSeenLocation: null,
          currentDisposition: null,
          relationship: {
            level: 0,
            status: 'unknown',
            history: [],
          },
          knownFacts: [],
          revealedSecrets: [],
        }
        break
      case 'location':
        state = {
          ...baseState,
          type: 'location',
          isCurrentLocation: false,
          visitCount: 0,
          changes: [],
          presentCharacters: [],
          presentItems: [],
        }
        break
      case 'item':
        state = {
          ...baseState,
          type: 'item',
          inInventory: false,
          currentLocation: null,
          condition: null,
          uses: [],
        }
        break
      case 'faction':
        state = {
          ...baseState,
          type: 'faction',
          playerStanding: 0,
          status: 'unknown',
          knownMembers: [],
        }
        break
      case 'event':
        state = {
          ...baseState,
          type: 'event',
          occurred: false,
          occurredAt: null,
          witnesses: [],
          consequences: [],
        }
        break
      case 'concept':
      default:
        state = {
          ...baseState,
          type: 'concept',
          revealed: false,
          comprehensionLevel: 'unknown',
          relatedEntries: [],
        }
        break
    }

    return {
      name: imported.name,
      type: imported.type,
      description: imported.description,
      hiddenInfo: null,
      aliases: imported.aliases.length > 0 ? imported.aliases : imported.keywords.slice(0, 5),
      state,
      adventureState: null,
      creativeState: null,
      injection: {
        mode: imported.injectionMode,
        keywords: imported.keywords,
        priority: imported.priority,
      },
      firstMentioned: null,
      lastMentioned: null,
      mentionCount: 0,
      createdBy,
      createdAt: now,
      updatedAt: now,
      loreManagementBlacklisted: false,
      branchId: null,
    }
  })
}

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
  const result = parseSillyTavernLorebook(jsonString)

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

/**
 * Extract an embedded lorebook (character_book) from a parsed character card.
 * Returns parsed entries ready for vault import, or null if no valid lorebook found.
 */
export function extractEmbeddedLorebook(
  characterBook: unknown,
  cardName: string,
): { name: string; entries: VaultLorebookEntry[]; result: LorebookImportResult } | null {
  if (!characterBook || typeof characterBook !== 'object') return null

  // SillyTavern character_book format has entries directly
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
  const result = parseSillyTavernLorebook(jsonString)

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
