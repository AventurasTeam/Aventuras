import { describe, expect, it } from 'vitest'

import type { GlobalAgentId, ModelProfile, ProviderInstance, StoryAgentId } from '@/lib/db'

import { resolveModel, type ResolveModelConfig } from './resolve-model'

const provider: ProviderInstance = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: 'k',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}
const narrativeProfile: ModelProfile = {
  id: 'prof-narr',
  kind: 'narrative',
  name: 'Narrative',
  modelRef: { providerId: 'prov-1', modelId: 'm-narr' },
  temperature: 0.8,
}
const agentProfile: ModelProfile = {
  id: 'prof-agent',
  kind: 'agent',
  name: 'Agent',
  modelRef: { providerId: 'prov-1', modelId: 'm-agent' },
  structuredOutput: 'auto',
}

const base: ResolveModelConfig = {
  providers: [provider],
  profiles: [narrativeProfile, agentProfile],
  assignments: { 'wizard-assist': 'prof-agent', classifier: 'prof-agent' },
}

describe('resolveModel', () => {
  it('resolves narrative via the narrative profile', () => {
    expect(resolveModel('narrative', base)).toEqual({
      ok: true,
      providerId: 'prov-1',
      modelId: 'm-narr',
      params: { temperature: 0.8 },
      profileId: 'prof-narr',
    })
  })

  it('resolves an agent via assignment → profile → provider', () => {
    expect(resolveModel('wizard-assist', base)).toEqual({
      ok: true,
      providerId: 'prov-1',
      modelId: 'm-agent',
      params: { structuredOutput: 'auto' },
      profileId: 'prof-agent',
    })
  })

  it('fails no-profile-assigned for an unset assignment', () => {
    expect(resolveModel('suggestion', base)).toEqual({
      ok: false,
      kind: 'no-profile-assigned',
      target: 'suggestion',
    })
  })

  it('fails profile-missing when the assignment points at a deleted profile', () => {
    const cfg = { ...base, assignments: { classifier: 'gone' } }
    expect(resolveModel('classifier', cfg)).toEqual({
      ok: false,
      kind: 'profile-missing',
      target: 'classifier',
    })
  })

  it('fails provider-missing when the profile references no provider', () => {
    const orphan: ModelProfile = { ...agentProfile, modelRef: { providerId: 'gone', modelId: 'x' } }
    const cfg = { ...base, profiles: [narrativeProfile, orphan] }
    expect(
      resolveModel('classifier', { ...cfg, assignments: { classifier: 'prof-agent' } }),
    ).toEqual({ ok: false, kind: 'provider-missing', target: 'classifier' })
  })

  it("story override resolves on the override's own provider, skipping the walk", () => {
    const other: ProviderInstance = { ...provider, id: 'prov-2', displayName: 'Other' }
    const cfg: ResolveModelConfig = {
      ...base,
      providers: [provider, other],
      storyModels: { classifier: { providerId: 'prov-2', modelId: 'override-model' } },
    }
    expect(resolveModel('classifier', cfg)).toEqual({
      ok: true,
      providerId: 'prov-2',
      modelId: 'override-model',
      params: {},
    })
  })

  it('keeps the story and global agent registries disjoint (compile-time)', () => {
    // isStoryOverrideTarget treats "not global" as "story-scoped"; overlap would
    // make that unsound. A shared id collapses Disjoint to false → typecheck fails.
    type Disjoint = StoryAgentId & GlobalAgentId extends never ? true : false
    const disjoint: Disjoint = true
    expect(disjoint).toBe(true)
  })

  it('rejects a wizard-assist story override at the type level and ignores it at runtime', () => {
    const cfg: ResolveModelConfig = {
      ...base,
      // @ts-expect-error wizard-assist has no per-story override slot (modelsSchema).
      storyModels: { 'wizard-assist': { providerId: 'prov-1', modelId: 'override-model' } },
    }
    expect(resolveModel('wizard-assist', cfg)).toEqual({
      ok: true,
      providerId: 'prov-1',
      modelId: 'm-agent',
      params: { structuredOutput: 'auto' },
      profileId: 'prof-agent',
    })
  })

  it('names the override, not the app chain, when the override provider was deleted', () => {
    const cfg: ResolveModelConfig = {
      ...base,
      storyModels: { classifier: { providerId: 'gone', modelId: 'override-model' } },
    }
    // Distinct from 'provider-missing': that one is repaired in App Settings,
    // this one only on the story's Models tab.
    expect(resolveModel('classifier', cfg)).toEqual({
      ok: false,
      kind: 'override-provider-missing',
      target: 'classifier',
    })
  })

  it('fails no-profile-assigned for narrative when no narrative profile exists', () => {
    const cfg = { ...base, profiles: [agentProfile] }
    expect(resolveModel('narrative', cfg)).toEqual({
      ok: false,
      kind: 'no-profile-assigned',
      target: 'narrative',
    })
  })
})
