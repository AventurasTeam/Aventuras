import { describe, expect, it } from 'vitest'

import type { ModelProfile, ProviderInstance, StorySettings } from '@/lib/db'

import {
  appendedCustomModelIds,
  availableAgents,
  describeChain,
  modelsDirtyTargets,
  overrideProviderMissing,
  providerFavorites,
  providerListsModel,
  providerSources,
  toggledFavoriteIds,
} from './models-panel-state'

const PROVIDER: ProviderInstance = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: '',
  favoriteModelIds: ['m-fav'],
  cachedModels: [{ id: 'm-narr', capabilities: { structuredOutput: true } }, { id: 'm-fav' }],
  customModelIds: ['m-custom'],
}
const NARRATIVE: ModelProfile = {
  id: 'prof-narr',
  kind: 'narrative',
  name: 'Storyteller',
  modelRef: { providerId: 'prov-1', modelId: 'm-narr' },
}
const CONFIG = { providers: [PROVIDER], profiles: [NARRATIVE], assignments: {} }

describe('describeChain', () => {
  it('names the resolved model and profile for narrative', () => {
    expect(describeChain('narrative', CONFIG)).toEqual({
      kind: 'resolved',
      modelId: 'm-narr',
      profileName: 'Storyteller',
    })
  })

  it('names the profile the chain landed on, not the first plausible one', () => {
    const decoy: ModelProfile = {
      id: 'prof-decoy',
      kind: 'agent',
      name: 'Decoy',
      modelRef: { providerId: 'prov-1', modelId: 'm-fast' },
    }
    const fast: ModelProfile = { ...decoy, id: 'prof-fast', name: 'Fast tasks' }
    expect(
      describeChain('classifier', {
        ...CONFIG,
        profiles: [NARRATIVE, decoy, fast],
        assignments: { classifier: 'prof-fast' },
      }),
    ).toEqual({ kind: 'resolved', modelId: 'm-fast', profileName: 'Fast tasks' })
  })

  it('reports the failure kind when the chain is broken', () => {
    expect(describeChain('classifier', CONFIG)).toEqual({
      kind: 'broken',
      failure: 'no-profile-assigned',
    })
  })

  it('passes every broken-chain kind through', () => {
    expect(
      describeChain('classifier', { ...CONFIG, assignments: { classifier: 'prof-deleted' } }),
    ).toEqual({ kind: 'broken', failure: 'profile-missing' })
    expect(describeChain('narrative', { ...CONFIG, providers: [] })).toEqual({
      kind: 'broken',
      failure: 'provider-missing',
    })
  })

  it('ignores story overrides — the sentinel describes the chain beneath them', () => {
    expect(
      describeChain('narrative', {
        ...CONFIG,
        storyModels: { narrative: { providerId: 'prov-1', modelId: 'other' } },
      }),
    ).toEqual({ kind: 'resolved', modelId: 'm-narr', profileName: 'Storyteller' })
  })
})

describe('providerSources', () => {
  it('lists cached and custom ids per provider with capability flags mapped', () => {
    expect(providerSources([PROVIDER])).toEqual([
      {
        id: 'prov-1',
        name: 'Local',
        models: [
          { id: 'm-narr', capabilities: { structured: true } },
          { id: 'm-fav', capabilities: undefined },
          { id: 'm-custom', capabilities: undefined },
        ],
      },
    ])
  })

  it('lists a model once when a refreshed catalog also carries a custom id', () => {
    const refreshed: ProviderInstance = {
      ...PROVIDER,
      cachedModels: [{ id: 'm-narr', capabilities: { reasoning: true } }],
      customModelIds: ['m-narr', 'm-custom', 'm-custom'],
    }
    expect(providerSources([refreshed])[0]?.models).toEqual([
      { id: 'm-narr', capabilities: { reasoning: true } },
      { id: 'm-custom', capabilities: undefined },
    ])
  })

  it('tolerates a provider with no catalog and no custom ids', () => {
    const bare: ProviderInstance = {
      id: 'prov-2',
      type: 'openai',
      displayName: 'Bare',
      apiKey: '',
      favoriteModelIds: [],
    }
    expect(providerSources([bare])).toEqual([{ id: 'prov-2', name: 'Bare', models: [] }])
  })

  it('collects favorites as refs', () => {
    expect(providerFavorites([PROVIDER])).toEqual([{ providerId: 'prov-1', modelId: 'm-fav' }])
  })
})

describe('providerListsModel', () => {
  it('finds an id in the catalog', () => {
    expect(providerListsModel(PROVIDER, 'm-narr')).toBe(true)
  })

  it('finds an id among the custom ids', () => {
    expect(providerListsModel(PROVIDER, 'm-custom')).toBe(true)
  })

  it('misses an id the provider does not list', () => {
    expect(providerListsModel(PROVIDER, 'm-new')).toBe(false)
  })

  it('tolerates a provider with no catalog and no custom ids', () => {
    const bare: ProviderInstance = {
      id: 'prov-2',
      type: 'openai',
      displayName: 'Bare',
      apiKey: '',
      favoriteModelIds: [],
    }
    expect(providerListsModel(bare, 'm-narr')).toBe(false)
  })
})

describe('override bookkeeping', () => {
  const stored: StorySettings['models'] = {
    narrative: { providerId: 'prov-1', modelId: 'a' },
  }

  it('flags an override whose provider is gone', () => {
    expect(overrideProviderMissing({ providerId: 'gone', modelId: 'a' }, [PROVIDER])).toBe(true)
    expect(overrideProviderMissing({ providerId: 'prov-1', modelId: 'a' }, [PROVIDER])).toBe(false)
  })

  it('reports changed targets in rail order', () => {
    expect(
      modelsDirtyTargets({ classifier: { providerId: 'prov-1', modelId: 'c' } }, stored),
    ).toEqual(['narrative', 'classifier'])
    expect(modelsDirtyTargets({ ...stored }, stored)).toEqual([])
    expect(
      modelsDirtyTargets({ narrative: { providerId: 'prov-1', modelId: 'b' } }, stored),
    ).toEqual(['narrative'])
  })

  it('reads a re-pick of the stored model clean — refs compare by value', () => {
    expect(
      modelsDirtyTargets({ narrative: { providerId: 'prov-1', modelId: 'a' } }, stored),
    ).toEqual([])
  })

  it('treats the same model id on another provider as a change', () => {
    expect(
      modelsDirtyTargets({ narrative: { providerId: 'prov-2', modelId: 'a' } }, stored),
    ).toEqual(['narrative'])
  })

  it('offers only the story agents without an override or a pending row', () => {
    expect(
      availableAgents({ classifier: { providerId: 'p', modelId: 'm' } }, ['retrieval']),
    ).toEqual(['translation', 'suggestion', 'lore-mgmt'])
  })
})

// Both lists are provider-level, and the panel writes the whole array back, so a
// helper that forgets the rest silently drops ids the user added elsewhere.
describe('toggledFavoriteIds', () => {
  it('adds a model that is not yet a favorite, keeping the existing ones', () => {
    const provider = { favoriteModelIds: ['m-fav', 'm-other'] }
    expect(toggledFavoriteIds(provider, 'm-narr')).toEqual(['m-fav', 'm-other', 'm-narr'])
  })

  it('removes a model that is already a favorite, keeping the existing ones', () => {
    const provider = { favoriteModelIds: ['m-fav', 'm-other'] }
    expect(toggledFavoriteIds(provider, 'm-fav')).toEqual(['m-other'])
  })

  it('round-trips back to the original set', () => {
    const provider = { favoriteModelIds: ['a', 'b'] }
    const once = toggledFavoriteIds(provider, 'c')
    expect(toggledFavoriteIds({ favoriteModelIds: once }, 'c')).toEqual(['a', 'b'])
  })

  it('never duplicates an id already present', () => {
    expect(toggledFavoriteIds({ favoriteModelIds: ['a'] }, 'a')).toEqual([])
    expect(toggledFavoriteIds({ favoriteModelIds: [] }, 'a')).toEqual(['a'])
  })

  it('leaves the provider array untouched', () => {
    const favoriteModelIds = ['a']
    toggledFavoriteIds({ favoriteModelIds }, 'b')
    expect(favoriteModelIds).toEqual(['a'])
  })
})

describe('appendedCustomModelIds', () => {
  it("appends after the provider's existing custom ids", () => {
    const provider = { customModelIds: ['m-custom', 'm-second'] }
    expect(appendedCustomModelIds(provider, 'm-new')).toEqual(['m-custom', 'm-second', 'm-new'])
  })

  it('treats an absent list as empty rather than throwing', () => {
    expect(appendedCustomModelIds({}, 'm-new')).toEqual(['m-new'])
    expect(appendedCustomModelIds({ customModelIds: undefined }, 'm-new')).toEqual(['m-new'])
  })

  it('does not duplicate an id the provider already lists', () => {
    expect(appendedCustomModelIds({ customModelIds: ['m-new'] }, 'm-new')).toEqual(['m-new'])
  })

  it('leaves the provider array untouched', () => {
    const customModelIds = ['a']
    appendedCustomModelIds({ customModelIds }, 'b')
    expect(customModelIds).toEqual(['a'])
  })
})
