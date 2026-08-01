import { describe, it, expect, vi } from 'vitest'

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    systemServicesSettings: {},
    getServiceIdForPreset: vi.fn(),
    getServiceConfig: vi.fn(),
  },
}))

import { GenerationPipeline } from './GenerationPipeline'

describe('GenerationPipeline', () => {
  const mockDeps = {
    agenticRetrievalService: { retrieve: vi.fn() } as any,
    entryRetrievalService: { getRelevantEntries: vi.fn() } as any,
    timelineFillService: { execute: vi.fn() } as any,
    narrativeService: { generate: vi.fn() } as any,
    classifierService: { classify: vi.fn() } as any,
    translatorService: { translate: vi.fn() } as any,
    imageService: { generate: vi.fn() } as any,
    suggestionsService: { generate: vi.fn() } as any,
    actionChoicesService: { generate: vi.fn() } as any,
    worldStateService: { update: vi.fn() } as any,
  }

  it('can be instantiated with pipeline dependencies', () => {
    const pipeline = new GenerationPipeline(mockDeps as any)
    expect(pipeline).toBeDefined()
  })

  it('returns an AsyncGenerator when execute() is called', () => {
    const pipeline = new GenerationPipeline(mockDeps as any)
    const gen = pipeline.execute({} as any, {} as any)
    expect(gen[Symbol.asyncIterator]).toBeDefined()
  })
})
