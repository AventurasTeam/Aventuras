/**
 * World State Mapper
 *
 * Pure transformation function that converts the EntryInjector's ContextResult
 * tier arrays into section-mapped typed arrays suitable for Liquid template variables.
 *
 * This is the data layer bridge between the AI retrieval pipeline (EntryInjector)
 * and the template context builder (ContextBuilder).
 */

import type { ContextResult } from '$lib/services/ai/generation/EntryInjector'
import type {
  ContextCharacter,
  ContextItem,
  ContextStoryBeat,
  ContextLocation,
} from './context-types'
import { normalizeAppearance } from './context-utils'

export { normalizeAppearance }

/**
 * All world state arrays produced by mapContextResultToArrays().
 * These map directly to the Liquid template variables injected by the context pipeline.
 */
export interface WorldStateArrays {
  /** All characters from all tiers, ordered by tier then priority */
  worldStateCharacters: ContextCharacter[]
  /** Tier-1 items (player inventory) — no tier field */
  worldStateInventory: ContextItem[]
  /** Tier-2/3 items (contextually relevant, not held) — includes tier field */
  worldStateRelevantItems: ContextItem[]
  /** Tier-1 story beats (active threads) — no tier field */
  worldStateBeats: ContextStoryBeat[]
  /** Tier-2/3 story beats (related threads) — includes tier field */
  worldStateRelatedBeats: ContextStoryBeat[]
  /** Tier-2/3 non-current locations */
  worldStateLocations: ContextLocation[]
  /** Current location as a flat object, or null if none in tier-1 */
  currentLocationObject: { name: string; description: string } | null
}

/**
 * Map a ContextResult (tier arrays from EntryInjector) into the six section-mapped
 * arrays and currentLocationObject that the template context expects.
 *
 * Mapping logic mirrors buildContextBlock() in EntryInjector.ts:
 * - currentLocationObject: tier-1 location with metadata.current=true
 * - worldStateCharacters:  all tiers, type=character
 * - worldStateInventory:   tier-1, type=item (no tier field)
 * - worldStateRelevantItems: tier-2+3, type=item (includes tier field)
 * - worldStateBeats:       tier-1, type=storyBeat (no tier field)
 * - worldStateRelatedBeats: tier-2+3, type=storyBeat (includes tier field)
 * - worldStateLocations:   tier-2+3, type=location, not current
 *
 * @param result - Output from EntryInjector.buildContext()
 * @returns WorldStateArrays bag ready for template context injection
 */
export function mapContextResultToArrays(result: ContextResult): WorldStateArrays {
  const { tier1, tier2, tier3 } = result
  const tier23 = [...tier2, ...tier3]

  // Current location: tier-1 location flagged as current
  const currentLocEntry = tier1.find((e) => e.type === 'location' && e.metadata?.current)
  const currentLocationObject =
    currentLocEntry !== undefined
      ? ({
          name: currentLocEntry.name,
          description: currentLocEntry.description ?? '',
        } satisfies { name: string; description: string })
      : null

  // Characters: all tiers, ordered tier1 → tier2 → tier3
  const allCharEntries = [...tier1, ...tier2, ...tier3].filter((e) => e.type === 'character')
  const worldStateCharacters: ContextCharacter[] = allCharEntries.map(
    (e) =>
      ({
        name: e.name,
        relationship: String(e.metadata?.relationship ?? ''),
        description: e.description ?? '',
        traits: Array.isArray(e.metadata?.traits)
          ? (e.metadata.traits as unknown[]).filter(Boolean).map(String)
          : [],
        appearance: normalizeAppearance(e.metadata?.visualDescriptors),
        tier: e.tier,
        // Only active characters appear in tier results — status metadata not carried by RelevantEntry
        status: 'active',
      }) satisfies ContextCharacter,
  )

  // Tier-1 items → inventory (no tier field)
  const worldStateInventory: ContextItem[] = tier1
    .filter((e) => e.type === 'item')
    .map(
      (e) =>
        ({
          name: e.name,
          description: e.description ?? '',
          quantity: typeof e.metadata?.quantity === 'number' ? e.metadata.quantity : 1,
          equipped: Boolean(e.metadata?.equipped),
        }) satisfies ContextItem,
    )

  // Tier-2/3 items → relevant items (include tier field)
  const worldStateRelevantItems: ContextItem[] = tier23
    .filter((e) => e.type === 'item')
    .map(
      (e) =>
        ({
          name: e.name,
          description: e.description ?? '',
          quantity: typeof e.metadata?.quantity === 'number' ? e.metadata.quantity : 1,
          equipped: Boolean(e.metadata?.equipped),
          tier: e.tier,
        }) satisfies ContextItem,
    )

  // Tier-1 story beats → active beats (no tier field)
  const worldStateBeats: ContextStoryBeat[] = tier1
    .filter((e) => e.type === 'storyBeat')
    .map(
      (e) =>
        ({
          title: e.name,
          description: e.description ?? '',
          type: e.metadata?.type ?? '',
          status: e.metadata?.status ?? 'active',
        }) satisfies ContextStoryBeat,
    )

  // Tier-2/3 story beats → related beats (include tier field)
  const worldStateRelatedBeats: ContextStoryBeat[] = tier23
    .filter((e) => e.type === 'storyBeat')
    .map(
      (e) =>
        ({
          title: e.name,
          description: e.description ?? '',
          type: e.metadata?.type ?? '',
          status: e.metadata?.status ?? 'active',
          tier: e.tier,
        }) satisfies ContextStoryBeat,
    )

  // Tier-2/3 locations, excluding current
  const worldStateLocations: ContextLocation[] = tier23
    .filter((e) => e.type === 'location' && !e.metadata?.current)
    .map(
      (e) =>
        ({
          name: e.name,
          description: e.description ?? '',
          visited: Boolean(e.metadata?.visited),
          tier: e.tier,
        }) satisfies ContextLocation,
    )

  return {
    worldStateCharacters,
    worldStateInventory,
    worldStateRelevantItems,
    worldStateBeats,
    worldStateRelatedBeats,
    worldStateLocations,
    currentLocationObject,
  }
}
