import { describe, it, expect, vi } from 'vitest'

vi.mock('#lib/stores/activity.svelte.ts', () => ({
  activity: {
    startStep: vi.fn(() => ''),
    updateStep: vi.fn(),
    endStep: vi.fn(),
    recordStep: vi.fn(() => ''),
  },
}))
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: {
    addDebugRequest: vi.fn(),
    addDebugResponse: vi.fn(),
  },
}))

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: {
    systemServicesSettings: {},
    getServiceIdForPreset: vi.fn(),
    getServiceConfig: vi.fn(),
  },
}))

import { GenerationPipeline, presentInScene } from './GenerationPipeline'

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

describe('presentInScene', () => {
  const cast = [
    { id: 'me', name: 'Me', relationship: 'self' },
    { id: 'vendor', name: 'weapon vendor', relationship: null },
    { id: 'mira', name: 'Mira', relationship: null },
  ] as any[]
  const result = (present: string[], characterUpdates: any[] = []) =>
    ({ scene: { presentCharacterNames: present }, entryUpdates: { characterUpdates } }) as any
  const ids = (chars: { id: string }[]) => chars.map((c) => c.id)

  it('finds the named characters and always the protagonist', () => {
    expect(ids(presentInScene(cast, result(['mira'])))).toEqual(['me', 'mira'])
  })

  it('finds a character renamed this turn under the name it was listed with', () => {
    const renamed = result(['Darek'], [{ name: 'weapon vendor', changes: { newName: 'Darek' } }])
    expect(ids(presentInScene(cast, renamed))).toEqual(['me', 'vendor'])
  })

  it('does not bring in a renamed character that is not in the scene', () => {
    const renamed = result(['Mira'], [{ name: 'weapon vendor', changes: { newName: 'Darek' } }])
    expect(ids(presentInScene(cast, renamed))).toEqual(['me', 'mira'])
  })
})
