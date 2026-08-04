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

import { ENTRY_RETRIEVAL_DEFAULTS } from '$lib/services/ai/core/defaults'

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
