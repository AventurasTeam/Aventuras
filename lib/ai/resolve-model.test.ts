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
  defaultProviderId: 'prov-1',
}

describe('resolveModel', () => {
  it('resolves narrative via the narrative profile', () => {
    expect(resolveModel('narrative', base)).toEqual({
      ok: true,
      providerId: 'prov-1',
      modelId: 'm-narr',
      params: { temperature: 0.8 },
    })
  })

  it('resolves an agent via assignment → profile → provider', () => {
    expect(resolveModel('wizard-assist', base)).toEqual({
      ok: true,
      providerId: 'prov-1',
      modelId: 'm-agent',
      params: { structuredOutput: 'auto' },
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

  it('story override short-circuits to the default provider, skipping the walk', () => {
    const cfg: ResolveModelConfig = { ...base, storyModels: { classifier: 'override-model' } }
    expect(resolveModel('classifier', cfg)).toEqual({
      ok: true,
      providerId: 'prov-1',
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
    // @ts-expect-error wizard-assist has no per-story override slot (modelsSchema).
    const cfg: ResolveModelConfig = { ...base, storyModels: { 'wizard-assist': 'override-model' } }
    expect(resolveModel('wizard-assist', cfg)).toEqual({
      ok: true,
      providerId: 'prov-1',
      modelId: 'm-agent',
      params: { structuredOutput: 'auto' },
    })
  })

  it('override fails provider-missing when there is no default provider', () => {
    const cfg: ResolveModelConfig = {
      ...base,
      defaultProviderId: null,
      storyModels: { classifier: 'override-model' },
    }
    expect(resolveModel('classifier', cfg)).toEqual({
      ok: false,
      kind: 'provider-missing',
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
