import { generateStructured } from '../sdk/generate'
import { settings } from '$lib/stores/settings.svelte'
/**
 * Entry Retrieval Service for Aventura
 * Per design doc section 3.2.3: Tiered Injection
 *
 * Implements three tiers of entry injection for lorebook entries:
 * - Tier 1: Always inject (injection.mode === 'always', or state-based like isPresent)
 * - Tier 2: Keyword matching (match name/aliases/keywords against user input & recent story)
 * - Tier 3: LLM selection (STUBBED - awaiting SDK migration)
 */

import { escapeRegex } from '$lib/utils/text'
import type {
  Entry,
  EntryType,
  StoryEntry,
  Character,
  Location,
  Item,
  GenerationPreset,
} from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { buildExtraBody } from '../core/requestOverrides'
import { createLogger } from '../core/config'
import { entitySelectionSchema } from '../sdk/schemas/context'
import { ContextBuilder } from '$lib/services/context'

const log = createLogger('EntryRetrieval')

/**
 * Live world state - the actively tracked entities that should always be Tier 1
 */
export interface LiveWorldState {
  characters: Character[]
  locations: Location[]
  items: Item[]
}

/**
 * Stickiness duration by entry type (in story entries/turns).
 * After an entry is activated, it stays in Tier 1 for this many turns.
 * Each new activation resets the timer.
 */
export const STICKINESS_BY_TYPE: Record<EntryType, number> = {
  concept: 5, // Magic systems, world rules - foundational context
  faction: 4, // Faction dynamics persist during dealings
  character: 3, // Recently mentioned NPCs stay in context
  location: 3, // Nearby/mentioned locations
  event: 2, // Historical references fade quickly
  item: 2, // Items are situational
}

/**
 * Activation tracking - maps entry ID to the story position when it was last activated.
 * Used for stickiness calculations.
 */
export interface ActivationTracker {
  /** Get the last activation position for an entry */
  getLastActivation(entryId: string): number | null
  /** Record that an entry was activated at the current position */
  recordActivation(entryId: string, position: number): void
  /** Get current story position */
  currentPosition: number
}

export interface EntryRetrievalConfig {
  /** Maximum entries to include from Tier 3 (0 = unlimited) */
  maxTier3Entries: number
  /** Maximum words per lorebook entry (0 = unlimited) */
  maxWordsPerEntry: number
  /** Enable LLM selection for Tier 3 */
  enableLLMSelection: boolean
  /** Number of recent story entries to check for keyword matching */
  recentEntriesCount: number
  /** Model to use for Tier 3 selection */
  tier3Model: string
  /** Temperature for Tier 3 selection */
  temperature: number
}

export const DEFAULT_ENTRY_RETRIEVAL_CONFIG: EntryRetrievalConfig = {
  maxTier3Entries: 0, // No limit - select all relevant
  maxWordsPerEntry: 0,
  enableLLMSelection: true,
  recentEntriesCount: 5,
  tier3Model: 'x-ai/grok-4.1-fast',
  temperature: 0.2,
}

/**
 * Get entry retrieval config from settings store.
 * Falls back to defaults if settings not initialized.
 */
export function getEntryRetrievalConfigFromSettings(): EntryRetrievalConfig {
  const entrySettings = settings.systemServicesSettings.entryRetrieval
  const preset = settings.getPresetConfig(settings.getServicePresetId('entryRetrieval'))
  const maxWordsPerEntryRaw =
    typeof entrySettings.maxWordsPerEntry === 'number'
      ? entrySettings.maxWordsPerEntry
      : Number(entrySettings.maxWordsPerEntry)
  const maxWordsPerEntry = Number.isFinite(maxWordsPerEntryRaw)
    ? Math.min(Math.max(0, Math.floor(maxWordsPerEntryRaw)), 500)
    : 0
  return {
    maxTier3Entries: entrySettings.maxTier3Entries ?? 0,
    maxWordsPerEntry,
    enableLLMSelection: entrySettings.enableLLMSelection ?? true,
    recentEntriesCount: 5, // Not configurable currently
    tier3Model: preset.model,
    temperature: preset.temperature,
  }
}

export interface RetrievedEntry {
  entry: Entry
  tier: 1 | 2 | 3
  priority: number
  matchReason?: string
}

export interface EntryRetrievalResult {
  tier1: RetrievedEntry[]
  tier2: RetrievedEntry[]
  tier3: RetrievedEntry[]
  all: RetrievedEntry[]
  contextBlock: string
}

/**
 * Service that retrieves relevant lorebook entries using tiered injection.
 * - Tier 1 and Tier 2 work without AI
 * - Tier 3 uses LLM selection for large entry counts
 */
export class EntryRetrievalService extends BaseAIService {
  private config: EntryRetrievalConfig

  constructor(config: Partial<EntryRetrievalConfig> = {}, serviceId: string = 'entryRetrieval') {
    super(serviceId)
    this.config = { ...DEFAULT_ENTRY_RETRIEVAL_CONFIG, ...config }
    const maxWords = Number.isFinite(this.config.maxWordsPerEntry)
      ? this.config.maxWordsPerEntry
      : 0
    this.config.maxWordsPerEntry = Math.min(Math.max(0, Math.floor(maxWords)), 500)
  }

  private get preset(): GenerationPreset {
    return settings.getPresetConfig(this.presetId)
  }

  private get extraBody(): Record<string, unknown> | undefined {
    return buildExtraBody({
      manualMode: settings.advancedRequestSettings.manualMode,
      manualBody: this.preset.manualBody,
      reasoningEffort: this.preset.reasoningEffort,
    })
  }

  /**
   * Retrieve relevant entries using tiered injection.
   *
   * Tier 1: Always injected - includes:
   *   - Live-tracked characters (active status)
   *   - Live-tracked locations (current location)
   *   - Live-tracked items (in inventory)
   *   - Lorebook entries with injection.mode === 'always'
   *   - "Sticky" entries (recently activated via Tier 2/3, duration based on type)
   * Tier 2: Keyword matched (name/aliases/keywords match user input or recent story)
   * Tier 3: LLM selection (STUBBED - awaiting SDK migration)
   */
  async getRelevantEntries(
    entries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    liveState?: LiveWorldState,
    activationTracker?: ActivationTracker,
    signal?: AbortSignal,
  ): Promise<EntryRetrievalResult> {
    const currentPosition = activationTracker?.currentPosition ?? recentStoryEntries.length

    log('getRelevantEntries called', {
      totalEntries: entries.length,
      userInputLength: userInput.length,
      recentCount: recentStoryEntries.length,
      currentPosition,
      liveCharacters: liveState?.characters.length ?? 0,
      liveLocations: liveState?.locations.length ?? 0,
      liveItems: liveState?.items.length ?? 0,
    })

    // Build search content from user input and recent story
    const recentContent = recentStoryEntries
      .slice(-this.config.recentEntriesCount)
      .map((e) => e.content)
      .join(' ')
    const searchContent = `${userInput} ${recentContent}`.toLowerCase()

    // Tier 1: Live-tracked entities + always-inject + sticky entries
    const tier1 = this.getTier1Entries(entries, liveState, activationTracker, currentPosition)
    log(
      'Tier 1 entries (always active):',
      tier1.length,
      tier1.map((e) => e.entry.name),
    )

    // Get IDs already in tier 1
    const tier1Ids = new Set(tier1.map((e) => e.entry.id))

    // Filter to entries that could be in tier 2 or 3 (not tier 1, not 'never' mode)
    const candidateEntries = entries.filter(
      (e) => !tier1Ids.has(e.id) && e.injection.mode !== 'never',
    )

    // Tier 2: Keyword matching - check name, aliases, keywords against search content
    const tier2 = this.getTier2Entries(candidateEntries, searchContent)
    log(
      'Tier 2 entries (keyword matched):',
      tier2.length,
      tier2.map((e) => e.entry.name),
    )

    // Get IDs already in tier 1 or tier 2
    const tier1And2Ids = new Set([...tier1Ids, ...tier2.map((e) => e.entry.id)])

    // Remaining entries for Tier 3 LLM selection
    const remainingEntries = candidateEntries.filter((e) => !tier1And2Ids.has(e.id))
    log('Remaining entries for Tier 3 LLM:', remainingEntries.length)

    // Tier 3: LLM selection - runs when there are remaining entries and LLM selection is enabled
    let tier3: RetrievedEntry[] = []

    if (this.config.enableLLMSelection && remainingEntries.length > 0) {
      log('Tier 3 LLM selection triggered', {
        remainingEntries: remainingEntries.length,
      })
      tier3 = await this.getLLMSelectedEntries(
        remainingEntries,
        userInput,
        recentStoryEntries,
        signal,
      )
      log(
        'Tier 3 entries:',
        tier3.length,
        tier3.map((e) => e.entry.name),
      )
    }

    // Record activations for Tier 2 entries (for stickiness tracking)
    // Note: Tier 3 activations would also be recorded here once SDK migration is complete
    if (activationTracker) {
      for (const retrieved of tier2) {
        // Don't record activations for live entities (they have synthetic IDs)
        if (!retrieved.entry.id.startsWith('live-')) {
          activationTracker.recordActivation(retrieved.entry.id, currentPosition)
        }
      }
      log('Recorded activations for', tier2.length, 'entries at position', currentPosition)
    }

    // Combine and sort by priority
    const all = [...tier1, ...tier2, ...tier3].sort((a, b) => b.priority - a.priority)

    // Build context block
    const contextBlock = this.buildContextBlock(tier1, tier2, tier3)

    return { tier1, tier2, tier3, all, contextBlock }
  }

  /**
   * Tier 2: Keyword matching.
   * Match entry name, aliases, and keywords against user input and recent story content.
   */
  private getTier2Entries(entries: Entry[], searchContent: string): RetrievedEntry[] {
    const result: RetrievedEntry[] = []

    for (const entry of entries) {
      const matchedKeywords: string[] = []

      // Check entry name
      if (this.textMatches(entry.name, searchContent)) {
        matchedKeywords.push(entry.name)
      }

      // Check aliases
      if (entry.aliases) {
        for (const alias of entry.aliases) {
          if (this.textMatches(alias, searchContent)) {
            matchedKeywords.push(alias)
          }
        }
      }

      // Check injection keywords
      if (entry.injection.keywords) {
        for (const keyword of entry.injection.keywords) {
          if (this.textMatches(keyword, searchContent)) {
            matchedKeywords.push(keyword)
          }
        }
      }

      if (matchedKeywords.length > 0) {
        result.push({
          entry,
          tier: 2,
          priority: 70 + entry.injection.priority,
          matchReason: `matched: ${[...new Set(matchedKeywords)].join(', ')}`,
        })
      }
    }

    return result
  }

  /**
   * Tier 1: Always inject entries.
   *
   * Live-tracked entities (highest priority):
   * - Active characters from the tracker
   * - Current location from the tracker
   * - Items in inventory from the tracker
   *
   * Lorebook entries:
   * - Entries with injection.mode === 'always'
   * - Entries with state-based conditions (legacy, for imported lorebooks with state)
   * - "Sticky" entries (recently activated via Tier 2/3, duration based on entry type)
   */
  private getTier1Entries(
    entries: Entry[],
    liveState?: LiveWorldState,
    activationTracker?: ActivationTracker,
    currentPosition?: number,
  ): RetrievedEntry[] {
    const result: RetrievedEntry[] = []
    const includedIds = new Set<string>()

    // First, add live-tracked entities (these are the primary Tier 1 sources)
    if (liveState) {
      // Active characters
      for (const char of liveState.characters) {
        if (char.status === 'active') {
          const entry = this.characterToEntry(char)
          result.push({
            entry,
            tier: 1,
            priority: 95,
            matchReason: 'active character',
          })
          includedIds.add(entry.id)
        }
      }

      // Current location
      for (const loc of liveState.locations) {
        if (loc.current) {
          const entry = this.locationToEntry(loc)
          result.push({
            entry,
            tier: 1,
            priority: 100,
            matchReason: 'current location',
          })
          includedIds.add(entry.id)
        }
      }

      // Items in inventory
      for (const item of liveState.items) {
        if (item.location === 'inventory') {
          const entry = this.itemToEntry(item)
          result.push({
            entry,
            tier: 1,
            priority: 80,
            matchReason: 'in inventory',
          })
          includedIds.add(entry.id)
        }
      }
    }

    // Then, process lorebook entries
    for (const entry of entries) {
      if (includedIds.has(entry.id)) continue

      let shouldInclude = false
      let priority = 0
      let reason = ''

      // Check injection mode
      if (entry.injection.mode === 'always') {
        shouldInclude = true
        priority = 90
        reason = 'always inject'
      }

      // Check state-based conditions (for imported lorebooks that have state)
      if (entry.state) {
        switch (entry.state.type) {
          case 'character':
            if ('isPresent' in entry.state && entry.state.isPresent) {
              shouldInclude = true
              priority = Math.max(priority, 85)
              reason = 'lorebook: character present'
            }
            break
          case 'location':
            if ('isCurrentLocation' in entry.state && entry.state.isCurrentLocation) {
              shouldInclude = true
              priority = Math.max(priority, 90)
              reason = 'lorebook: current location'
            }
            break
          case 'item':
            if ('inInventory' in entry.state && entry.state.inInventory) {
              shouldInclude = true
              priority = Math.max(priority, 75)
              reason = 'lorebook: in inventory'
            }
            break
          case 'faction':
            if (
              'status' in entry.state &&
              (entry.state.status === 'allied' || entry.state.status === 'hostile')
            ) {
              shouldInclude = true
              priority = Math.max(priority, 70)
              reason = `lorebook: faction ${entry.state.status}`
            }
            break
        }
      }

      // Check stickiness (recently activated entries stay in Tier 1)
      if (!shouldInclude && activationTracker && currentPosition !== undefined) {
        const lastActivation = activationTracker.getLastActivation(entry.id)
        if (lastActivation !== null) {
          const stickiness = STICKINESS_BY_TYPE[entry.type]
          const turnsSinceActivation = currentPosition - lastActivation

          if (turnsSinceActivation <= stickiness) {
            shouldInclude = true
            // Priority decreases as stickiness fades
            const fadeRatio = 1 - turnsSinceActivation / (stickiness + 1)
            priority = Math.max(priority, Math.round(60 + fadeRatio * 20)) // 60-80 range
            reason = `sticky (${entry.type}, ${stickiness - turnsSinceActivation} turns left)`
          }
        }
      }

      if (shouldInclude) {
        result.push({
          entry,
          tier: 1,
          priority,
          matchReason: reason,
        })
        includedIds.add(entry.id)
      }
    }

    return result
  }

  /**
   * Convert a live Character to an Entry-like object for context injection.
   */
  private characterToEntry(char: Character): Entry {
    return {
      id: `live-char-${char.id}`,
      storyId: char.storyId,
      name: char.name,
      type: 'character',
      description: char.description || '',
      hiddenInfo: null,
      aliases: [],
      state: {
        type: 'character',
        isPresent: char.status === 'active',
        lastSeenLocation: null,
        currentDisposition: char.relationship,
        relationship: { level: 0, status: char.relationship || 'unknown', history: [] },
        knownFacts: char.traits,
        revealedSecrets: [],
      },
      adventureState: null,
      creativeState: null,
      injection: { mode: 'always', keywords: [], priority: 95 },
      firstMentioned: null,
      lastMentioned: null,
      mentionCount: 0,
      createdBy: 'ai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      loreManagementBlacklisted: false,
      branchId: char.branchId,
    }
  }

  /**
   * Convert a live Location to an Entry-like object for context injection.
   */
  private locationToEntry(loc: Location): Entry {
    return {
      id: `live-loc-${loc.id}`,
      storyId: loc.storyId,
      name: loc.name,
      type: 'location',
      description: loc.description || '',
      hiddenInfo: null,
      aliases: [],
      state: {
        type: 'location',
        isCurrentLocation: loc.current,
        visitCount: loc.visited ? 1 : 0,
        changes: [],
        presentCharacters: [],
        presentItems: [],
      },
      adventureState: null,
      creativeState: null,
      injection: { mode: 'always', keywords: [], priority: 100 },
      firstMentioned: null,
      lastMentioned: null,
      mentionCount: 0,
      createdBy: 'ai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      loreManagementBlacklisted: false,
      branchId: loc.branchId,
    }
  }

  /**
   * Convert a live Item to an Entry-like object for context injection.
   */
  private itemToEntry(item: Item): Entry {
    // Build description including quantity and equipped status
    let desc = item.description || ''
    if (item.quantity > 1) {
      desc += ` (x${item.quantity})`
    }
    if (item.equipped) {
      desc += ' [equipped]'
    }

    return {
      id: `live-item-${item.id}`,
      storyId: item.storyId,
      name: item.name,
      type: 'item',
      description: desc,
      hiddenInfo: null,
      aliases: [],
      state: {
        type: 'item',
        inInventory: item.location === 'inventory',
        currentLocation: item.location,
        condition: item.equipped ? 'equipped' : null,
        uses: [],
      },
      adventureState: null,
      creativeState: null,
      injection: { mode: 'always', keywords: [], priority: 80 },
      firstMentioned: null,
      lastMentioned: null,
      mentionCount: 0,
      createdBy: 'ai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      loreManagementBlacklisted: false,
      branchId: item.branchId,
    }
  }

  /**
   * Tier 3: LLM-based selection for relevant lorebook entries.
   * Asks the LLM to select the most relevant entries from the candidate pool.
   */
  private async getLLMSelectedEntries(
    availableEntries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    signal?: AbortSignal,
  ): Promise<RetrievedEntry[]> {
    if (availableEntries.length === 0) {
      return []
    }

    // Format entries for the prompt
    const entrySummaries = availableEntries
      .map((e, i) => {
        const desc = e.description ? e.description.slice(0, 100) : ''
        return `${i}. [${e.type}] ${e.name}${desc ? `: ${desc}` : ''}`
      })
      .join('\n')

    // Build recent content for context
    const recentContent = recentStoryEntries
      .slice(-this.config.recentEntriesCount)
      .map((e) => e.content)
      .join('\n\n')

    const ctx = new ContextBuilder()
    ctx.add({ recentContent, userInput, entrySummaries })
    const { system, user: prompt } = await ctx.render('tier3-entry-selection')

    try {
      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: entitySelectionSchema,
          system,
          prompt,
          signal,
        },
        'tier3-entry-selection',
      )

      // Map selected IDs back to RetrievedEntry objects
      const selectedSet = new Set(result.selectedIds)
      const entries: RetrievedEntry[] = []

      for (let i = 0; i < availableEntries.length; i++) {
        const entry = availableEntries[i]
        // Check if selected by ID or by index (some LLMs return indices)
        if (selectedSet.has(entry.id) || selectedSet.has(i.toString())) {
          entries.push({
            entry,
            tier: 3,
            priority: 50 + entry.injection.priority,
            matchReason: 'LLM selected',
          })
        }
      }

      log('Tier 3 LLM selection complete', {
        candidates: availableEntries.length,
        selected: entries.length,
        reasoning: result.reasoning,
      })

      // Apply limit if configured
      if (this.config.maxTier3Entries > 0) {
        return entries.slice(0, this.config.maxTier3Entries)
      }
      return entries
    } catch (error) {
      log('Tier 3 LLM selection failed', error)
      return []
    }
  }

  /**
   * Check if text matches in search content.
   */
  private textMatches(text: string, searchContent: string): boolean {
    const normalized = text.toLowerCase().trim()
    if (normalized.length < 2) return false

    // Exact match
    if (searchContent.includes(normalized)) {
      return true
    }

    // Word boundary match
    const wordPattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'i')
    if (wordPattern.test(searchContent)) {
      return true
    }

    return false
  }

  /**
   * Build context block for prompt injection.
   */
  private buildContextBlock(
    tier1: RetrievedEntry[],
    tier2: RetrievedEntry[],
    tier3: RetrievedEntry[],
  ): string {
    const all = [...tier1, ...tier2, ...tier3]
    if (all.length === 0) return ''

    let block = `\n\n[LOREBOOK CONTEXT]
(CANONICAL - All information below is established lore. Do not contradict these facts.)`

    // Group by type
    const byType: Record<EntryType, RetrievedEntry[]> = {
      character: [],
      location: [],
      item: [],
      faction: [],
      concept: [],
      event: [],
    }

    for (const retrieved of all) {
      byType[retrieved.entry.type].push(retrieved)
    }

    // Characters
    if (byType.character.length > 0) {
      block += '\n\n• Characters:'
      for (const { entry } of byType.character) {
        const description = this.truncateEntryText(entry.description)
        block += `\n  - ${entry.name}: ${description}`
        if (entry.state?.type === 'character') {
          const state = entry.state
          if (state.currentDisposition) {
            block += ` [${state.currentDisposition}]`
          }
        }
      }
    }

    // Locations
    if (byType.location.length > 0) {
      block += '\n\n• Locations:'
      for (const { entry } of byType.location) {
        const description = this.truncateEntryText(entry.description)
        block += `\n  - ${entry.name}: ${description}`
      }
    }

    // Items
    if (byType.item.length > 0) {
      block += '\n\n• Items:'
      for (const { entry } of byType.item) {
        const description = this.truncateEntryText(entry.description)
        block += `\n  - ${entry.name}: ${description}`
      }
    }

    // Factions
    if (byType.faction.length > 0) {
      block += '\n\n• Factions:'
      for (const { entry } of byType.faction) {
        const description = this.truncateEntryText(entry.description)
        block += `\n  - ${entry.name}: ${description}`
      }
    }

    // Concepts
    if (byType.concept.length > 0) {
      block += '\n\n• Lore:'
      for (const { entry } of byType.concept) {
        const description = this.truncateEntryText(entry.description)
        block += `\n  - ${entry.name}: ${description}`
      }
    }

    // Events
    if (byType.event.length > 0) {
      block += '\n\n• Events:'
      for (const { entry } of byType.event) {
        const description = this.truncateEntryText(entry.description)
        block += `\n  - ${entry.name}: ${description}`
      }
    }

    return block
  }

  private truncateEntryText(text: string): string {
    const maxWords = this.config.maxWordsPerEntry
    if (!maxWords || maxWords <= 0) return text
    const trimmed = text.trim()
    if (!trimmed) return text
    const words = trimmed.split(/\s+/)
    if (words.length <= maxWords) return text
    return `${words.slice(0, maxWords).join(' ')} [...]`
  }
}

/**
 * Quick function to get relevant entries without a full service instance.
 * Uses settings from the settings store for configuration.
 */
export async function getRelevantEntries(
  entries: Entry[],
  userInput: string,
  recentStoryEntries: StoryEntry[],
  liveState?: LiveWorldState,
  activationTracker?: ActivationTracker,
): Promise<EntryRetrievalResult> {
  const config = getEntryRetrievalConfigFromSettings()
  const service = new EntryRetrievalService(config, 'entryRetrieval')
  return service.getRelevantEntries(
    entries,
    userInput,
    recentStoryEntries,
    liveState,
    activationTracker,
  )
}

/**
 * Simple in-memory activation tracker implementation.
 * Tracks when lorebook entries were last activated for stickiness calculations.
 */
export class SimpleActivationTracker implements ActivationTracker {
  private activations = new Map<string, number>()
  public currentPosition: number

  constructor(currentPosition: number) {
    this.currentPosition = currentPosition
  }

  getLastActivation(entryId: string): number | null {
    return this.activations.get(entryId) ?? null
  }

  recordActivation(entryId: string, position: number): void {
    this.activations.set(entryId, position)
  }

  /** Update the current position (call this each turn) */
  setPosition(position: number): void {
    this.currentPosition = position
  }

  /** Get all activation data (for persistence) */
  getActivationData(): Record<string, number> {
    return Object.fromEntries(this.activations)
  }

  /** Load activation data (from persistence) */
  loadActivationData(data: Record<string, number>): void {
    this.activations = new Map(Object.entries(data))
  }

  /** Clear old activations that are beyond any stickiness window */
  pruneOldActivations(maxStickiness: number = 10): void {
    for (const [entryId, position] of this.activations) {
      if (this.currentPosition - position > maxStickiness) {
        this.activations.delete(entryId)
      }
    }
  }
}
