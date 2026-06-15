import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { BUNDLED_PACK_ID } from '@/lib/prompts'
import {
  appSettingsStore,
  entitiesStore,
  generationStore,
  navigationStore,
  resetAllStores,
  type RunState,
} from '@/lib/stores'

// Each store is exposed as its own namespace off the lib/stores index. A deep
// import of a raw handle is asserted by public-api-surfaces.test.ts (boundaries
// lint) and public-api.typecheck.ts.
describe('lib/stores public surface', () => {
  it('exposes the generation selector + mutators', () => {
    expect(typeof generationStore.useGeneration).toBe('function')
    expect(typeof generationStore.startRun).toBe('function')
    expect(typeof generationStore.finishRun).toBe('function')
  })

  it('exposes the app-settings read-model selectors', () => {
    expect(typeof appSettingsStore.useAppSettings).toBe('function')
    expect(typeof appSettingsStore.getAppSettings).toBe('function')
  })

  it('exposes the navigation selectors + mutators', () => {
    expect(typeof navigationStore.useNavigation).toBe('function')
    expect(typeof navigationStore.setCurrentStory).toBe('function')
    expect(typeof navigationStore.setCurrentBranch).toBe('function')
  })

  it('exposes the entities selectors', () => {
    expect(typeof entitiesStore.useEntities).toBe('function')
    expect(typeof entitiesStore.getEntities).toBe('function')
    expect(typeof entitiesStore.getById).toBe('function')
    expect(typeof entitiesStore.getByKind).toBe('function')
  })

  it('resetAllStores clears every store', () => {
    const run: RunState = {
      runId: 'r1',
      kind: 'synthetic',
      actionId: 'a1',
      storyId: null,
      branchId: 'b1',
      abortController: new AbortController(),
      currentPhase: '',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    }
    const entity: Entity = {
      id: 'char_1',
      branchId: 'br_1',
      kind: 'character',
      name: 'Test',
      description: null,
      status: 'active',
      retiredReason: null,
      injectionMode: 'auto',
      nameCollisionFlag: 0,
      state: null,
      tags: [],
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    generationStore.startRun(run)
    navigationStore.setCurrentStory('s1')
    entitiesStore.hydrate('br_1', [entity])

    resetAllStores()

    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(navigationStore.getNavigation().currentStoryId).toBeNull()
    expect(entitiesStore.getEntities().size).toBe(0)
    const settings = appSettingsStore.getAppSettings()
    expect(settings.providers).toEqual([])
    expect(settings.profiles).toEqual([])
    expect(settings.assignments).toEqual({})
    expect(settings.defaultProviderId).toBeNull()
    expect(settings.embeddingModelId).toBeNull()
    expect(settings.embeddingProviderId).toBeNull()
    expect(settings.defaultCalendarId).toBeNull()
    expect(settings.onboardingCompletedAt).toBeNull()
    expect(settings.uiLanguage).toBe('en')
    expect(settings.appearance.density).toBe('default')
    expect(settings.defaultStorySettings).toEqual({ activePackId: BUNDLED_PACK_ID })
    expect(settings.defaultSuggestionCategories).toEqual({ adventure: [], creative: [] })
    expect(settings.diagnostics).toEqual({ enabled: false, debug_level_enabled: false })
  })
})
