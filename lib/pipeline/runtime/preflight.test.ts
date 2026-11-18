import { describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_DEFAULTS, STORY_SETTINGS_DEFAULTS, type ProviderCapabilities } from '@/lib/db'

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

  it('forwards the snapshot to the when predicate', () => {
    const snap = wiredSnapshot()
    let captured: PreflightSnapshot | undefined
    const pipeline = pipelineOf([
      {
        name: 'classify',
        resolves: [
          {
            target: 'classifier',
            when: (s) => {
              captured = s
              return false
            },
          },
        ],
      },
    ])
    runPreflight(pipeline, snap)
    expect(captured).toBe(snap)
  })

  it('issues no network call (pure, in-memory resolution)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const snap = wiredSnapshot()
    const pipeline = pipelineOf([{ name: 'narrative', resolves: [{ target: 'narrative' }] }])
    expect(runPreflight(pipeline, snap)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  // Pre-flight took the assignments path while every phase takes the override
  // path, so it disagreed with the call it gates — in both directions.
  it('accepts a story override when app assignments cannot resolve', () => {
    const snap = wiredSnapshot()
    snap.appSettings.assignments = {}
    const pipeline = pipelineOf([{ name: 'classify', resolves: [{ target: 'classifier' }] }])
    expect(runPreflight(pipeline, snap)).toMatchObject({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
    })

    snap.storySettings = {
      ...STORY_SETTINGS_DEFAULTS,
      models: { classifier: { providerId: 'prov-1', modelId: 'm' } },
    }
    expect(runPreflight(pipeline, snap)).toBeNull()
  })

  it('rejects a story override that cannot resolve, even when assignments could', () => {
    const snap = wiredSnapshot()
    const pipeline = pipelineOf([{ name: 'classify', resolves: [{ target: 'classifier' }] }])
    // Assignments alone resolve, which is what pre-flight used to check.
    expect(runPreflight(pipeline, snap)).toBeNull()

    // The override's provider is gone; the default provider does not stand in for it.
    snap.storySettings = {
      ...STORY_SETTINGS_DEFAULTS,
      models: { classifier: { providerId: 'prov-deleted', modelId: 'm' } },
    }
    expect(runPreflight(pipeline, snap)).toMatchObject({
      kind: 'config-resolver',
      failure: 'override-provider-missing',
      target: 'classifier',
    })
  })
})

// lore-mgmt on the agent profile's model `m`, cached with the capabilities a case gives it.
function closeSnapshot(capabilities?: ProviderCapabilities): PreflightSnapshot {
  const snap = wiredSnapshot()
  snap.appSettings.assignments = { ...snap.appSettings.assignments, 'lore-mgmt': 'ap' }
  snap.appSettings.providers = snap.appSettings.providers.map((p) => ({
    ...p,
    cachedModels: [capabilities === undefined ? { id: 'm' } : { id: 'm', capabilities }],
  }))
  return snap
}

// The close's declaration (milestone C2): lore-mgmt at each model phase, tool calling at the agent.
const closeShaped = pipelineOf([
  { name: 'boundary', resolves: [{ target: 'lore-mgmt' }] },
  { name: 'metadata', resolves: [{ target: 'lore-mgmt' }] },
  { name: 'agent', resolves: [{ target: 'lore-mgmt', requires: 'toolCalling' }] },
  { name: 'report' },
])

// generation-pipeline.md → Config pre-flight validation: a chapter close's tool calling.
describe('runPreflight — a required capability', () => {
  it('refuses a model flagged off at the phase that requires it, naming the model', () => {
    expect(runPreflight(closeShaped, closeSnapshot({ toolCalling: false }))).toEqual({
      kind: 'config-resolver',
      failure: 'tool-calling-off',
      target: 'lore-mgmt',
      phaseName: 'agent',
      modelId: 'm',
    })
  })

  it.each([
    ['flagged on', { toolCalling: true }],
    ['with the flag absent', { reasoning: true }],
    ['with an empty capabilities object', {}],
  ] as const)('passes a model %s', (_label, capabilities) => {
    expect(runPreflight(closeShaped, closeSnapshot(capabilities))).toBeNull()
  })

  it('passes a cached model with no capabilities object', () => {
    expect(runPreflight(closeShaped, closeSnapshot())).toBeNull()
  })

  it('passes a model the catalog never listed', () => {
    const snap = closeSnapshot({ toolCalling: false })
    snap.appSettings.providers = snap.appSettings.providers.map((p) => ({ ...p, cachedModels: [] }))
    expect(runPreflight(closeShaped, snap)).toBeNull()
  })

  it('passes a custom model id beside a cached model flagged off', () => {
    const snap = closeSnapshot({ toolCalling: false })
    snap.appSettings.providers = snap.appSettings.providers.map((p) => ({
      ...p,
      customModelIds: ['my-finetune'],
    }))
    snap.appSettings.profiles = snap.appSettings.profiles.map((p) =>
      p.id === 'ap' ? { ...p, modelRef: { providerId: 'prov-1', modelId: 'my-finetune' } } : p,
    )
    expect(runPreflight(closeShaped, snap)).toBeNull()
  })

  it("reads the story override's model, not the profile's", () => {
    const snap = closeSnapshot({ toolCalling: false })
    snap.appSettings.providers = snap.appSettings.providers.map((p) => ({
      ...p,
      cachedModels: [
        ...(p.cachedModels ?? []),
        { id: 'm-tools', capabilities: { toolCalling: true } },
        { id: 'm-plain', capabilities: { toolCalling: false } },
      ],
    }))
    snap.storySettings = {
      ...STORY_SETTINGS_DEFAULTS,
      models: { 'lore-mgmt': { providerId: 'prov-1', modelId: 'm-tools' } },
    }
    expect(runPreflight(closeShaped, snap)).toBeNull()

    snap.storySettings = {
      ...STORY_SETTINGS_DEFAULTS,
      models: { 'lore-mgmt': { providerId: 'prov-1', modelId: 'm-plain' } },
    }
    expect(runPreflight(closeShaped, snap)).toEqual({
      kind: 'config-resolver',
      failure: 'tool-calling-off',
      target: 'lore-mgmt',
      phaseName: 'agent',
      modelId: 'm-plain',
    })
  })

  it('reports an unassigned lore-mgmt at its first phase, before the capability', () => {
    const snap = closeSnapshot({ toolCalling: false })
    snap.appSettings.assignments = { retrieval: 'ap', classifier: 'ap' }
    expect(runPreflight(closeShaped, snap)).toEqual({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'lore-mgmt',
      phaseName: 'boundary',
    })
  })

  it("reports a requiring input's own resolve failure, not the capability", () => {
    const snap = closeSnapshot({ toolCalling: false })
    snap.appSettings.assignments = { ...snap.appSettings.assignments, 'lore-mgmt': 'gone' }
    const pipeline = pipelineOf([
      { name: 'agent', resolves: [{ target: 'lore-mgmt', requires: 'toolCalling' }] },
    ])
    expect(runPreflight(pipeline, snap)).toEqual({
      kind: 'config-resolver',
      failure: 'profile-missing',
      target: 'lore-mgmt',
      phaseName: 'agent',
    })
  })

  it('reports whichever failure comes first in phase order', () => {
    const snap = closeSnapshot({ toolCalling: false })
    snap.appSettings.assignments = { ...snap.appSettings.assignments, classifier: 'gone' }
    const classify = { name: 'classify', resolves: [{ target: 'classifier' }] } as const
    const agent = {
      name: 'agent',
      resolves: [{ target: 'lore-mgmt', requires: 'toolCalling' }],
    } as const

    expect(runPreflight(pipelineOf([classify, agent]), snap)).toMatchObject({
      failure: 'profile-missing',
      phaseName: 'classify',
    })
    expect(runPreflight(pipelineOf([agent, classify]), snap)).toMatchObject({
      failure: 'tool-calling-off',
      phaseName: 'agent',
    })
  })

  it('lets an input that requires nothing through on a model flagged off', () => {
    const pipeline = pipelineOf([{ name: 'metadata', resolves: [{ target: 'lore-mgmt' }] }])
    expect(runPreflight(pipeline, closeSnapshot({ toolCalling: false }))).toBeNull()
  })
})
