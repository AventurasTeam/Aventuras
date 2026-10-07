import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ rowsAffected: 0 }))
  const select = vi.fn(async () => [] as any[])
  const close = vi.fn(async () => {})
  const connection = { execute, select, close }
  const load = vi.fn(async () => connection)
  const invoke = vi.fn(async () => [] as number[])
  return { select, load, invoke }
})

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: mocks.load },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

import { database } from './database'

const REPEATED = JSON.stringify(['honest', 'confident', 'Honest', 'genuine'])
const CLEAN = ['honest', 'confident', 'genuine']

describe('a list a row stores with repeats loads without them', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  it('character traits, and their translation', async () => {
    mocks.select.mockResolvedValueOnce([
      {
        id: 'c1',
        story_id: 's1',
        name: 'Tony',
        traits: REPEATED,
        translated_traits: REPEATED,
        visual_descriptors: '{}',
      },
    ])

    const [character] = await database.getCharacters('s1')

    expect(character.traits).toEqual(CLEAN)
    expect(character.translatedTraits).toEqual(CLEAN)
  })

  it('vault character traits', async () => {
    mocks.select.mockResolvedValueOnce([
      { id: 'v1', name: 'Tony', traits: REPEATED, visual_descriptors: '{}' },
    ])

    const [character] = await database.getVaultCharacters()

    expect(character.traits).toEqual(CLEAN)
  })

  it('lorebook aliases and keywords', async () => {
    mocks.select.mockResolvedValueOnce([
      {
        id: 'e1',
        story_id: 's1',
        name: 'Citadel',
        type: 'location',
        aliases: JSON.stringify(['Keep', 'keep']),
        injection: JSON.stringify({ mode: 'keyword', keywords: ['wall', 'Wall'], priority: 2 }),
      },
    ])

    const [entry] = await database.getEntries('s1')

    expect(entry.aliases).toEqual(['Keep'])
    expect(entry.injection).toEqual({ mode: 'keyword', keywords: ['wall'], priority: 2 })
  })

  it('an entry stored without an injection', async () => {
    mocks.select.mockResolvedValueOnce([
      { id: 'e1', story_id: 's1', name: 'Citadel', type: 'location', injection: null },
    ])

    const [entry] = await database.getEntries('s1')

    expect(entry.injection).toEqual({ mode: 'keyword', keywords: [], priority: 0 })
  })
})
