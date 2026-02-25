/**
 * Entry Injector Service
 * Per design doc section 3.2.3: Tiered Injection
 *
 * Implements three tiers of entry injection:
 * - Tier 1: Always inject (current location, present chars, inventory)
 * - Tier 2: Name matching (fuzzy match against recent input)
 * - Tier 3: LLM selection (for large entry counts)
 */

import type { Character, Location, Item, StoryBeat, StoryEntry, Chapter } from '$lib/types'
import { createLogger } from '../core/config'
import { generateStructured } from '../sdk/generate'
import { entitySelectionSchema } from '../sdk/schemas/context'
import { ContextBuilder as ContextPipeline } from '$lib/services/context'

const log = createLogger('EntryInjector')

export interface WorldState {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
  chapters?: Chapter[]
}

export interface ContextConfig {
  /** Threshold for triggering LLM selection (Tier 3) */
  llmThreshold: number
  /** Maximum entries to include from each tier */
  maxEntriesPerTier: number
  /** Enable LLM selection for large entry counts */
  enableLLMSelection: boolean
  /** Number of recent entries to check for name matching */
  recentEntriesCount: number
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  llmThreshold: 30,
  maxEntriesPerTier: 10,
  enableLLMSelection: true,
  recentEntriesCount: 5,
}

export interface RelevantEntry {
  type: 'character' | 'location' | 'item' | 'storyBeat'
  id: string
  name: string
  description: string | null
  tier: 1 | 2 | 3
  priority: number
  metadata?: Record<string, any>
}

export interface ContextResult {
  tier1: RelevantEntry[]
  tier2: RelevantEntry[]
  tier3: RelevantEntry[]
  all: RelevantEntry[]
  contextBlock: string
}

/**
 * Service that builds context from world state using tiered injection.
 * - Tier 1 and Tier 2 work without AI
 * - Tier 3 uses LLM selection when entry count exceeds threshold
 */
export class EntryInjector {
  private config: ContextConfig
  private presetId: string

  constructor(config: Partial<ContextConfig> = {}, presetId: string = 'classification') {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
    this.presetId = presetId
  }

  /**
   * Build context from world state using tiered injection.
   * NOTE: Tier 3 is currently disabled pending SDK migration.
   */
  async buildContext(
    worldState: WorldState,
    userInput: string,
    recentEntries: StoryEntry[],
    retrievedChapterContext?: string,
  ): Promise<ContextResult> {
    log('buildContext called', {
      characters: worldState.characters.length,
      locations: worldState.locations.length,
      items: worldState.items.length,
      storyBeats: worldState.storyBeats.length,
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
    })

    // Tier 1: Always inject - state-based entries
    const tier1 = this.getTier1Entries(worldState)
    log('Tier 1 entries:', tier1.length)

    // Get IDs already in tier 1 to avoid duplicates
    const tier1Ids = new Set(tier1.map((e) => e.id))

    // Tier 2: Name matching - fuzzy match against input and recent messages
    const tier2 = this.getTier2Entries(worldState, userInput, recentEntries, tier1Ids)
    log('Tier 2 entries:', tier2.length)

    // Get IDs in tier 1 + 2
    const tier12Ids = new Set([...tier1Ids, ...tier2.map((e) => e.id)])

    // Tier 3: LLM selection - runs when entry count exceeds llmThreshold
    let tier3: RelevantEntry[] = []
    const remainingCount = this.countRemainingEntries(worldState, tier12Ids)

    if (this.config.enableLLMSelection && remainingCount > this.config.llmThreshold) {
      log('Tier 3 LLM selection triggered', {
        remainingEntries: remainingCount,
        threshold: this.config.llmThreshold,
      })
      tier3 = await this.getTier3Entries(worldState, userInput, recentEntries, tier12Ids)
      log('Tier 3 entries:', tier3.length)
    }

    // Combine all entries
    const all = [...tier1, ...tier2, ...tier3]

    // Build the context block
    const contextBlock = this.buildContextBlock(tier1, tier2, tier3, retrievedChapterContext)

    return { tier1, tier2, tier3, all, contextBlock }
  }

  /**
   * Tier 1: Always inject entries based on current state.
   * - Current location
   * - Present characters (active status)
   * - Inventory items
   * - Active story beats/quests
   */
  private getTier1Entries(worldState: WorldState): RelevantEntry[] {
    const entries: RelevantEntry[] = []

    // Current location
    if (worldState.currentLocation) {
      entries.push({
        type: 'location',
        id: worldState.currentLocation.id,
        name: worldState.currentLocation.name,
        description: worldState.currentLocation.description,
        tier: 1,
        priority: 100,
        metadata: { current: true },
      })
    }

    // Active characters (excluding protagonist)
    const activeChars = worldState.characters.filter(
      (c) => c.status === 'active' && c.relationship !== 'self',
    )
    for (const char of activeChars.slice(0, this.config.maxEntriesPerTier)) {
      entries.push({
        type: 'character',
        id: char.id,
        name: char.name,
        description: char.description,
        tier: 1,
        priority: 90,
        metadata: {
          relationship: char.relationship,
          traits: char.traits,
          visualDescriptors: char.visualDescriptors,
        },
      })
    }

    // Inventory items
    const inventoryItems = worldState.items.filter((i) => i.location === 'inventory')
    for (const item of inventoryItems.slice(0, this.config.maxEntriesPerTier)) {
      entries.push({
        type: 'item',
        id: item.id,
        name: item.name,
        description: item.description,
        tier: 1,
        priority: 70,
        metadata: {
          quantity: item.quantity,
          equipped: item.equipped,
        },
      })
    }

    // Active story beats/quests
    const activeBeats = worldState.storyBeats.filter(
      (b) => b.status === 'active' || b.status === 'pending',
    )
    for (const beat of activeBeats.slice(0, this.config.maxEntriesPerTier)) {
      entries.push({
        type: 'storyBeat',
        id: beat.id,
        name: beat.title,
        description: beat.description,
        tier: 1,
        priority: 80,
        metadata: { type: beat.type, status: beat.status },
      })
    }

    return entries
  }

  /**
   * Tier 2: Name matching against user input and recent entries.
   * Uses fuzzy matching to find references to characters, locations, items.
   */
  private getTier2Entries(
    worldState: WorldState,
    userInput: string,
    recentEntries: StoryEntry[],
    excludeIds: Set<string>,
  ): RelevantEntry[] {
    const entries: RelevantEntry[] = []

    // Combine user input with recent entry content for matching
    const recentContent = recentEntries
      .slice(-this.config.recentEntriesCount)
      .map((e) => e.content)
      .join(' ')
    const searchText = (userInput + ' ' + recentContent).toLowerCase()

    // Match characters not in Tier 1
    for (const char of worldState.characters) {
      if (excludeIds.has(char.id)) continue
      if (this.nameMatches(char.name, searchText)) {
        entries.push({
          type: 'character',
          id: char.id,
          name: char.name,
          description: char.description,
          tier: 2,
          priority: 60,
          metadata: {
            relationship: char.relationship,
            traits: char.traits,
            visualDescriptors: char.visualDescriptors,
          },
        })
      }
    }

    // Match locations not in Tier 1
    for (const loc of worldState.locations) {
      if (excludeIds.has(loc.id)) continue
      if (this.nameMatches(loc.name, searchText)) {
        entries.push({
          type: 'location',
          id: loc.id,
          name: loc.name,
          description: loc.description,
          tier: 2,
          priority: 50,
          metadata: { visited: loc.visited },
        })
      }
    }

    // Match items not in Tier 1
    for (const item of worldState.items) {
      if (excludeIds.has(item.id)) continue
      if (this.nameMatches(item.name, searchText)) {
        entries.push({
          type: 'item',
          id: item.id,
          name: item.name,
          description: item.description,
          tier: 2,
          priority: 40,
          metadata: { quantity: item.quantity, location: item.location },
        })
      }
    }

    // Match story beats not in Tier 1
    for (const beat of worldState.storyBeats) {
      if (excludeIds.has(beat.id)) continue
      if (this.nameMatches(beat.title, searchText)) {
        entries.push({
          type: 'storyBeat',
          id: beat.id,
          name: beat.title,
          description: beat.description,
          tier: 2,
          priority: 45,
          metadata: { type: beat.type, status: beat.status },
        })
      }
    }

    return entries.slice(0, this.config.maxEntriesPerTier)
  }

  /**
   * Tier 3: LLM-based selection for large entry counts.
   * Asks the LLM to select the most relevant entries from the remaining pool.
   */
  private async getTier3Entries(
    worldState: WorldState,
    userInput: string,
    recentEntries: StoryEntry[],
    excludeIds: Set<string>,
  ): Promise<RelevantEntry[]> {
    // Collect all remaining entries not in Tier 1 or 2
    const candidates: {
      type: RelevantEntry['type']
      id: string
      name: string
      description: string | null
    }[] = []

    for (const char of worldState.characters) {
      if (!excludeIds.has(char.id)) {
        candidates.push({
          type: 'character',
          id: char.id,
          name: char.name,
          description: char.description,
        })
      }
    }
    for (const loc of worldState.locations) {
      if (!excludeIds.has(loc.id)) {
        candidates.push({
          type: 'location',
          id: loc.id,
          name: loc.name,
          description: loc.description,
        })
      }
    }
    for (const item of worldState.items) {
      if (!excludeIds.has(item.id)) {
        candidates.push({
          type: 'item',
          id: item.id,
          name: item.name,
          description: item.description,
        })
      }
    }
    for (const beat of worldState.storyBeats) {
      if (!excludeIds.has(beat.id)) {
        candidates.push({
          type: 'storyBeat',
          id: beat.id,
          name: beat.title,
          description: beat.description,
        })
      }
    }

    if (candidates.length === 0) {
      return []
    }

    // Format entries for the prompt
    const entrySummaries = candidates
      .map(
        (e, i) =>
          `${i}. [${e.type}] ${e.name}${e.description ? `: ${e.description.slice(0, 100)}` : ''}`,
      )
      .join('\n')

    // Build recent content for context
    const recentContent = recentEntries
      .slice(-this.config.recentEntriesCount)
      .map((e) => e.content)
      .join('\n\n')

    const ctx = new ContextPipeline()
    ctx.add({ recentContent, userInput, entrySummaries })
    const { system, user: prompt } = await ctx.render('tier3-entry-selection')

    try {
      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: entitySelectionSchema,
          system,
          prompt,
        },
        'tier3-entry-selection',
      )

      // Map selected IDs back to RelevantEntry objects
      const selectedSet = new Set(result.selectedIds)
      const entries: RelevantEntry[] = []

      for (const candidate of candidates) {
        // Check if selected by ID or by index (some LLMs return indices)
        const indexStr = candidates.indexOf(candidate).toString()
        if (selectedSet.has(candidate.id) || selectedSet.has(indexStr)) {
          entries.push({
            type: candidate.type,
            id: candidate.id,
            name: candidate.name,
            description: candidate.description,
            tier: 3,
            priority: 30,
          })
        }
      }

      log('Tier 3 LLM selection complete', {
        candidates: candidates.length,
        selected: entries.length,
        reasoning: result.reasoning,
      })

      return entries.slice(0, this.config.maxEntriesPerTier)
    } catch (error) {
      log('Tier 3 LLM selection failed', error)
      return []
    }
  }

  /**
   * Check if a name fuzzy-matches against search text.
   */
  private nameMatches(name: string, searchText: string): boolean {
    const normalizedName = name.toLowerCase().trim()

    // Exact match
    if (searchText.includes(normalizedName)) {
      return true
    }

    // Word boundary match (name appears as a word)
    const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const wordPattern = new RegExp(`\\b${escaped}\\b`, 'i')
    if (wordPattern.test(searchText)) {
      return true
    }

    // Partial match for longer names (3+ chars)
    if (normalizedName.length >= 3) {
      // Check if any word in searchText starts with the name
      const words = searchText.split(/\s+/)
      if (words.some((word) => word.startsWith(normalizedName))) {
        return true
      }
    }

    return false
  }

  /**
   * Count remaining entries not in the given set.
   */
  private countRemainingEntries(worldState: WorldState, excludeIds: Set<string>): number {
    let count = 0
    count += worldState.characters.filter((c) => !excludeIds.has(c.id)).length
    count += worldState.locations.filter((l) => !excludeIds.has(l.id)).length
    count += worldState.items.filter((i) => !excludeIds.has(i.id)).length
    count += worldState.storyBeats.filter((b) => !excludeIds.has(b.id)).length
    return count
  }

  /**
   * Build the context block string for injection into the system prompt.
   */
  private buildContextBlock(
    tier1: RelevantEntry[],
    tier2: RelevantEntry[],
    tier3: RelevantEntry[],
    retrievedChapterContext?: string,
  ): string {
    let block = ''

    // Current location (from Tier 1)
    const currentLoc = tier1.find((e) => e.type === 'location' && e.metadata?.current)
    if (currentLoc) {
      block += `\n\n[CURRENT LOCATION]\n${currentLoc.name}`
      if (currentLoc.description) {
        block += `\n${currentLoc.description}`
      }
    }

    // Characters (combine from all tiers)
    const allChars = [...tier1, ...tier2, ...tier3].filter((e) => e.type === 'character')
    if (allChars.length > 0) {
      block += '\n\n[KNOWN CHARACTERS]'
      for (const char of allChars) {
        block += `\n• ${char.name}`
        if (char.metadata?.relationship) {
          block += ` (${char.metadata.relationship})`
        }
        if (char.description) {
          block += ` - ${char.description}`
        }
        if (char.metadata?.traits && char.metadata.traits.length > 0) {
          block += ` [${char.metadata.traits.join(', ')}]`
        }
        if (char.metadata?.visualDescriptors) {
          const vd = char.metadata.visualDescriptors
          // Handle both old array format and new object format
          if (Array.isArray(vd) && vd.length > 0) {
            block += ` {Appearance: ${vd.join(', ')}}`
          } else if (typeof vd === 'object' && Object.keys(vd).length > 0) {
            const parts: string[] = []
            if (vd.face) parts.push(vd.face)
            if (vd.hair) parts.push(vd.hair)
            if (vd.eyes) parts.push(vd.eyes)
            if (vd.build) parts.push(vd.build)
            if (vd.clothing) parts.push(vd.clothing)
            if (vd.accessories) parts.push(vd.accessories)
            if (vd.distinguishing) parts.push(vd.distinguishing)
            if (parts.length > 0) {
              block += ` {Appearance: ${parts.join(', ')}}`
            }
          }
        }
      }
    }

    // Inventory (from Tier 1)
    const inventoryItems = tier1.filter((e) => e.type === 'item')
    if (inventoryItems.length > 0) {
      const inventoryStr = inventoryItems
        .map((item) => {
          let str = item.name
          const qty = item.metadata?.quantity
          if (qty && qty > 1) str += ` (×${qty})`
          if (item.metadata?.equipped) str += ' [equipped]'
          return str
        })
        .join(', ')
      block += `\n\n[INVENTORY]\n${inventoryStr}`
    }

    // Active quests/threads (from Tier 1)
    const activeBeats = tier1.filter((e) => e.type === 'storyBeat')
    if (activeBeats.length > 0) {
      block += '\n\n[ACTIVE THREADS]'
      for (const beat of activeBeats) {
        block += `\n• ${beat.name}`
        if (beat.description) {
          block += `: ${beat.description}`
        }
      }
    }

    // Mentioned locations (from Tier 2/3, not current)
    const mentionedLocs = [...tier2, ...tier3].filter(
      (e) => e.type === 'location' && !e.metadata?.current,
    )
    if (mentionedLocs.length > 0) {
      block += '\n\n[RELEVANT LOCATIONS]'
      for (const loc of mentionedLocs) {
        block += `\n• ${loc.name}`
        if (loc.description) {
          block += `: ${loc.description}`
        }
      }
    }

    // Mentioned items (from Tier 2/3, not inventory)
    const mentionedItems = [...tier2, ...tier3].filter((e) => e.type === 'item')
    if (mentionedItems.length > 0) {
      block += '\n\n[RELEVANT ITEMS]'
      for (const item of mentionedItems) {
        block += `\n• ${item.name}`
        if (item.description) {
          block += `: ${item.description}`
        }
      }
    }

    // Story beats from Tier 2/3
    const mentionedBeats = [...tier2, ...tier3].filter((e) => e.type === 'storyBeat')
    if (mentionedBeats.length > 0) {
      block += '\n\n[RELATED STORY THREADS]'
      for (const beat of mentionedBeats) {
        block += `\n• ${beat.name}`
        if (beat.description) {
          block += `: ${beat.description}`
        }
      }
    }

    // Retrieved chapter context
    if (retrievedChapterContext) {
      block += retrievedChapterContext
    }

    return block
  }
}
