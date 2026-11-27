import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getEntryRetrievalConfigFromSettings } from '../retrieval/EntryRetrievalService'
import { getWorldStateInjectorConfigFromSettings } from '../generation/WorldStateInjector'

vi.mock('#lib/stores/activity.svelte.ts', () => ({
  activity: {
    startStep: vi.fn(() => ''),
    updateStep: vi.fn(),
    endStep: vi.fn(),
    recordStep: vi.fn(() => ''),
  },
}))

const stored = vi.hoisted(() => ({
  entryRetrieval: {} as Record<string, unknown>,
  worldStateInjection: {} as Record<string, unknown>,
}))

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { systemServicesSettings: stored },
}))

// Every value differs from its shipped default and from its neighbours, so a swapped or
// dropped field cannot pass by coincidence. The extra keys are what the store block holds
// beyond the config: they must not come through.
beforeEach(() => {
  stored.entryRetrieval = {
    profileId: 'p',
    model: 'm',
    temperature: 0.9,
    maxTier2Entries: 7,
    maxTier3Entries: 11,
    tier3WholesaleWordBudget: 333,
    maxWordsPerEntry: 77,
    enableLLMSelection: false,
    useSceneEntities: false,
    recentEntriesCount: 9,
  }
  stored.worldStateInjection = {
    tier3WholesaleWordBudget: 222,
    maxTier2Entries: 6,
    maxTier3Entries: 8,
    enableLLMSelection: false,
    recentEntriesCount: 4,
  }
})

describe('getEntryRetrievalConfigFromSettings', () => {
  it('maps every stored field to its config key and nothing else', () => {
    expect(getEntryRetrievalConfigFromSettings()).toEqual({
      maxTier2Entries: 7,
      maxTier3Entries: 11,
      tier3WholesaleWordBudget: 333,
      maxWordsPerEntry: 77,
      enableLLMSelection: false,
      recentEntriesCount: 9,
      useSceneEntities: false,
    })
  })

  it('passes maxWordsPerEntry through unclamped, even when it is not a number', () => {
    // The constructor clamps it (`clampMaxWords`); doing it here too would be a second copy
    // of the bounds.
    stored.entryRetrieval.maxWordsPerEntry = 9999
    expect(getEntryRetrievalConfigFromSettings().maxWordsPerEntry).toBe(9999)

    stored.entryRetrieval.maxWordsPerEntry = 'many'
    expect(getEntryRetrievalConfigFromSettings().maxWordsPerEntry).toBe('many')
  })
})

describe('getWorldStateInjectorConfigFromSettings', () => {
  it('maps every stored field to its config key', () => {
    expect(getWorldStateInjectorConfigFromSettings()).toEqual({
      tier3WholesaleWordBudget: 222,
      maxTier2Entries: 6,
      maxTier3Entries: 8,
      enableLLMSelection: false,
      recentEntriesCount: 4,
    })
  })
})
