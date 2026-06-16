import { describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS } from '@/lib/db'

import type { PhaseFn, Pipeline, PreflightSnapshot, ResolverInput } from '../types'
import { runPreflight } from './preflight'

const noopPhase: PhaseFn = async function* () {
  return { status: 'completed' }
}

const base = {
  affordance: 'invisible',
  gateBehavior: 'hard-gate',
  concurrencyPolicy: {},
} as const

function pipelineOf(phases: { name: string; resolves?: readonly ResolverInput[] }[]): Pipeline {
  return { kind: 'pf', phases: phases.map((p) => ({ ...p, run: noopPhase })), ...base }
}

// A snapshot with a narrative profile + agent profile wired to one provider.
function wiredSnapshot(): PreflightSnapshot {
  return {
    appSettings: {
      ...APP_SETTINGS_DEFAULTS,
      providers: [
        {
          id: 'prov-1',
          type: 'openai-compatible',
          displayName: 'Local',
          apiKey: 'k',
          endpoint: 'http://x/v1',
          favoriteModelIds: [],
        },
      ],
      profiles: [
        {
          id: 'np',
          kind: 'narrative',
          name: 'Narrative',
          modelRef: { providerId: 'prov-1', modelId: 'm' },
        },
        { id: 'ap', kind: 'agent', name: 'Fast', modelRef: { providerId: 'prov-1', modelId: 'm' } },
      ],
      assignments: { retrieval: 'ap', classifier: 'ap' },
      defaultProviderId: 'prov-1',
    },
  }
}

describe('runPreflight', () => {
  it('passes when every declared resolver resolves', () => {
    const snap = wiredSnapshot()
    const pipeline = pipelineOf([{ name: 'narrative', resolves: [{ target: 'narrative' }] }])
    expect(runPreflight(pipeline, snap)).toBeNull()
  })

  it('reports no-profile-assigned when the narrative profile is absent', () => {
    const snap = wiredSnapshot()
    snap.appSettings.profiles = snap.appSettings.profiles.filter((p) => p.kind !== 'narrative')
    const pipeline = pipelineOf([{ name: 'narrative', resolves: [{ target: 'narrative' }] }])
    expect(runPreflight(pipeline, snap)).toEqual({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'narrative',
      phaseName: 'narrative',
    })
  })

  it('reports profile-missing when an assignment points at a deleted profile', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = { retrieval: 'gone' }
    const pipeline = pipelineOf([{ name: 'retrieve', resolves: [{ target: 'retrieval' }] }])
    expect(runPreflight(pipeline, snap)).toMatchObject({
      failure: 'profile-missing',
      target: 'retrieval',
    })
  })

  it('reports provider-missing when the resolved profile points at a deleted provider', () => {
    const snap = wiredSnapshot()
    snap.appSettings.providers = []
    const pipeline = pipelineOf([{ name: 'narrative', resolves: [{ target: 'narrative' }] }])
    expect(runPreflight(pipeline, snap)).toMatchObject({
      failure: 'provider-missing',
      target: 'narrative',
    })
  })

  it('reports the earlier phase only when two resolvers are broken (phase order)', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = {} // both retrieval and classifier unset
    const pipeline = pipelineOf([
      { name: 'retrieve', resolves: [{ target: 'retrieval' }] },
      { name: 'classify', resolves: [{ target: 'classifier' }] },
    ])
    expect(runPreflight(pipeline, snap)).toMatchObject({
      target: 'retrieval',
      phaseName: 'retrieve',
    })
  })

  it('walks parallel-branch resolves in declared order', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = {}
    const pipeline: Pipeline = {
      kind: 'pf',
      phases: [
        {
          name: 'group',
          parallel: [
            { name: 'b1', run: noopPhase, resolves: [{ target: 'retrieval' }] },
            { name: 'b2', run: noopPhase, resolves: [{ target: 'classifier' }] },
          ],
        },
      ],
      ...base,
    }
    expect(runPreflight(pipeline, snap)).toMatchObject({ target: 'retrieval', phaseName: 'b1' })
  })

  it('is selective: a broken agent the pipeline does not declare passes', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = { classifier: 'gone' } // classifier broken, but not declared
    const pipeline = pipelineOf([{ name: 'narrative', resolves: [{ target: 'narrative' }] }])
    expect(runPreflight(pipeline, snap)).toBeNull()
  })

  it('skips an input whose when-predicate returns false', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = {} // classifier would fail if validated
    const pipeline = pipelineOf([
      { name: 'classify', resolves: [{ target: 'classifier', when: () => false }] },
    ])
    expect(runPreflight(pipeline, snap)).toBeNull()
  })

  it('validates an input whose when-predicate returns true', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = {}
    const pipeline = pipelineOf([
      { name: 'classify', resolves: [{ target: 'classifier', when: () => true }] },
    ])
    expect(runPreflight(pipeline, snap)).toMatchObject({ target: 'classifier' })
  })

  it('issues no network call (pure, in-memory resolution)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const snap = wiredSnapshot()
    const pipeline = pipelineOf([{ name: 'narrative', resolves: [{ target: 'narrative' }] }])
    expect(runPreflight(pipeline, snap)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
