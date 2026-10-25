import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('#lib/stores/activity.svelte.ts', () => ({
  activity: {
    startStep: vi.fn(() => ''),
    updateStep: vi.fn(),
    endStep: vi.fn(),
    recordStep: vi.fn(() => ''),
  },
}))
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { getServicePresetId: vi.fn(() => 'preset'), systemServicesSettings: {} },
}))
vi.mock('#lib/services/context/index.ts', () => ({
  ContextBuilder: class {
    static async forPack() {
      return new this()
    }
    add() {}
    async render() {
      return { system: 'system', user: 'user' }
    }
  },
}))

const generateStructured = vi.fn()
vi.mock('../sdk/generate', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
  generatePlainText: vi.fn(),
}))

import { TranslationService } from './TranslationService'

const items = [
  { id: 'a:trait:0', text: 'brave', type: 'description' as const },
  { id: 'a:trait:1', text: 'stubborn', type: 'description' as const },
  { id: 'a:name', text: 'Ada', type: 'name' as const },
]

describe('translateUIElements', () => {
  beforeEach(() => {
    generateStructured.mockReset()
  })

  it('matches each translation to its item by id, whatever order it comes back in', async () => {
    generateStructured.mockResolvedValue({
      items: [
        { id: 'a:name', text: 'Ada', type: 'name' },
        { id: 'a:trait:1', text: 'testarda', type: 'description' },
        { id: 'a:trait:0', text: 'coraggiosa', type: 'description' },
      ],
    })
    const service = new TranslationService('translation' as any)
    const result = await service.translateUIElements(items, 'it', 's')
    expect(result.map((i) => [i.id, i.text])).toEqual([
      ['a:trait:0', 'coraggiosa'],
      ['a:trait:1', 'testarda'],
      ['a:name', 'Ada'],
    ])
  })

  it('leaves out an item the model did not answer', async () => {
    generateStructured.mockResolvedValue({
      items: [{ id: 'a:trait:1', text: 'testarda', type: 'description' }],
    })
    const service = new TranslationService('translation' as any)
    const result = await service.translateUIElements(items, 'it', 's')
    expect(result.map((i) => i.id)).toEqual(['a:trait:1'])
  })

  it('returns nothing when the request fails, rather than the source text', async () => {
    generateStructured.mockRejectedValue(new Error('provider down'))
    const service = new TranslationService('translation' as any)
    expect(await service.translateUIElements(items, 'it', 's')).toEqual([])
  })
})
