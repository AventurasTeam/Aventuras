import { describe, expect, it } from 'vitest'

import type { StorySettings } from '@/lib/db'

import { embedderReadDim, resolveEmbedderConfig, type EmbedderAppDefaults } from './resolve-config'
import {
  EmbedderCallError,
  EmbedderInitError,
  type EmbedderConfig,
  type EmbedderTruncation,
} from './types'

type StoryInput = Pick<
  StorySettings,
  'embeddingBackend' | 'embedding_model_id' | 'embedding_provider_id'
>

const appDefaults = (overrides: Partial<EmbedderAppDefaults> = {}): EmbedderAppDefaults => ({
  embeddingModelId: null,
  embeddingProviderId: null,
  defaultStorySettings: {},
  ...overrides,
})

describe('resolveEmbedderConfig', () => {
  it('story settings win over app defaults (local model precedence)', () => {
    const story: StoryInput = {
      embeddingBackend: 'local',
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
      embedding_provider_id: undefined,
    }
    const app = appDefaults({
      embeddingModelId: 'some-other-model-id',
      defaultStorySettings: { embeddingBackend: 'provider' },
    })

    const result = resolveEmbedderConfig(story, app)

    expect(result).toEqual({
      ok: true,
      config: { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 384 },
    })
  })

  it('null story falls back to app defaults, local happy path', () => {
    const app = appDefaults({ embeddingModelId: 'Xenova/all-MiniLM-L6-v2' })

    const result = resolveEmbedderConfig(null, app)

    expect(result).toEqual({
      ok: true,
      config: { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 384 },
    })
  })

  it('null story + no explicit app backend defaults to local', () => {
    const app = appDefaults({
      embeddingModelId: 'Xenova/all-MiniLM-L6-v2',
      defaultStorySettings: {},
    })

    const result = resolveEmbedderConfig(null, app)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.backend).toBe('local')
    }
  })

  it('local backend with unknown model id fails with unknown-local-model', () => {
    const story: StoryInput = {
      embeddingBackend: 'local',
      embedding_model_id: 'not-a-real-model',
      embedding_provider_id: undefined,
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'unknown-local-model' })
  })

  it('local backend with missing model id fails with no-model', () => {
    const story: StoryInput = {
      embeddingBackend: 'local',
      embedding_model_id: '',
      embedding_provider_id: undefined,
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'no-model' })
  })

  it('null story + no app model id fails with no-model', () => {
    const result = resolveEmbedderConfig(null, appDefaults({ embeddingModelId: null }))

    expect(result).toEqual({ ok: false, reason: 'no-model' })
  })

  it('provider backend with missing provider id fails with no-provider', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: undefined,
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'no-provider' })
  })

  it('provider backend with empty-string provider id fails with no-provider', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: '',
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'no-provider' })
  })

  it('provider backend with provider id but missing model id fails with no-model', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: '',
      embedding_provider_id: 'openai',
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'no-model' })
  })

  it('treats a whitespace-only model id as missing rather than usable', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: '   ',
      embedding_provider_id: 'openai',
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'no-model' })
  })

  it('treats a whitespace-only provider id as missing rather than usable', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: '  \t ',
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({ ok: false, reason: 'no-provider' })
  })

  it('provider happy path uses opts.providerDim', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: 'openai',
    }

    const result = resolveEmbedderConfig(story, appDefaults(), { providerDim: 1536 })

    expect(result).toEqual({
      ok: true,
      config: {
        backend: 'provider',
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        dim: 1536,
        truncation: null,
      },
    })
  })

  it('provider happy path without providerDim resolves dim null (unknown until first embed)', () => {
    const story: StoryInput = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: 'openai',
    }

    const result = resolveEmbedderConfig(story, appDefaults())

    expect(result).toEqual({
      ok: true,
      config: {
        backend: 'provider',
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        dim: null,
        truncation: null,
      },
    })
  })

  it('provider story with effectiveDim + matryoshkaSupported resolves serverSide truncation', () => {
    const story: StoryInput & { effectiveDim: number } = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: 'openai',
      effectiveDim: 1024,
    }

    const result = resolveEmbedderConfig(story, appDefaults(), {
      providerDim: 1536,
      matryoshkaSupported: true,
    })

    expect(result).toEqual({
      ok: true,
      config: {
        backend: 'provider',
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        dim: 1536,
        truncation: { effectiveDim: 1024, serverSide: true },
      },
    })
  })

  it('provider story with effectiveDim but no matryoshkaSupported resolves client-only truncation', () => {
    const story: StoryInput & { effectiveDim: number } = {
      embeddingBackend: 'provider',
      embedding_model_id: 'text-embedding-3-small',
      embedding_provider_id: 'openai',
      effectiveDim: 1024,
    }

    const result = resolveEmbedderConfig(story, appDefaults(), { providerDim: 1536 })

    expect(result).toEqual({
      ok: true,
      config: {
        backend: 'provider',
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        dim: 1536,
        truncation: { effectiveDim: 1024, serverSide: false },
      },
    })
  })

  it('local backend ignores effectiveDim entirely', () => {
    const story: StoryInput & { effectiveDim: number } = {
      embeddingBackend: 'local',
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
      embedding_provider_id: undefined,
      effectiveDim: 1024,
    }

    const result = resolveEmbedderConfig(story, appDefaults(), { matryoshkaSupported: true })

    expect(result).toEqual({
      ok: true,
      config: { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 384 },
    })
    if (result.ok) {
      expect(result.config).not.toHaveProperty('effectiveDim')
    }
  })

  it('null story falls back to app defaults, provider path', () => {
    const app = appDefaults({
      embeddingModelId: 'text-embedding-3-small',
      embeddingProviderId: 'openai',
      defaultStorySettings: { embeddingBackend: 'provider' },
    })

    const result = resolveEmbedderConfig(null, app, { providerDim: 1536 })

    expect(result).toEqual({
      ok: true,
      config: {
        backend: 'provider',
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        dim: 1536,
        truncation: null,
      },
    })
  })
})

describe('embedderReadDim', () => {
  const provider = (dim: number | null, truncation: EmbedderTruncation | null): EmbedderConfig => ({
    backend: 'provider',
    providerId: 'openai',
    modelId: 'text-embedding-3-large',
    dim,
    truncation,
  })

  it('reads a local config at the catalog dim', () => {
    expect(
      embedderReadDim({ backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 384 }),
    ).toBe(384)
  })

  it('reads an untruncated provider config at its probed native dim', () => {
    expect(embedderReadDim(provider(3072, null))).toBe(3072)
  })

  it('cannot answer for an unprobed, untruncated provider config', () => {
    expect(embedderReadDim(provider(null, null))).toBeNull()
  })

  // The one cell where this diverges from the swap engine's configStorageDim,
  // which stays null here so a staging run can adopt the served dim instead.
  it("reads an unprobed truncating provider config at the story's locked dim", () => {
    expect(embedderReadDim(provider(null, { effectiveDim: 512, serverSide: true }))).toBe(512)
  })

  it('clamps a truncation wider than the native dim', () => {
    expect(embedderReadDim(provider(768, { effectiveDim: 1536, serverSide: false }))).toBe(768)
  })

  it('honours a truncation narrower than the native dim', () => {
    expect(embedderReadDim(provider(1536, { effectiveDim: 512, serverSide: false }))).toBe(512)
  })
})

describe('EmbedderInitError', () => {
  it('carries a kind discriminant, is an Error, and preserves cause', () => {
    const cause = new Error('native module missing')
    const error = new EmbedderInitError('init failed', cause)

    expect(error.kind).toBe('init')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(EmbedderInitError)
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('init failed')
  })
})

describe('EmbedderCallError', () => {
  it('carries a kind discriminant, is an Error, and preserves cause', () => {
    const cause = new Error('network timeout')
    const error = new EmbedderCallError('call failed', cause)

    expect(error.kind).toBe('call')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(EmbedderCallError)
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('call failed')
  })
})
