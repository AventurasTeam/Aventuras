import { describe, it, expect, vi } from 'vitest'

const captured = vi.hoisted(() => ({ body: undefined as unknown }))

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    advancedRequestSettings: { manualMode: false },
    apiSettings: { mainNarrativeProfileId: 'profile', llmTimeoutMs: 1000 },
    getPresetConfig: vi.fn(),
    getProfile: vi.fn(),
    getProfileModels: () => [],
  },
}))

vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { isActive: false, addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
  debugStore: { logApiRequest: vi.fn(), logApiResponse: vi.fn() },
}))

// Every provider is built with this fetch, so the request body is what the SDK would have sent.
vi.mock('./providers/fetch', () => ({
  createTimeoutFetch: () => async (_input: unknown, init?: { body?: unknown }) => {
    captured.body = JSON.parse(String(init?.body))
    throw new Error('request captured')
  },
}))

import { generateText } from 'ai'

import {
  clampReasoningToCapability,
  REASONING_LEVELS,
  type ReasoningCapability,
} from '#lib/services/ai/core/reasoning.ts'
import { settings } from '#lib/stores/settings.svelte.ts'
import type { GenerationPreset, ProviderType, ReasoningEffort } from '#lib/types/index.ts'
import { resolvePresetModel } from './presetResolution'
import { supportsReasoning } from './providers/config'

/**
 * What reaches a provider at each reasoning level, read off the request body of the real SDK.
 *
 * Both reasoning regressions so far sat below our own code -- an SDK that dropped 'none', a
 * provider that ignored the option we handed it -- so a test of the options we build cannot see
 * them. These tests assert how the bodies relate to each other, never what a provider's reasoning
 * JSON looks like.
 */

// 'carrier': the field is not model-gated, so every level must show up in the body.
// 'native': the SDK maps the level per model, so only "the setting reaches the request" holds.
// 'smoke': reasoning is off for the provider, so there is no level to compare.
const TIER: Record<ProviderType, 'carrier' | 'native' | 'smoke'> = {
  openrouter: 'carrier',
  nanogpt: 'carrier',
  chutes: 'carrier',
  pollinations: 'carrier',
  ollama: 'carrier',
  lmstudio: 'carrier',
  llamacpp: 'carrier',
  'nvidia-nim': 'carrier',
  'openai-compatible': 'carrier',
  zhipu: 'carrier',
  openai: 'native',
  anthropic: 'native',
  google: 'native',
  xai: 'native',
  groq: 'native',
  deepseek: 'native',
  mistral: 'smoke',
}

const FIXTURES: Record<ProviderType, { model: string; baseUrl?: string }> = {
  openrouter: { model: 'z-ai/glm-5' },
  nanogpt: { model: 'zai-org/glm-5' },
  chutes: { model: 'zai-org/GLM-5' },
  pollinations: { model: 'openai' },
  ollama: { model: 'qwen3' },
  lmstudio: { model: 'qwen3' },
  llamacpp: { model: 'qwen3' },
  'nvidia-nim': { model: 'qwen/qwen3-235b-a22b' },
  'openai-compatible': { model: 'qwen3', baseUrl: 'https://example.test/v1' },
  zhipu: { model: 'glm-5', baseUrl: 'https://example.test/v1' },
  openai: { model: 'gpt-5' },
  anthropic: { model: 'claude-sonnet-4-5' },
  google: { model: 'gemini-3-flash-preview' },
  xai: { model: 'grok-4' },
  groq: { model: 'qwen/qwen3.6-27b' },
  deepseek: { model: 'deepseek-reasoner' },
  mistral: { model: 'mistral-large-latest' },
}

const PROVIDERS_UNDER_TEST = Object.keys(TIER) as ProviderType[]

/** The levels the app can send: what the slider offers, after a provider's capability clamps it. */
function levelsFor(providerType: ProviderType): ReasoningEffort[] {
  const capability: ReasoningCapability = supportsReasoning(providerType)
    ? 'supported'
    : 'unsupported'
  return [
    ...new Set(REASONING_LEVELS.map((level) => clampReasoningToCapability(level, capability))),
  ]
}

async function bodyAt(providerType: ProviderType, effort: ReasoningEffort): Promise<unknown> {
  const { model, baseUrl } = FIXTURES[providerType]
  const preset: GenerationPreset = {
    id: 'p',
    name: 'p',
    description: '',
    profileId: 'profile',
    manualBody: '',
    model,
    temperature: 0.7,
    maxTokens: 1000,
    reasoningEffort: effort,
  }
  vi.mocked(settings.getPresetConfig).mockReturnValue(preset)
  vi.mocked(settings.getProfile).mockReturnValue({
    id: 'profile',
    name: 'profile',
    providerType,
    baseUrl,
    apiKey: 'key',
    customModels: [],
    fetchedModels: [],
    hiddenModels: [],
    favoriteModels: [],
    createdAt: 0,
  })

  const resolved = resolvePresetModel({ presetId: 'p', serviceId: 'test' })
  captured.body = undefined
  // The seed is fixed because Pollinations fills a missing one from the clock.
  await generateText({
    model: resolved.model,
    prompt: 'x',
    seed: 1,
    reasoning: resolved.reasoning,
    providerOptions: resolved.providerOptions,
    maxRetries: 0,
  }).catch(() => undefined)

  expect(captured.body, `${providerType} sent no request`).toBeDefined()
  return captured.body
}

/** path -> value for every leaf of a JSON value. */
function leaves(value: unknown, path = ''): Map<string, string> {
  const out = new Map<string, string>()
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      for (const [p, v] of leaves(child, `${path}/${key}`)) out.set(p, v)
    }
  } else {
    out.set(path, JSON.stringify(value))
  }
  return out
}

/** Whether every leaf of `a` is also in `b`: `a` says nothing that `b` does not. */
function isSubset(a: unknown, b: unknown): boolean {
  const inB = leaves(b)
  return [...leaves(a)].every(([path, value]) => inB.get(path) === value)
}

describe('reasoning levels on the wire', () => {
  describe.each(PROVIDERS_UNDER_TEST.filter((p) => TIER[p] === 'carrier'))('%s', (providerType) => {
    it('states "none" and every other level, each as a different request', async () => {
      const none = await bodyAt(providerType, 'none')

      for (const level of levelsFor(providerType).filter((l) => l !== 'none')) {
        const body = await bodyAt(providerType, level)
        expect(isSubset(none, body), `${providerType}: "none" is just ${level} with a gap`).toBe(
          false,
        )
        expect(isSubset(body, none), `${providerType}: ${level} never reached the request`).toBe(
          false,
        )
      }
    })

    it('sends every level as a distinct request', async () => {
      const levels = levelsFor(providerType)
      const bodies: string[] = []
      for (const level of levels) bodies.push(JSON.stringify(await bodyAt(providerType, level)))

      expect(new Set(bodies).size, `${providerType} collapses two levels into one request`).toBe(
        levels.length,
      )
    })
  })

  describe.each(PROVIDERS_UNDER_TEST.filter((p) => TIER[p] === 'native'))('%s', (providerType) => {
    it('lets the reasoning setting change the request', async () => {
      const none = JSON.stringify(await bodyAt(providerType, 'none'))
      const others: string[] = []
      for (const level of levelsFor(providerType).filter((l) => l !== 'none')) {
        others.push(JSON.stringify(await bodyAt(providerType, level)))
      }

      expect(
        others.some((body) => body !== none),
        `${providerType} ignores the reasoning setting`,
      ).toBe(true)
    })
  })

  describe.each(PROVIDERS_UNDER_TEST.filter((p) => TIER[p] === 'smoke'))('%s', (providerType) => {
    it('still sends a request at the only level it offers', async () => {
      expect(levelsFor(providerType)).toEqual(['none'])
      await bodyAt(providerType, 'none')
    })
  })
})
