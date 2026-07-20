import { describe, expect, it } from 'vitest'

import type { StorySettings } from '@/lib/db'

import { resolveEmbedderGate } from './gate'

type GateApp = {
  embeddingModelId: string | null
  embeddingProviderId: string | null
  defaultStorySettings: Partial<StorySettings>
  providers: readonly { id: string }[]
}

const LOCAL_CATALOG_ID = 'Xenova/all-MiniLM-L6-v2'

const baseApp = (overrides: Partial<GateApp> = {}): GateApp => ({
  embeddingModelId: null,
  embeddingProviderId: null,
  defaultStorySettings: {},
  providers: [],
  ...overrides,
})

describe('resolveEmbedderGate', () => {
  it('local happy: catalog id + installed -> usable with dim 384', () => {
    const app = baseApp({
      embeddingModelId: LOCAL_CATALOG_ID,
      defaultStorySettings: { embeddingBackend: 'local' },
    })

    const result = resolveEmbedderGate(app, [LOCAL_CATALOG_ID])

    expect(result).toEqual({
      usable: true,
      config: { backend: 'local', modelId: LOCAL_CATALOG_ID, dim: 384 },
    })
  })

  it('local set but not installed -> model-not-installed', () => {
    const app = baseApp({
      embeddingModelId: LOCAL_CATALOG_ID,
      defaultStorySettings: { embeddingBackend: 'local' },
    })

    const result = resolveEmbedderGate(app, [])

    expect(result).toEqual({ usable: false, reason: 'model-not-installed' })
  })

  it('local unknown id, installed -> unknown-model (installed-ness irrelevant once unknowable)', () => {
    const app = baseApp({
      embeddingModelId: 'not-a-real-model',
      defaultStorySettings: { embeddingBackend: 'local' },
    })

    const result = resolveEmbedderGate(app, ['not-a-real-model'])

    expect(result).toEqual({ usable: false, reason: 'unknown-model' })
  })

  it('local unknown id, not installed -> unknown-model', () => {
    const app = baseApp({
      embeddingModelId: 'not-a-real-model',
      defaultStorySettings: { embeddingBackend: 'local' },
    })

    const result = resolveEmbedderGate(app, [])

    expect(result).toEqual({ usable: false, reason: 'unknown-model' })
  })

  it('nothing set -> no-model', () => {
    const app = baseApp({ defaultStorySettings: { embeddingBackend: 'local' } })

    const result = resolveEmbedderGate(app, [])

    expect(result).toEqual({ usable: false, reason: 'no-model' })
  })

  it('backend default absent -> treated as local', () => {
    const app = baseApp({ embeddingModelId: LOCAL_CATALOG_ID, defaultStorySettings: {} })

    const result = resolveEmbedderGate(app, [LOCAL_CATALOG_ID])

    expect(result).toEqual({
      usable: true,
      config: { backend: 'local', modelId: LOCAL_CATALOG_ID, dim: 384 },
    })
  })

  it('provider happy: provider instance present -> usable dim 0', () => {
    const app = baseApp({
      embeddingModelId: 'text-embedding-3-small',
      embeddingProviderId: 'prov-1',
      defaultStorySettings: { embeddingBackend: 'provider' },
      providers: [{ id: 'prov-1' }],
    })

    const result = resolveEmbedderGate(app, [])

    expect(result).toEqual({
      usable: true,
      config: {
        backend: 'provider',
        providerId: 'prov-1',
        modelId: 'text-embedding-3-small',
        dim: 0,
      },
    })
  })

  it('provider id set but instance missing from providers -> no-provider', () => {
    const app = baseApp({
      embeddingModelId: 'text-embedding-3-small',
      embeddingProviderId: 'prov-1',
      defaultStorySettings: { embeddingBackend: 'provider' },
      providers: [],
    })

    const result = resolveEmbedderGate(app, [])

    expect(result).toEqual({ usable: false, reason: 'no-provider' })
  })

  it('provider backend missing model -> no-model', () => {
    const app = baseApp({
      embeddingProviderId: 'prov-1',
      defaultStorySettings: { embeddingBackend: 'provider' },
      providers: [{ id: 'prov-1' }],
    })

    const result = resolveEmbedderGate(app, [])

    expect(result).toEqual({ usable: false, reason: 'no-model' })
  })
})
