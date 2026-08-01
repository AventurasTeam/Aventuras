/**
 * World State Injector
 * Per design doc section 3.2.3: Tiered Injection
 *
 * Injects the live-tracked WorldState (characters, locations, items, story beats)
 * into the narrative prompt using three tiers:
 * - Tier 1: Always inject (current location, present chars, inventory), plus
 *   recently-mentioned entities kept around for a few more turns ("stickiness",
 *   see `WORLD_STATE_STICKINESS_BY_TYPE`) when an `ActivationTracker` is provided
 * - Tier 2: Name matching (fuzzy match against recent input)
 * - Tier 3: everything tiers 1-2 left uncovered -- included as-is when there is little of
 *   it, narrowed by LLM selection when there is more than `llmThreshold`
 *
 * Counterpart to ClassifierService ("World State Classifier" in Agent Profiles), which extracts
 * WorldState changes from the narrative response after generation; this service injects
 * WorldState into the prompt before generation. Same data, opposite directions, opposite
 * ends of the turn -- the two are easy to confuse by name and share nothing else.
 *
 * Distinct from EntryRetrievalService, which selects from Lorebook `Entry[]` records
 * rather than the live-tracked WorldState entities handled here. The two pools do not
 * overlap: a lorebook Entry is authored lore that does not change unless someone edits
 * it, while these are records the classifier rewrites every turn.
 *
 * Runs in full on every narrator turn, in every Memory Retrieval mode -- as does
 * EntryRetrievalService now. Agentic Retrieval stands in for neither: its tools reach
 * Lorebook entries and chapters, it is never shown live WorldState, and it no longer selects
 * anything. It used to suppress this service's Tier 3 on the reasoning that "the agent
 * already did LLM selection"; that conflated two disjoint candidate pools and is gone.
 *
 * Called from `RetrievalPhase`, in the same stage as EntryRetrievalService and before memory
 * retrieval -- which is what lets the memory step be told what the narrator already has.
 * It used to run inside `streamNarrative()`, after retrieval, because `buildContext`
 * appended retrieval's output to its own block and so could not run before it.
 */

import type { Character, Location, Item, StoryBeat, StoryEntry } from '$lib/types'
import { settings, type ServiceId } from '$lib/stores/settings.svelte'
import { BaseAIService } from '../BaseAIService'
import { WORLD_STATE_INJECTION_DEFAULTS } from '../core/defaults'
import { createLogger } from '$lib/log'
import { entityNameMatches } from '$lib/utils/text'
import {
  runTier3Selection,
  resolveTier3Selection,
  type Tier3Candidate,
} from '../retrieval/tier3Selection'

/** A world-state entity as Tier 3 considers it, before it becomes a context entry. */
type WorldStateCandidate = Tier3Candidate<WorldStateContextEntry['type']>
import type { ActivationTracker } from '../retrieval/EntryRetrievalService'
import { resolveStickiness } from '../retrieval/stickiness'
import { recentContent, AS_HAYSTACK } from '$lib/utils/recentContent'

const log = createLogger('WorldStateInjector')

/**
 * Stickiness duration by candidate type, the counterpart to EntryRetrievalService's
 * STICKINESS_BY_TYPE. Two maps rather than one because the type vocabularies do not line
 * up: these are character/location/item/storyBeat, lorebook entries are
 * faction/concept/event instead of storyBeat. The fading priority both maps feed is shared
 * -- see `retrieval/stickiness.ts`.
 *
 * The numbers are deliberately kept identical to the lorebook map rather than doubled;
 * changing the scale is a tuning decision for both at once.
 */
const WORLD_STATE_STICKINESS_BY_TYPE: Record<WorldStateContextEntry['type'], number> = {
  character: 3,
  location: 3,
  item: 2,
  storyBeat: 3,
}

export interface WorldStateInjectorInput {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
}

export interface WorldStateInjectorConfig {
  /** Threshold for triggering LLM selection (Tier 3) */
  llmThreshold: number
  /** Maximum entities to include from Tier 2 (name matched) */
  maxTier2Entries: number
  /** Maximum entities to include from Tier 3, when the LLM had to choose */
  maxTier3Entries: number
  /** Enable LLM selection for large entry counts */
  enableLLMSelection: boolean
  /** Number of recent entries to check for name matching */
  recentEntriesCount: number
}

export const DEFAULT_WORLD_STATE_INJECTOR_CONFIG: WorldStateInjectorConfig = {
  llmThreshold: WORLD_STATE_INJECTION_DEFAULTS.llmThreshold,
  maxTier2Entries: WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries,
  maxTier3Entries: WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries,
  enableLLMSelection: true,
  recentEntriesCount: 5,
}

/**
 * Get world state injection config from settings, falling back to defaults.
 * Mirrors EntryRetrievalService's `getEntryRetrievalConfigFromSettings()`.
 */
export function getWorldStateInjectorConfigFromSettings(): Partial<WorldStateInjectorConfig> {
  const s = settings.systemServicesSettings.worldStateInjection
  return {
    llmThreshold: s?.llmThreshold ?? WORLD_STATE_INJECTION_DEFAULTS.llmThreshold,
    maxTier2Entries: s?.maxTier2Entries ?? WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries,
    maxTier3Entries: s?.maxTier3Entries ?? WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries,
    enableLLMSelection: s?.enableLLMSelection ?? true,
    recentEntriesCount: s?.recentEntriesCount ?? 5,
  }
}

export interface WorldStateContextEntry {
  type: 'character' | 'location' | 'item' | 'storyBeat'
  id: string
  name: string
  description: string | null
  tier: 1 | 2 | 3
  priority: number
  metadata?: Record<string, any>
}

export interface WorldStateInjectionResult {
  tier1: WorldStateContextEntry[]
  tier2: WorldStateContextEntry[]
  tier3: WorldStateContextEntry[]
  all: WorldStateContextEntry[]
  contextBlock: string
}

/**
 * Service that injects the live WorldState into the narrative prompt using tiered injection.
 * - Tier 1 and Tier 2 work without AI
 * - Tier 3 uses LLM selection when entry count exceeds threshold
 */
export class WorldStateInjector extends BaseAIService {
  private config: WorldStateInjectorConfig

  constructor(
    config: Partial<WorldStateInjectorConfig> = {},
    serviceId: ServiceId = 'worldStateInjection',
  ) {
    super(serviceId)
    this.config = { ...DEFAULT_WORLD_STATE_INJECTOR_CONFIG, ...config }
  }

  /**
   * Build context from world state using tiered injection.
   *
   * Returns world state and nothing else. It used to also take the memory-retrieval output
   * and append it to its own block, which made the injector's result *wrap* retrieval's and
   * so forced it to run after it -- not because world state depends on memory, but because
   * string concatenation dictated the call order. Composing the two blocks is the caller's
   * job now, which is what allows this to move next to retrieval instead of behind it.
   */
  async buildContext(
    worldState: WorldStateInjectorInput,
    userInput: string,
    recentEntries: StoryEntry[],
    signal?: AbortSignal,
    activationTracker?: ActivationTracker,
  ): Promise<WorldStateInjectionResult> {
    const currentPosition = activationTracker?.currentPosition ?? recentEntries.length

    log('buildContext called', {
      characters: worldState.characters.length,
      locations: worldState.locations.length,
      items: worldState.items.length,
      storyBeats: worldState.storyBeats.length,
      userInputLength: userInput.length,
      recentEntriesCount: recentEntries.length,
      hasActivationTracker: !!activationTracker,
    })

    // Tier 1: Always inject - state-based entries, plus recently-mentioned entities
    // still within their stickiness window
    const tier1 = this.getTier1Entries(worldState, activationTracker, currentPosition)
    log('Tier 1 entries:', tier1.length)

    // Get IDs already in tier 1 to avoid duplicates
    const tier1Ids = new Set(tier1.map((e) => e.id))

    // Tier 2: Name matching - fuzzy match against input and recent messages
    const tier2 = this.getTier2Entries(worldState, userInput, recentEntries, tier1Ids)
    log('Tier 2 entries:', tier2.length)

    // Get IDs in tier 1 + 2
    const tier12Ids = new Set([...tier1Ids, ...tier2.map((e) => e.id)])

    // Tier 3: what tiers 1 and 2 left uncovered.
    //
    // `llmThreshold` is an overflow valve, and now actually works like one. It used to gate
    // *whether Tier 3 ran at all*, with nothing below the threshold: a leftover of 5
    // entities was dropped outright while a leftover of 40 got an LLM pass and up to
    // `maxEntriesPerTier` of them injected. That inverted the thing it was meant to protect
    // -- a bigger pool made any given entity *more* likely to reach the narrator, so a small
    // story was served worse than a large one -- and it was backwards on cost too, skipping
    // the cheap calls and paying for the expensive ones.
    //
    // The volume question and the relevance question are now separate:
    //   - small leftover  -> include all of it, no LLM call, nothing dropped
    //   - large leftover  -> too much to include, so ask the model which of it matters
    // The threshold is the boundary between the two, which is what its name says.
    //
    // Not capped by `maxEntriesPerTier` in the wholesale branch: "include what is left over"
    // and "the first N of what is left over" cannot both be true, and there is no ranking
    // signal here to make a cap non-arbitrary. Same reasoning as Tier 1's always-inject
    // entries. The threshold is the ceiling in that branch, by construction.
    let tier3: WorldStateContextEntry[] = []
    const candidates = this.collectRemainingCandidates(worldState, tier12Ids)

    if (candidates.length === 0) {
      // Nothing uncovered.
    } else if (candidates.length <= this.config.llmThreshold) {
      tier3 = candidates.map((candidate) => this.asTier3Entry(candidate))
      log('Tier 3 included wholesale', {
        entries: tier3.length,
        threshold: this.config.llmThreshold,
      })
    } else if (this.config.enableLLMSelection) {
      log('Tier 3 LLM selection triggered', {
        candidates: candidates.length,
        threshold: this.config.llmThreshold,
      })
      tier3 = await this.selectTier3WithLLM(candidates, userInput, recentEntries, signal)
      log('Tier 3 entries:', tier3.length)
    } else {
      // Too many to include, and selection is switched off: there is no third option.
      log('Tier 3 dropped -- over threshold with LLM selection off', {
        candidates: candidates.length,
        threshold: this.config.llmThreshold,
      })
    }

    // Record Tier 2 and Tier 3 activations for stickiness (mirrors EntryRetrievalService).
    //
    // After Tier 3, not between the tiers: an entity the LLM picked is as much "relevant
    // this turn" as one matched by name, and recording only Tier 2 made the expensive
    // signal the shorter-lived one.
    if (activationTracker) {
      for (const entry of [...tier2, ...tier3]) {
        activationTracker.recordActivation(entry.id, currentPosition)
      }
    }

    // Combine all entries, priority-ordered like EntryRetrievalService's equivalent. The
    // block above is built from the tiers rather than from this, but `all` is what
    // `formatAlreadyInContext` reads, and an unordered list there tells the retrieval agent
    // the narrator has a scene-present character and a two-turns-stale one in whatever
    // order the four source arrays happened to be walked.
    const all = [...tier1, ...tier2, ...tier3].sort((a, b) => b.priority - a.priority)

    // Build the context block
    const contextBlock = this.buildContextBlock(tier1, tier2, tier3)

    return { tier1, tier2, tier3, all, contextBlock }
  }

  /**
   * Tier 1: Always inject entries based on current state.
   * - Current location
   * - Present characters (active status)
   * - Inventory items
   * - Active story beats/quests
   *
   * Neither these four nor the sticky carry-over below are capped; the Tier 2 and Tier 3
   * sliders govern only their own tiers. "Always inject" and "the first N of these" cannot
   * both be true, and the Advanced Settings copy promises the former.
   *
   * They used to be sliced, inherited from EntryInjector where the cap was a shared
   * lorebook constant no UI exposed. Once it became a slider the mismatch was reachable: a
   * user narrowing Tier 2/3 noise would have silently dropped characters standing in the
   * scene out of the narrator's prompt, with nothing in the UI suggesting that was on the
   * table.
   */
  private getTier1Entries(
    worldState: WorldStateInjectorInput,
    activationTracker?: ActivationTracker,
    currentPosition?: number,
  ): WorldStateContextEntry[] {
    const entries: WorldStateContextEntry[] = []
    const includedIds = new Set<string>()

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
      includedIds.add(worldState.currentLocation.id)
    }

    // The protagonist, always, in a slot of their own.
    //
    // Tier 1 has always excluded them from the active-characters list below, on the sound
    // reasoning that the player is not an NPC in the scene. Nothing excluded them from
    // Tier 2 or Tier 3 though, so they came back in through name matching or LLM selection
    // and were rendered under [KNOWN CHARACTERS] -- which made the narrator's knowledge of
    // who the player *is* depend on whether their name happened to appear in the last few
    // entries. Observed on a real turn: "• Pento - Human male, 28 years old. Tall, fit."
    // listed among the NPCs, and nowhere else in the prompt describing the protagonist.
    //
    // Including them here fixes both halves at once: the description stops coming and
    // going, and being in Tier 1 excludes them from the tiers that were smuggling them in.
    const protagonist = worldState.characters.find((c) => c.relationship === 'self')
    if (protagonist) {
      entries.push({
        type: 'character',
        id: protagonist.id,
        name: protagonist.name,
        description: protagonist.description,
        tier: 1,
        priority: 95,
        metadata: {
          protagonist: true,
          traits: protagonist.traits,
          visualDescriptors: protagonist.visualDescriptors,
        },
      })
      includedIds.add(protagonist.id)
    }

    // Active characters (excluding protagonist)
    const activeChars = worldState.characters.filter(
      (c) => c.status === 'active' && c.relationship !== 'self',
    )
    for (const char of activeChars) {
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
      includedIds.add(char.id)
    }

    // Inventory items
    const inventoryItems = worldState.items.filter((i) => i.location === 'inventory')
    for (const item of inventoryItems) {
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
      includedIds.add(item.id)
    }

    // Active story beats/quests
    const activeBeats = worldState.storyBeats.filter(
      (b) => b.status === 'active' || b.status === 'pending',
    )
    for (const beat of activeBeats) {
      entries.push({
        type: 'storyBeat',
        id: beat.id,
        name: beat.title,
        description: beat.description,
        tier: 1,
        priority: 80,
        metadata: { type: beat.type, status: beat.status },
      })
      includedIds.add(beat.id)
    }

    // "Sticky" entities: recently activated via Tier 2 (mentioned in the narrative or
    // user input), not already covered above (e.g. a character who just left the scene,
    // or a story beat that just completed) -- stay in Tier 1 for a few more turns with
    // fading priority. Without this, an entity's context disappears from the prompt the
    // instant its "always include" condition (active/current/in-inventory) stops holding,
    // even if it was central to the last turn or two.
    if (activationTracker && currentPosition !== undefined) {
      const stickyCandidates: {
        type: WorldStateContextEntry['type']
        id: string
        name: string
        description: string | null
      }[] = [
        ...worldState.characters.map((c) => ({
          type: 'character' as const,
          id: c.id,
          name: c.name,
          description: c.description,
        })),
        ...worldState.locations.map((l) => ({
          type: 'location' as const,
          id: l.id,
          name: l.name,
          description: l.description,
        })),
        ...worldState.items.map((i) => ({
          type: 'item' as const,
          id: i.id,
          name: i.name,
          description: i.description,
        })),
        ...worldState.storyBeats.map((b) => ({
          type: 'storyBeat' as const,
          id: b.id,
          name: b.title,
          description: b.description,
        })),
      ]

      const sticky: WorldStateContextEntry[] = []

      for (const candidate of stickyCandidates) {
        if (includedIds.has(candidate.id)) continue

        const carried = resolveStickiness(
          activationTracker,
          candidate.id,
          currentPosition,
          WORLD_STATE_STICKINESS_BY_TYPE[candidate.type],
        )
        if (!carried) continue

        sticky.push({
          ...candidate,
          tier: 1,
          priority: carried.priority,
          metadata: { sticky: true, turnsLeft: carried.turnsLeft },
        })
        includedIds.add(candidate.id)
      }

      // Uncapped, matching EntryRetrievalService's sticky entries, and bounded by
      // construction anyway: only what Tier 2 or Tier 3 activated can become sticky, so the
      // tier caps are already the ceiling on what enters this set each turn. Freshest first,
      // so the prompt reads in order of how recently each thing mattered.
      sticky.sort((a, b) => b.priority - a.priority)
      entries.push(...sticky)
    }

    return entries
  }

  /**
   * Tier 2: Name matching against user input and recent entries.
   * Uses fuzzy matching to find references to characters, locations, items.
   */
  private getTier2Entries(
    worldState: WorldStateInjectorInput,
    userInput: string,
    recentEntries: StoryEntry[],
    excludeIds: Set<string>,
  ): WorldStateContextEntry[] {
    const entries: WorldStateContextEntry[] = []

    // Combine user input with recent entry content for matching
    const searchText =
      `${userInput} ${recentContent(recentEntries, this.config.recentEntriesCount, AS_HAYSTACK)}`.toLowerCase()

    // Match characters not in Tier 1
    for (const char of worldState.characters) {
      if (excludeIds.has(char.id)) continue
      if (entityNameMatches(char.name, searchText, { allowPrefix: true })) {
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
      if (entityNameMatches(loc.name, searchText, { allowPrefix: true })) {
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
      if (entityNameMatches(item.name, searchText, { allowPrefix: true })) {
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
      if (entityNameMatches(beat.title, searchText, { allowPrefix: true })) {
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

    // Ranked before capping. Built in type order (characters, then locations, then items,
    // then beats), so slicing that order straight through meant a low cap dropped whole
    // categories -- with maxEntriesPerTier at its minimum of 3, no story beat could ever
    // survive Tier 2, whatever the narrative was about.
    return entries.sort((a, b) => b.priority - a.priority).slice(0, this.config.maxTier2Entries)
  }

  private candidatesOf<T>(
    source: T[],
    excludeIds: Set<string>,
    map: (item: T) => WorldStateCandidate,
  ): WorldStateCandidate[] {
    const out: WorldStateCandidate[] = []
    for (const item of source) {
      const candidate = map(item)
      if (!excludeIds.has(candidate.id)) out.push(candidate)
    }
    return out
  }

  /**
   * Everything tiers 1 and 2 left uncovered, in one list.
   *
   * Replaces a pair of near-identical walks over the same four arrays -- one to count the
   * leftovers, one to collect them -- which had to stay in step for the threshold to mean
   * anything.
   */
  private collectRemainingCandidates(
    worldState: WorldStateInjectorInput,
    excludeIds: Set<string>,
  ): WorldStateCandidate[] {
    return [
      ...this.candidatesOf(worldState.characters, excludeIds, (c) => ({
        type: 'character',
        id: c.id,
        name: c.name,
        description: c.description,
      })),
      ...this.candidatesOf(worldState.locations, excludeIds, (l) => ({
        type: 'location',
        id: l.id,
        name: l.name,
        description: l.description,
      })),
      ...this.candidatesOf(worldState.items, excludeIds, (i) => ({
        type: 'item',
        id: i.id,
        name: i.name,
        description: i.description,
      })),
      ...this.candidatesOf(worldState.storyBeats, excludeIds, (b) => ({
        type: 'storyBeat',
        id: b.id,
        name: b.title,
        description: b.description,
      })),
    ]
  }

  private asTier3Entry(candidate: WorldStateCandidate): WorldStateContextEntry {
    return { ...candidate, tier: 3, priority: 30 }
  }

  /**
   * Ask the LLM which of the leftovers matter. Only reached when there are more of them
   * than `llmThreshold` -- below that they are all included and no call is made.
   */
  private async selectTier3WithLLM(
    candidates: WorldStateCandidate[],
    userInput: string,
    recentEntries: StoryEntry[],
    signal?: AbortSignal,
  ): Promise<WorldStateContextEntry[]> {
    const result = await runTier3Selection({
      candidates,
      userInput,
      recentEntries,
      recentEntriesCount: this.config.recentEntriesCount,
      presetId: this.presetId,
      serviceLabel: 'tier3-world-state-selection',
      signal,
    })
    if (!result) {
      return []
    }

    const entries = resolveTier3Selection(candidates, result).map((c) => this.asTier3Entry(c))

    log('Tier 3 LLM selection complete', {
      candidates: candidates.length,
      selected: entries.length,
      reasoning: result.reasoning,
    })

    // Every Tier 3 entity carries the same priority, so there is nothing here to rank by;
    // the ordering that survives the cap is the model's own, which `resolveTier3Selection`
    // preserves for exactly this reason.
    return entries.slice(0, this.config.maxTier3Entries)
  }

  /**
   * Build the context block string for injection into the system prompt.
   *
   * World state only. Whatever memory retrieval produced is concatenated by the caller --
   * see `buildContext`.
   *
   * The sections split along two axes at once, and conflating them is what went wrong when
   * stickiness was added to Tier 1. `[INVENTORY]` and `[ACTIVE THREADS]` are *claims about
   * current state*; `[RELEVANT ...]` are claims about relevance only. Tier 1 used to
   * contain nothing but the former, so reading "tier 1" as "current state" was safe. It is
   * not any more: a sticky entry is in Tier 1 precisely *because* its state condition
   * stopped holding -- an item that left the inventory, a beat that just completed. Sending
   * those through the state sections told the narrator the protagonist carries an item they
   * dropped and is pursuing a quest they finished.
   *
   * So the state sections take Tier 1 minus the sticky carry-over, and the sticky entries
   * join Tier 2 and Tier 3 in the relevance sections, which is what they are. That also
   * gives sticky locations somewhere to go: they matched neither `metadata.current` nor
   * "tier 2 or 3", so they were rendered nowhere at all -- while still being counted in
   * `all`, and so announced to the retrieval agent, via `formatAlreadyInContext`, as
   * already in a prompt they never reached.
   */
  /**
   * Traits and appearance for one character, in the compact bracketed form the narrator
   * prompt uses. Shared by the protagonist line and the known-characters list so the two
   * cannot drift -- and so the appearance fallback for the pre-object `visualDescriptors`
   * format is maintained once.
   */
  private renderCharacterDetail(char: WorldStateContextEntry): string {
    let out = ''

    const traits = char.metadata?.traits
    if (Array.isArray(traits) && traits.length > 0) {
      out += ` [${traits.join(', ')}]`
    }

    const vd = char.metadata?.visualDescriptors
    if (!vd) return out

    // Handle both old array format and new object format
    if (Array.isArray(vd)) {
      if (vd.length > 0) out += ` {Appearance: ${vd.join(', ')}}`
      return out
    }

    if (typeof vd === 'object') {
      const parts = [
        vd.face,
        vd.hair,
        vd.eyes,
        vd.build,
        vd.clothing,
        vd.accessories,
        vd.distinguishing,
      ].filter(Boolean)
      if (parts.length > 0) out += ` {Appearance: ${parts.join(', ')}}`
    }

    return out
  }

  private buildContextBlock(
    tier1: WorldStateContextEntry[],
    tier2: WorldStateContextEntry[],
    tier3: WorldStateContextEntry[],
  ): string {
    let block = ''

    const isSticky = (e: WorldStateContextEntry) => e.metadata?.sticky === true
    /** Tier 1 entries that still satisfy their state condition. */
    const current = tier1.filter((e) => !isSticky(e))
    /** Everything included for relevance rather than for state, freshest first. */
    const relevant = [...tier1.filter(isSticky), ...tier2, ...tier3]

    // Current location (from Tier 1)
    const currentLoc = tier1.find((e) => e.type === 'location' && e.metadata?.current)
    if (currentLoc) {
      block += `\n\n[CURRENT LOCATION]\n${currentLoc.name}`
      if (currentLoc.description) {
        block += `\n${currentLoc.description}`
      }
    }

    // The protagonist, on their own. Rendered with the same detail as an NPC -- traits and
    // appearance matter more here than anywhere, since image generation and second-person
    // narration both lean on them -- but never in the list of people in the scene.
    const you = tier1.find((e) => e.type === 'character' && e.metadata?.protagonist)
    if (you) {
      block += `\n\n[PROTAGONIST]\n${you.name}`
      if (you.description) block += ` - ${you.description}`
      block += this.renderCharacterDetail(you)
    }

    // Characters (combine from all tiers)
    const allChars = [...tier1, ...tier2, ...tier3].filter(
      (e) => e.type === 'character' && !e.metadata?.protagonist,
    )
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
        block += this.renderCharacterDetail(char)
      }
    }

    // Inventory: state, so Tier 1 minus the sticky carry-over.
    const inventoryItems = current.filter((e) => e.type === 'item')
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

    // Active threads: state, so Tier 1 minus the sticky carry-over. A beat becomes sticky
    // when it stops being active or pending, which is exactly what must not be listed here.
    const activeBeats = current.filter((e) => e.type === 'storyBeat')
    if (activeBeats.length > 0) {
      block += '\n\n[ACTIVE THREADS]'
      for (const beat of activeBeats) {
        block += `\n• ${beat.name}`
        if (beat.description) {
          block += `: ${beat.description}`
        }
      }
    }

    // Mentioned locations: relevance, so sticky Tier 1 belongs here too. Excluding the
    // current one keeps it from being stated twice under two different headings.
    const mentionedLocs = relevant.filter((e) => e.type === 'location' && !e.metadata?.current)
    if (mentionedLocs.length > 0) {
      block += '\n\n[RELEVANT LOCATIONS]'
      for (const loc of mentionedLocs) {
        block += `\n• ${loc.name}`
        if (loc.description) {
          block += `: ${loc.description}`
        }
      }
    }

    // Mentioned items: relevance. Inventory items cannot appear here -- they are in Tier 1
    // un-sticky, and Tier 2/3 exclude every Tier 1 id.
    const mentionedItems = relevant.filter((e) => e.type === 'item')
    if (mentionedItems.length > 0) {
      block += '\n\n[RELEVANT ITEMS]'
      for (const item of mentionedItems) {
        block += `\n• ${item.name}`
        if (item.description) {
          block += `: ${item.description}`
        }
      }
    }

    // Story beats included for relevance rather than for being open.
    const mentionedBeats = relevant.filter((e) => e.type === 'storyBeat')
    if (mentionedBeats.length > 0) {
      block += '\n\n[RELATED STORY THREADS]'
      for (const beat of mentionedBeats) {
        block += `\n• ${beat.name}`
        if (beat.description) {
          block += `: ${beat.description}`
        }
      }
    }

    return block
  }
}
