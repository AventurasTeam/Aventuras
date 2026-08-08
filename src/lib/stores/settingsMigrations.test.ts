import { describe, it, expect } from 'vitest'
import {
  migrateEntryRetrieval,
  migrateImageGeneration,
  migrateWorldStateBudget,
  migrateWorldStateInjection,
} from './settingsMigrations'
import {
  ENTRY_RETRIEVAL_DEFAULTS,
  WORLD_STATE_INJECTION_DEFAULTS,
} from '$lib/services/ai/core/defaults'

interface MergedWorldState {
  tier3WholesaleWordBudget: number
  maxTier2Entries: number
  maxTier3Entries: number
  enableLLMSelection: boolean
  recentEntriesCount: number
}

/**
 * What the store hands the migration: defaults with whatever was on disk spread over them.
 * Typed explicitly because the defaults are `as const`, so an inferred literal type would
 * reject a test that changes one.
 */
const merged = (
  over: Partial<{ maxTier2Entries: number; maxTier3Entries: number }> = {},
): MergedWorldState => ({
  tier3WholesaleWordBudget: WORLD_STATE_INJECTION_DEFAULTS.tier3WholesaleWordBudget,
  maxTier2Entries: WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries,
  maxTier3Entries: WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries,
  enableLLMSelection: true,
  recentEntriesCount: 5,
  ...over,
})

describe('migrateWorldStateInjection', () => {
  it('leaves settings alone when nothing was stored', () => {
    // Fresh install: no disk data at all, defaults stand.
    expect(migrateWorldStateInjection(undefined, merged())).toEqual(merged())
  })

  it('carries a deliberately tuned legacy cap into both new ones', () => {
    const result = migrateWorldStateInjection({ maxEntriesPerTier: 7 }, merged())

    expect(result.maxTier2Entries).toBe(7)
    expect(result.maxTier3Entries).toBe(7)
  })

  it('ignores a legacy cap left at its old default', () => {
    // 20 was the shipped value, so it was never a choice. Carrying it would pin everyone
    // who never opened the panel to a number that is no longer the default.
    const result = migrateWorldStateInjection({ maxEntriesPerTier: 20 }, merged())

    expect(result.maxTier2Entries).toBe(WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries)
    expect(result.maxTier3Entries).toBe(WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries)
  })

  it('preserves every other setting it does not migrate', () => {
    const source = merged()
    source.tier3WholesaleWordBudget = 900
    source.recentEntriesCount = 12

    const result = migrateWorldStateInjection({ maxEntriesPerTier: 7 }, source)

    expect(result.tier3WholesaleWordBudget).toBe(900)
    expect(result.recentEntriesCount).toBe(12)
    expect(result.enableLLMSelection).toBe(true)
  })

  describe('idempotence', () => {
    // Nothing strips `maxEntriesPerTier` from the stored blob, so this migration sees it
    // on every load, forever -- not just the first one after the upgrade.

    it('does not re-apply once the new keys exist', () => {
      // The failure this guards: upgrade migrates 7 -> both caps; the user then raises
      // Tier 2 to 30 and it is saved alongside the still-present legacy key; the next
      // load silently puts it back to 7.
      const stored = { maxEntriesPerTier: 7, maxTier2Entries: 30, maxTier3Entries: 50 }

      const result = migrateWorldStateInjection(stored, merged(stored))

      expect(result.maxTier2Entries).toBe(30)
      expect(result.maxTier3Entries).toBe(50)
    })

    it('stops migrating even if only one new key was written', () => {
      const stored = { maxEntriesPerTier: 7, maxTier2Entries: 30 }

      const result = migrateWorldStateInjection(stored, merged(stored))

      expect(result.maxTier2Entries).toBe(30)
      expect(result.maxTier3Entries).toBe(WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries)
    })

    it('is stable across repeated runs', () => {
      const stored = { maxEntriesPerTier: 7 }
      const once = migrateWorldStateInjection(stored, merged())
      const twice = migrateWorldStateInjection(stored, once)

      expect(twice).toEqual(once)
    })
  })

  describe('malformed stored data', () => {
    // This is persisted JSON from an arbitrarily old version; the type system never saw it.

    it.each([
      ['a string', '7'],
      ['null', null],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('ignores %s', (_label, value) => {
      const result = migrateWorldStateInjection(
        { maxEntriesPerTier: value as unknown as number },
        merged(),
      )

      expect(result.maxTier2Entries).toBe(WORLD_STATE_INJECTION_DEFAULTS.maxTier2Entries)
      expect(result.maxTier3Entries).toBe(WORLD_STATE_INJECTION_DEFAULTS.maxTier3Entries)
    })
  })
})

describe('migrateEntryRetrieval', () => {
  it('turns the old "unlimited" into the most generous value on the new scale', () => {
    // 0 meant unlimited *and* was the default, so nearly every install has it. Reading it
    // as a literal cap of zero would leave Tier 3 empty for all of them.
    const result = migrateEntryRetrieval({ maxTier3Entries: 0, maxWordsPerEntry: 0 })

    expect(result.maxTier3Entries).toBe(ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries)
  })

  it('leaves a real cap alone', () => {
    expect(migrateEntryRetrieval({ maxTier3Entries: 15 }).maxTier3Entries).toBe(15)
  })

  it('preserves the other settings', () => {
    const result = migrateEntryRetrieval({ maxTier3Entries: 0, maxWordsPerEntry: 200 })

    expect(result.maxWordsPerEntry).toBe(200)
  })

  it('is idempotent', () => {
    const once = migrateEntryRetrieval({ maxTier3Entries: 0 })
    const twice = migrateEntryRetrieval(once)

    expect(twice).toEqual(once)
  })

  it('repairs a negative value rather than passing it through', () => {
    expect(migrateEntryRetrieval({ maxTier3Entries: -5 }).maxTier3Entries).toBe(
      ENTRY_RETRIEVAL_DEFAULTS.maxTier3Entries,
    )
  })
})

describe('migrateImageGeneration', () => {
  const legacy = {
    size: '1024x1024',
    referenceSize: '1024x1024',
    portraitSize: '512x512',
    backgroundSize: '1280x720',
  }

  it('turns the WIDTHxHEIGHT strings older builds stored into specs', () => {
    expect(migrateImageGeneration(legacy)).toEqual({
      size: { orientation: 'square', size: 'small' },
      referenceSize: { orientation: 'square', size: 'small' },
      portraitSize: { orientation: 'square', size: 'tiny' },
      backgroundSize: { orientation: 'landscape', size: 'small' },
    })
  })

  it('is idempotent', () => {
    const once = migrateImageGeneration(legacy)
    expect(migrateImageGeneration(once)).toEqual(once)
  })

  it('preserves the other settings', () => {
    expect(migrateImageGeneration({ ...legacy, backgroundBlur: 2 }).backgroundBlur).toBe(2)
  })
})

describe('migrateWorldStateBudget', () => {
  it('drops the record-count threshold the word budget replaced', () => {
    // Not converted: 30 records and 500 words coincide only because a record averages ~16
    // words, so a raised count would translate into a number nobody asked for.
    const result = migrateWorldStateBudget({
      tier3WholesaleWordBudget: WORLD_STATE_INJECTION_DEFAULTS.tier3WholesaleWordBudget,
      llmThreshold: 100,
    })

    expect(result).not.toHaveProperty('llmThreshold')
    expect(result.tier3WholesaleWordBudget).toBe(
      WORLD_STATE_INJECTION_DEFAULTS.tier3WholesaleWordBudget,
    )
  })

  it('leaves a settings object that never had one alone', () => {
    const clean = { tier3WholesaleWordBudget: 700, maxTier2Entries: 40 }

    expect(migrateWorldStateBudget(clean)).toBe(clean)
  })

  it('is idempotent', () => {
    const once = migrateWorldStateBudget({ tier3WholesaleWordBudget: 500, llmThreshold: 30 })

    expect(migrateWorldStateBudget(once)).toEqual(once)
  })
})
