import { describe, expect, it } from 'vitest'

import type { ModelProfile, ProviderInstance } from '@/lib/db'

import { CALL_TIMEOUT_DEFAULT_MS, callTimeoutMs } from './call-timeout'
import type { ResolveModelConfig } from './resolve-model'

const provider: ProviderInstance = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: 'k',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}

const agentProfile = (id: string, timeout?: number): ModelProfile => ({
  id,
  kind: 'agent',
  name: id,
  modelRef: { providerId: 'prov-1', modelId: `m-${id}` },
  ...(timeout !== undefined ? { timeout } : {}),
})

// lore-mgmt and the classifier on different profiles, with different timeouts (seconds).
const config = (over: Partial<ResolveModelConfig> = {}): ResolveModelConfig => ({
  providers: [provider],
  profiles: [agentProfile('prof-lore', 45), agentProfile('prof-cls', 30)],
  assignments: { 'lore-mgmt': 'prof-lore', classifier: 'prof-cls' },
  ...over,
})

describe('callTimeoutMs', () => {
  it('defaults to ten minutes', () => {
    expect(CALL_TIMEOUT_DEFAULT_MS).toBe(600_000)
  })

  it("reads the named agent's own profile timeout", () => {
    expect(callTimeoutMs('lore-mgmt', config())).toBe(45_000)
    expect(callTimeoutMs('classifier', config())).toBe(30_000)
  })

  it('is ten minutes when the profile sets none, or the agent has no profile', () => {
    expect(
      callTimeoutMs(
        'lore-mgmt',
        config({ profiles: [agentProfile('prof-lore'), agentProfile('prof-cls', 30)] }),
      ),
    ).toBe(600_000)
    expect(callTimeoutMs('lore-mgmt', config({ assignments: { classifier: 'prof-cls' } }))).toBe(
      600_000,
    )
  })

  it("is ten minutes under a story override, leaving another agent's profile timeout", () => {
    const overridden = config({
      storyModels: { 'lore-mgmt': { providerId: 'prov-1', modelId: 'other' } },
    })
    expect(callTimeoutMs('lore-mgmt', overridden)).toBe(600_000)
    expect(callTimeoutMs('classifier', overridden)).toBe(30_000)
  })

  it.each([0, -30, Number.NaN])('reads an invalid profile timeout (%s) as none', (timeout) => {
    expect(
      callTimeoutMs(
        'lore-mgmt',
        config({ profiles: [agentProfile('prof-lore', timeout), agentProfile('prof-cls', 30)] }),
      ),
    ).toBe(600_000)
  })
})
