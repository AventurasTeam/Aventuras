/**
 * Settings Migrations
 *
 * Reshaping settings that were persisted by an older version of the app, on the way from
 * disk into the store.
 *
 * Kept out of `settings.svelte.ts` so it can be tested: that file is a rune-based store,
 * and the test runner deliberately omits the Svelte plugin (see `vitest.config.ts`), so
 * nothing in it can be imported by a test. Migrations are the worst possible thing to leave
 * untested -- they run once, unattended, over data the user cannot get back.
 *
 * Written against the *shape* each migration reads rather than the full settings
 * interfaces, so this module does not import the store it feeds. Generic in the merged
 * settings object, so callers get their own type back rather than a widened one.
 *
 * Two properties every migration here has to hold:
 *
 * - **Idempotent.** Nothing removes the legacy keys from the stored blob, so these run on
 *   every load, not just the first one after an upgrade. A migration that keeps firing
 *   after the user has since changed the new setting silently reverts them.
 * - **Silent about untouched values.** A stored value equal to the old default was never a
 *   choice; carrying it across would pin everyone who never opened the panel to a number
 *   that is no longer the default.
 */

import { parseImageSpec, type ImageSpec } from '$lib/utils/image'
import { ENTRY_RETRIEVAL_DEFAULTS } from '$lib/services/ai/core/defaults'
import { REASONING_LEVELS } from '$lib/services/ai/core/reasoning'
import type { ReasoningEffort } from '$lib/types'

/** Default of the removed `maxEntriesPerTier` slider, for telling tuned from untouched. */
const LEGACY_MAX_ENTRIES_PER_TIER = 20

/** The world-state injection keys these migrations read, as they may appear on disk. */
export interface StoredWorldStateInjection {
  /** Removed. Capped Tier 2, Tier 3 and Tier 1's sticky carry-over at once. */
  maxEntriesPerTier?: number
  maxTier2Entries?: number
  maxTier3Entries?: number
}

/**
 * `maxEntriesPerTier` became two sliders with different defaults, so a stored value cannot
 * simply be copied into both: that would pin everyone who never touched it to the old
 * number instead of the new ones.
 *
 * Applies only when the new keys are absent. Once they exist the legacy value is stale, and
 * re-applying it on the next load would undo whatever the user set in between -- the stored
 * blob keeps `maxEntriesPerTier` forever, so this function sees it forever.
 */
export function migrateWorldStateInjection<
  T extends { maxTier2Entries: number; maxTier3Entries: number },
>(loaded: StoredWorldStateInjection | undefined, merged: T): T {
  if (loaded?.maxTier2Entries !== undefined || loaded?.maxTier3Entries !== undefined) {
    return merged
  }

  const legacy = loaded?.maxEntriesPerTier
  if (typeof legacy !== 'number' || !Number.isFinite(legacy)) return merged
  if (legacy === LEGACY_MAX_ENTRIES_PER_TIER) return merged

  return { ...merged, maxTier2Entries: legacy, maxTier3Entries: legacy }
}

/**
 * `maxTier3Entries` used to treat 0 as "unlimited", and 0 was also its default. The slider
 * no longer offers unlimited and starts at 5, so a stored 0 has to become a real number --
 * and the only honest reading of "no limit" is the most generous value on the new scale,
 * not the tightest.
 *
 * Idempotent because the value it writes is above zero, so a second pass leaves it alone.
 */
export function migrateEntryRetrieval<T extends { maxTier3Entries: number }>(merged: T): T {
  if (merged.maxTier3Entries > 0) return merged
  return { ...merged, maxTier3Entries: ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries }
}

/**
 * Image sizes used to be `WIDTHxHEIGHT` strings and are now `ImageSpec` objects.
 *
 * `parseImageSpec` reads both, so this only normalises what is already on disk into the
 * shape the rest of the app expects. Idempotent: a spec parses back to itself.
 */
export function migrateImageGeneration<
  T extends {
    size: ImageSpec | string
    referenceSize: ImageSpec | string
    portraitSize: ImageSpec | string
    backgroundSize: ImageSpec | string
  },
>(merged: T): T {
  return {
    ...merged,
    size: parseImageSpec(merged.size),
    referenceSize: parseImageSpec(merged.referenceSize),
    portraitSize: parseImageSpec(merged.portraitSize),
    backgroundSize: parseImageSpec(merged.backgroundSize),
  }
}

/**
 * `llmThreshold` counted world-state *records*; the control that replaced it counts
 * *words*, the same unit Entry Retrieval already used.
 *
 * The stored number is dropped rather than converted: 30 records and 500 words describe the
 * same boundary only because a record happens to average ~16 words, and someone who raised
 * the count to 100 was not asking for 1600 words of anything. The new default is calibrated
 * to do what the old default did, which is a better answer than a guessed conversion.
 *
 * Dropping the key matters beyond tidiness: the store merges what is on disk over the
 * defaults, so an unread key would be written back into every future save.
 */
export function migrateWorldStateBudget<T extends { tier3WholesaleWordBudget: number }>(
  merged: T & { llmThreshold?: number },
): T {
  if (!('llmThreshold' in merged)) return merged
  const { llmThreshold: _dropped, ...rest } = merged
  return rest as T
}

// ============================================================================
// Reasoning effort
// ============================================================================

/**
 * What 'none' was called on disk before the reasoning levels were aligned with the AI SDK's
 * own names (0.7.x). This is the only place in the codebase allowed to know the old spelling:
 * everywhere else the disabled level is 'none'.
 *
 * It cannot simply be dropped. Anyone who upgrades from an older install has the literal
 * string on disk, and refusing to recognise it would silently discard their setting -- and
 * fall back to the legacy `enableThinking` flag, which means 'high'.
 */
const LEGACY_REASONING_OFF = 'off'

/**
 * A stored reasoning level, or `undefined` when there is nothing usable to read -- which the
 * caller must treat as "no stored choice", not as "off".
 *
 * Validated against the *current* `REASONING_LEVELS` rather than a list of its own: what this
 * returns is assigned straight to a `ReasoningEffort`, so a level the app no longer has is not
 * a value it may hand back. That is what drops 'max', which existed only briefly.
 */
export function migrateReasoningEffort(value?: string | null): ReasoningEffort | undefined {
  if (!value) return undefined
  if (value === LEGACY_REASONING_OFF) return 'none'
  return (REASONING_LEVELS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : undefined
}

/**
 * The same migration across a record of objects that each carry a `reasoningEffort` -- the
 * generation presets, the wizard settings and the system-service settings are all stored that
 * way. Objects without a readable level are left exactly as they are.
 */
export function migrateReasoningIn<T>(stored: T): T {
  if (!stored || typeof stored !== 'object') return stored

  for (const value of Object.values(stored)) {
    if (!value || typeof value !== 'object') continue
    const holder = value as { reasoningEffort?: unknown }
    if (typeof holder.reasoningEffort !== 'string') continue
    const migrated = migrateReasoningEffort(holder.reasoningEffort)
    if (migrated !== undefined) holder.reasoningEffort = migrated
  }

  return stored
}

/** Default of the renamed key, for telling a tuned value from an untouched one. */
const LEGACY_RECENT_ENTRIES_FOR_RETRIEVAL = 5

/** The context-window keys this migration reads, as they may appear on disk. */
export interface StoredContextWindow {
  /**
   * Renamed to `recentEntriesForSuggestions`. It named retrieval and drove neither
   * retrieval service — `SuggestionsService` was always its only consumer.
   */
  recentEntriesForRetrieval?: number
  recentEntriesForSuggestions?: number
}

/**
 * Carry a tuned `recentEntriesForRetrieval` onto its honest name.
 *
 * Only a value the user actually moved: one equal to the old default was never a choice,
 * and carrying it would pin whoever never opened the panel to a number that may change.
 * Idempotent because it only fires while the new key still holds its own default.
 */
export function migrateContextWindow<T extends { recentEntriesForSuggestions: number }>(
  merged: T & StoredContextWindow,
): T {
  const legacy = merged.recentEntriesForRetrieval
  if (
    typeof legacy === 'number' &&
    legacy !== LEGACY_RECENT_ENTRIES_FOR_RETRIEVAL &&
    merged.recentEntriesForSuggestions === LEGACY_RECENT_ENTRIES_FOR_RETRIEVAL
  ) {
    return { ...merged, recentEntriesForSuggestions: legacy }
  }
  return merged
}
