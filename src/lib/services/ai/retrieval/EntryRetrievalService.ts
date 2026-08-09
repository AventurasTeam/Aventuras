import { settings, type ServiceId } from '$lib/stores/settings.svelte'
/**
 * Entry Retrieval Service for Aventura
 * Per design doc section 3.2.3: Tiered Injection
 *
 * Implements three tiers of entry injection for lorebook entries:
 * - Tier 1: Always inject (injection.mode === 'always', or state-based like isPresent)
 * - Tier 2: Keyword matching (match name/aliases/keywords against user input & recent story)
 * - Tier 3: LLM selection (shared with `WorldStateInjector` via `./tier3Selection.ts`),
 *   on a different trigger: "how much leftover is too much to just include" is a question
 *   about words here and about record count in the injector, whose candidates are one
 *   line each. Neither drops a leftover on the floor.
 *
 * Selects from authored Lorebook `Entry[]` records only. The live-tracked
 * `Character`/`Location`/`Item`/`StoryBeat` state is `WorldStateInjector`'s job and is
 * not duplicated here -- this service used to synthesize `live-*` pseudo-entries for it,
 * which put the same entities in the prompt twice.
 *
 * Runs on every narrator turn, in every Memory Retrieval mode. It used to be skipped in
 * Agentic mode, where the agent selected entries with its own `select_entry` tool and a
 * fallback caught the case where it delivered nothing. That tool is gone: the agent reads
 * lore to reason about chapters but returns none, so entry selection has one owner and
 * there is nothing to skip or fall back to. Sharing `tier3Selection.ts` with
 * `WorldStateInjector` is code reuse, not a shared responsibility.
 */

import { entityNameMatches } from '$lib/utils/text'
import type { Entry, EntryType, StoryEntry } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { createLogger } from '$lib/log'
import { runTier3Selection, resolveTier3Selection, countWholesaleWords } from './tier3Selection'
import { secondPassHaystack } from './tier2SecondPass'
import { resolveStickiness } from './stickiness'
import { ENTRY_RETRIEVAL_DEFAULTS } from '../core/defaults'
import { recentContent, AS_HAYSTACK } from '$lib/utils/recentContent'

const log = createLogger('EntryRetrieval')

/**
 * How long an entry of each type stays in Tier 1 after being activated, in story
 * positions. The fading priority that goes with it is shared with `WorldStateInjector` --
 * see `./stickiness.ts`; only these durations are specific to lorebook entry types.
 *
 * The timer is *not* refreshed while an entry is sticky, and cannot be: a sticky entry is
 * in Tier 1, Tier 1 is excluded from the candidate pool, and only Tier 2/3 record
 * activations. So an entry named in every single turn still drops out when its window
 * expires and is re-matched the turn after. That is deliberate -- it is what stops a
 * once-relevant entry from pinning itself in the prompt forever -- but it means the
 * duration is a hard ceiling on continuous presence, not a sliding one.
 */
export const STICKINESS_BY_TYPE: Record<EntryType, number> = {
  concept: 10, // Magic systems, world rules - foundational context
  faction: 8, // Faction dynamics persist during dealings
  character: 6, // Recently mentioned NPCs stay in context
  location: 6, // Nearby/mentioned locations
  event: 4, // Historical references fade quickly
  item: 6, // Items are situational, but a carried one stays relevant
}

/** The longest window any type can have, on either map. Bounds activation pruning. */
export const MAX_STICKINESS_POSITIONS = 10

/**
 * Section headings for the lorebook context block, in the order they are emitted.
 *
 * Not derived from the type name: the narrator reads "Lore", not "Concepts".
 */
const SECTION_HEADINGS: [EntryType, string][] = [
  ['character', 'Characters'],
  ['location', 'Locations'],
  ['item', 'Items'],
  ['faction', 'Factions'],
  ['concept', 'Lore'],
  ['event', 'Events'],
]

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
  /** Maximum entries to include from Tier 2 (keyword matched) */
  maxTier2Entries: number
  /** Maximum entries to include from Tier 3 (LLM selected) */
  maxTier3Entries: number
  /** Words of leftover that still go in whole, above which the LLM is asked instead */
  tier3WholesaleWordBudget: number
  /** Maximum words per lorebook entry (0 = unlimited) */
  maxWordsPerEntry: number
  /** Enable LLM selection for Tier 3 */
  enableLLMSelection: boolean
  /** Number of recent story entries to check for keyword matching */
  recentEntriesCount: number
  /**
   * Whether the world state's Tier 1 + Tier 2 seed the second Tier 2 pass here.
   *
   * On, lore about something the world state says is in the scene comes in even when
   * nobody named it. Off, Tier 2 sees only what the player wrote and the recent story.
   *
   * Worth a switch because the seed set is not small: the world state's Tier 1 is every
   * active character, every inventory item, every active quest and the current location,
   * and on a mature story that is most of the lorebook's subject matter — so a dense
   * lorebook can spend its whole Tier 2 cap on entries nobody mentioned.
   */
  useSceneEntities: boolean
}

/** Tier 2 priority floors. The author's own `injection.priority` is added on top. */
const TIER2_PRIORITY_BASE = 70
const SECOND_PASS_PRIORITY_BASE = 60

/** One entity already in the scene, as the world state names it. */
export interface SceneEntity {
  type: string
  name: string
}

export interface EntryRetrievalOptions {
  activationTracker?: ActivationTracker
  signal?: AbortSignal
  /** The entry `userInput` came from, so Tier 3 does not see the action twice. */
  userActionEntryId?: string
  /**
   * What the world state put in the scene this turn (its Tier 1 and Tier 2). Widens the
   * Tier 2 haystack, so lore about something present is found even when the player did not
   * name it. Never travels the other way: see the haystack comment in `getRelevantEntries`.
   */
  sceneEntities?: SceneEntity[]
}

export const DEFAULT_ENTRY_RETRIEVAL_CONFIG: EntryRetrievalConfig = {
  // Lower than WorldStateInjector's caps on purpose. A lorebook entry is a paragraph of
  // authored prose; a world-state record is one sentence the classifier rewrote last turn.
  // Matching counts would put roughly ten times as much text in the prompt on this side.
  maxTier2Entries: ENTRY_RETRIEVAL_DEFAULTS.maxTier2Entries,
  maxTier3Entries: ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries,
  tier3WholesaleWordBudget: ENTRY_RETRIEVAL_DEFAULTS.tier3WholesaleWordBudget,
  maxWordsPerEntry: 0,
  enableLLMSelection: true,
  recentEntriesCount: 5,
  useSceneEntities: true,
}

/**
 * Get entry retrieval config from settings store.
 * Falls back to defaults if settings not initialized.
 */
export function getEntryRetrievalConfigFromSettings(): EntryRetrievalConfig {
  const entrySettings = settings.systemServicesSettings.entryRetrieval
  return {
    maxTier2Entries: entrySettings.maxTier2Entries ?? ENTRY_RETRIEVAL_DEFAULTS.maxTier2Entries,
    maxTier3Entries: entrySettings.maxTier3Entries ?? ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries,
    // Not clamped here: the constructor clamps whatever it is handed, so doing it twice
    // meant two copies of the same bounds that had to agree. Passed through as stored --
    // including a non-number from an old settings blob, which `clampMaxWords` handles.
    tier3WholesaleWordBudget:
      entrySettings.tier3WholesaleWordBudget ?? ENTRY_RETRIEVAL_DEFAULTS.tier3WholesaleWordBudget,
    maxWordsPerEntry: entrySettings.maxWordsPerEntry,
    enableLLMSelection: entrySettings.enableLLMSelection ?? true,
    recentEntriesCount: entrySettings.recentEntriesCount ?? 5,
    useSceneEntities: entrySettings.useSceneEntities ?? true,
  }
}

/**
 * `maxWordsPerEntry` as the truncator needs it: a whole number in [0, 500], where 0 means
 * no limit. Applied at construction so every path -- settings, an explicit config, the
 * defaults -- lands on the same bounds.
 */
function clampMaxWords(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(0, Math.floor(n)), 500)
}

export interface RetrievedEntry {
  entry: Entry
  tier: 1 | 2 | 3
  priority: number
  matchReason?: string
  /** Story positions of carry-over left, when Tier 1 carried this over. Two per turn. */
  stickyPositionsLeft?: number
  /** The full window for this entry's type, so the panel can show progress, not just a count. */
  stickyPositionsTotal?: number
  /** Tier 3 only: the model picked this, rather than it fitting under the budget. */
  llmSelected?: boolean
  /** Tier 2 only: matched on the second pass, through something the first pass found. */
  viaScene?: boolean
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

  constructor(config: Partial<EntryRetrievalConfig> = {}, serviceId: ServiceId = 'entryRetrieval') {
    super(serviceId)
    this.config = { ...DEFAULT_ENTRY_RETRIEVAL_CONFIG, ...config }
    this.config.maxWordsPerEntry = clampMaxWords(this.config.maxWordsPerEntry)
  }

  /**
   * Retrieve relevant entries using tiered injection.
   *
   * Tier 1: Always injected - includes:
   *   - Lorebook entries with injection.mode === 'always'
   *   - "Sticky" entries (recently activated via Tier 2/3, duration based on type)
   * Tier 2: Keyword matched (name/aliases/keywords match user input or recent story)
   * Tier 3: LLM selection (see `getLLMSelectedEntries`)
   *
   * Live-tracked characters/locations/items/story beats are handled by
   * `WorldStateInjector` instead -- not duplicated here.
   */
  async getRelevantEntries(
    entries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    options: EntryRetrievalOptions = {},
  ): Promise<EntryRetrievalResult> {
    const { activationTracker, signal, userActionEntryId, sceneEntities } = options
    const currentPosition = activationTracker?.currentPosition ?? recentStoryEntries.length

    log('getRelevantEntries called', {
      totalEntries: entries.length,
      userInputLength: userInput.length,
      recentCount: recentStoryEntries.length,
      currentPosition,
    })

    // The haystack the *first* Tier 2 pass matches against: what the scene actually says.
    //
    // The world state's scene entities are deliberately not in here. They are a second-pass
    // seed instead (see `getTier2Entries`): a lore entry that matched only because a
    // character happens to be standing in the room was not named by anyone, and folding it
    // into this haystack made it indistinguishable from one the player just typed — same
    // priority, same `matched: <name>` reason, and `viaScene` false, so the debug panel's
    // whole point of separating relevance-at-one-remove missed the largest source of it.
    const searchContent = [
      userInput,
      recentContent(recentStoryEntries, this.config.recentEntriesCount, AS_HAYSTACK),
    ]
      .join(' ')
      .toLowerCase()

    // Tier 1: Always-inject + sticky entries
    const tier1 = this.getTier1Entries(entries, activationTracker, currentPosition)
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

    // Tier 2: keyword matching, in two passes. See `getTier2Entries`.
    const tier2 = this.getTier2Entries(candidateEntries, searchContent, sceneEntities)
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

    // Tier 3, volume question first: a leftover cheap enough to send whole is sent whole,
    // and only what is too expensive is worth an LLM call. The boundary is a word budget
    // because a lorebook entry is a paragraph — see `tier3WholesaleWordBudget`.
    let tier3: RetrievedEntry[] = []

    /** Whether Tier 3 got there by being cheap rather than by being chosen. */
    let tier3IsWholesale = false

    const wholesaleWords = countWholesaleWords(remainingEntries, this.config.maxWordsPerEntry)
    const fitsWholesale = wholesaleWords <= this.config.tier3WholesaleWordBudget

    if (remainingEntries.length === 0) {
      // Nothing uncovered.
    } else if (fitsWholesale) {
      tier3IsWholesale = true
      tier3 = remainingEntries.map((entry) => ({
        entry,
        tier: 3,
        priority: 50 + entry.injection.priority,
        matchReason: 'Included wholesale (under word budget)',
        llmSelected: false,
      }))
      log('Tier 3 included wholesale', {
        entries: tier3.length,
        words: wholesaleWords,
        budget: this.config.tier3WholesaleWordBudget,
      })
    } else if (this.config.enableLLMSelection) {
      log('Tier 3 LLM selection triggered', {
        remainingEntries: remainingEntries.length,
        words: wholesaleWords,
      })
      tier3 = await this.getLLMSelectedEntries(
        remainingEntries,
        userInput,
        recentStoryEntries,
        currentPosition,
        signal,
        userActionEntryId,
      )
      log(
        'Tier 3 entries:',
        tier3.length,
        tier3.map((e) => e.entry.name),
      )
    } else {
      // Too much to include, and selection is switched off: there is no third option.
      log('Tier 3 dropped -- over word budget with LLM selection off', {
        remaining: remainingEntries.length,
        words: wholesaleWords,
      })
    }

    // Record activations for stickiness tracking.
    //
    // A *selected* Tier 3 counts as much as Tier 2: both mean "relevant right now", and
    // stickiness exists so that relevance outlives the turn that noticed it. A *wholesale*
    // Tier 3 does not — it means the leftover was small, which says nothing about
    // relevance, and recording it would make the whole uncovered lorebook sticky.
    const activated = tier3IsWholesale ? tier2 : [...tier2, ...tier3]
    if (activationTracker) {
      for (const retrieved of activated) {
        activationTracker.recordActivation(retrieved.entry.id, currentPosition)
      }
      log('Recorded activations for', activated.length, 'entries at position', currentPosition)
    }

    // Combine and sort by priority. The context block is built from this same ordered
    // list rather than re-concatenating the tiers: it used to take them in tier order, so
    // the priority sort reached no prompt and an "always inject" entry could be listed
    // below a sticky one that was two turns from expiring.
    const all = [...tier1, ...tier2, ...tier3].sort((a, b) => b.priority - a.priority)

    // Build context block
    const contextBlock = this.buildContextBlock(all)

    return { tier1, tier2, tier3, all, contextBlock }
  }

  /**
   * Tier 2: Keyword matching.
   * Match entry name, aliases, and keywords against user input and recent story content.
   */
  /**
   * Tier 2, in two passes.
   *
   * The first matches against what the scene *says* — the player's action and the recent
   * story. The second matches whatever is left against *names*: those the first pass found,
   * plus what the world state put in the scene when `useSceneEntities` is on. Both are the
   * same kind of signal — an entry nobody named directly, arriving because something that
   * names it did: the clan entry behind a character who just walked in.
   *
   * Second-pass hits rank below first-pass ones (`SECOND_PASS_PRIORITY_BASE`): they are
   * relevance at one remove, so they are what a cap should drop first.
   */
  private getTier2Entries(
    entries: Entry[],
    searchContent: string,
    sceneEntities?: SceneEntity[],
  ): RetrievedEntry[] {
    const firstPass = this.matchEntries(entries, searchContent, TIER2_PRIORITY_BASE)

    const matchedIds = new Set(firstPass.map((r) => r.entry.id))
    const seeds = secondPassHaystack([
      ...firstPass.flatMap((r) => [r.entry.name, ...(r.entry.aliases ?? [])]),
      // One-way on purpose: lore names never travel back into "who is present", where
      // they would read as entities the narrator can act on.
      ...(this.config.useSceneEntities ? (sceneEntities?.map((e) => e.name) ?? []) : []),
    ])
    const secondPass = seeds
      ? this.matchEntries(
          entries.filter((e) => !matchedIds.has(e.id)),
          seeds,
          SECOND_PASS_PRIORITY_BASE,
        )
      : []

    if (secondPass.length > 0) {
      log(
        'Tier 2 second pass matched',
        secondPass.length,
        secondPass.map((r) => r.entry.name),
      )
    }

    // Ranked before capping, by the priority the *author* gave the entry. Unlike the
    // Tier 3 pool there is a real signal here, so the cap drops what was marked least
    // important rather than whatever the lorebook happened to list last.
    return [...firstPass, ...secondPass]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.maxTier2Entries)
  }

  /** One matching pass. `priorityBase` is what separates a first-pass hit from a second. */
  private matchEntries(
    entries: Entry[],
    searchContent: string,
    priorityBase: number,
  ): RetrievedEntry[] {
    const result: RetrievedEntry[] = []

    for (const entry of entries) {
      const matchedKeywords: string[] = []

      // Check entry name
      if (entityNameMatches(entry.name, searchContent)) {
        matchedKeywords.push(entry.name)
      }

      // Check aliases
      if (entry.aliases) {
        for (const alias of entry.aliases) {
          if (entityNameMatches(alias, searchContent)) {
            matchedKeywords.push(alias)
          }
        }
      }

      // Check injection keywords
      if (entry.injection.keywords) {
        for (const keyword of entry.injection.keywords) {
          if (entityNameMatches(keyword, searchContent)) {
            matchedKeywords.push(keyword)
          }
        }
      }

      if (matchedKeywords.length > 0) {
        const viaScene = priorityBase === SECOND_PASS_PRIORITY_BASE
        result.push({
          entry,
          tier: 2,
          priority: priorityBase + entry.injection.priority,
          matchReason: `matched: ${[...new Set(matchedKeywords)].join(', ')}`,
          viaScene,
        })
      }
    }

    return result
  }

  /**
   * Tier 1: Always inject entries.
   * - Entries with injection.mode === 'always'
   * - Entries with state-based conditions (legacy, for imported lorebooks with state)
   * - "Sticky" entries (recently activated via Tier 2/3, duration based on entry type)
   *
   * Live-tracked characters/locations/items are handled by `WorldStateInjector`
   * instead -- not duplicated here.
   */
  private getTier1Entries(
    entries: Entry[],
    activationTracker?: ActivationTracker,
    currentPosition?: number,
  ): RetrievedEntry[] {
    const result: RetrievedEntry[] = []

    for (const entry of entries) {
      let shouldInclude = false
      let priority = 0
      let reason = ''
      let stickyPositionsLeft: number | undefined
      let stickyPositionsTotal: number | undefined

      // Check injection mode
      if (entry.injection.mode === 'always') {
        shouldInclude = true
        priority = 90
        reason = 'always inject'
      }

      // No state-based Tier 1 here. A lorebook entry's live-state fields — `isPresent`,
      // `isCurrentLocation`, `inInventory`, a faction's standing — were initialized blank
      // by every creation path and written by nothing, so the four conditions that read
      // them never fired: 0 of 16 character entries on a measured 41-chapter save. They
      // were also the wrong owner. Presence is `WorldStateInjector`'s claim to make; a
      // lorebook entry says who someone *is*, and pulling it in because a character is in
      // the room is Tier 2's job, through the scene-entity handover.

      // Check stickiness (recently activated entries stay in Tier 1)
      if (!shouldInclude && activationTracker && currentPosition !== undefined) {
        const sticky = resolveStickiness(
          activationTracker,
          entry.id,
          currentPosition,
          STICKINESS_BY_TYPE[entry.type],
        )
        if (sticky) {
          shouldInclude = true
          priority = Math.max(priority, sticky.priority)
          reason = `sticky (${entry.type}, ${sticky.positionsLeft} positions left)`
          stickyPositionsLeft = sticky.positionsLeft
          stickyPositionsTotal = STICKINESS_BY_TYPE[entry.type]
        }
      }

      if (shouldInclude) {
        result.push({
          entry,
          tier: 1,
          priority,
          matchReason: reason,
          stickyPositionsLeft,
          stickyPositionsTotal,
        })
      }
    }

    return result
  }

  /**
   * Tier 3: LLM-based selection for relevant lorebook entries.
   * Asks the LLM to select the most relevant entries from the candidate pool.
   */
  private async getLLMSelectedEntries(
    availableEntries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    currentPosition: number,
    signal?: AbortSignal,
    userActionEntryId?: string,
  ): Promise<RetrievedEntry[]> {
    if (availableEntries.length === 0) {
      return []
    }

    const candidates = availableEntries.map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      description: e.description,
    }))

    const result = await runTier3Selection({
      candidates,
      userInput,
      recentEntries: recentStoryEntries,
      recentEntriesCount: this.config.recentEntriesCount,
      presetId: this.presetId,
      serviceLabel: 'tier3-lorebook-selection',
      userActionEntryId,
      currentPosition,
      signal,
    })
    if (!result) {
      return []
    }

    const entries: RetrievedEntry[] = resolveTier3Selection(availableEntries, result).map(
      (entry) => ({
        entry,
        tier: 3,
        priority: 50 + entry.injection.priority,
        matchReason: 'LLM selected',
        llmSelected: true,
      }),
    )

    log('Tier 3 LLM selection complete', {
      candidates: availableEntries.length,
      selected: entries.length,
      reasoning: result.reasoning,
    })

    // Ranked first: entries carry an authored injection priority, so capping the model's
    // list without consulting it would drop entries the author marked as important in
    // favour of ones they did not. Ties keep the model's ordering, which
    // `resolveTier3Selection` preserves.
    return [...entries]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.config.maxTier3Entries)
  }

  /**
   * Build context block for prompt injection.
   *
   * `all` is expected priority-ordered; entries are grouped by type for readability and
   * keep that order inside each group.
   */
  private buildContextBlock(all: RetrievedEntry[]): string {
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

    // Section order is the emitted order, and the heading is not always the type name
    // ("concept" reads as "Lore" to the narrator). Six near-identical blocks stood here
    // before, which is six places for a formatting change to be applied five times.
    for (const [type, heading] of SECTION_HEADINGS) {
      const section = byType[type]
      if (section.length === 0) continue

      block += `\n\n• ${heading}:`
      for (const { entry } of section) {
        block += `\n  - ${entry.name}: ${this.truncateEntryText(entry.description)}`
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
  pruneOldActivations(maxStickiness: number = MAX_STICKINESS_POSITIONS): void {
    for (const [entryId, position] of this.activations) {
      if (this.currentPosition - position > maxStickiness) {
        this.activations.delete(entryId)
      }
    }
  }
}
