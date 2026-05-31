import { describe, expect, it } from 'vitest'

import { domain, ui, type RunState } from '@/lib/stores'

// Imports via the namespace only. A deep import of a raw handle is asserted by
// public-api-surfaces.test.ts (boundaries lint) and public-api.typecheck.ts.
describe('lib/stores public namespace', () => {
  it('exposes the generation selector + mutators', () => {
    expect(typeof domain.useGeneration).toBe('function')
    expect(typeof domain.startRun).toBe('function')
    expect(typeof domain.finishRun).toBe('function')
  })

  it('exposes the app-settings read-model selectors', () => {
    expect(typeof domain.useAppSettings).toBe('function')
    expect(typeof domain.getAppSettings).toBe('function')
  })

  it('exposes the navigation selectors + mutators', () => {
    expect(typeof domain.useNavigation).toBe('function')
    expect(typeof domain.setCurrentStory).toBe('function')
    expect(typeof domain.setCurrentBranch).toBe('function')
  })

  it('declares an empty ui namespace', () => {
    expect(ui).toEqual({})
  })

  it('domain.__reset clears every sub-store', () => {
    const run: RunState = {
      runId: 'r1',
      kind: 'synthetic',
      actionId: 'a1',
      storyId: null,
      branchId: 'b1',
      abortController: new AbortController(),
      currentPhase: '',
      intermediates: {},
    }
    domain.startRun(run)
    domain.setCurrentStory('s1')

    domain.__reset()

    expect(domain.getTxState().runs.size).toBe(0)
    expect(domain.getNavigation().currentStoryId).toBeNull()
    expect(domain.getAppSettings()).toEqual({
      providers: [],
      profiles: [],
      assignments: {},
      defaultProviderId: null,
      diagnostics: { enabled: false, debug_level_enabled: false },
    })
  })
})
