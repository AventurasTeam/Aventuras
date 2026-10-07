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

const REPEATED = JSON.stringify(['honest', 'confident', 'Honest', ' honest ', 'genuine'])
const CLEAN = ['honest', 'confident', 'genuine']

describe('traits a row stores with repeats load without them', () => {
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

  it('traits that differ beyond case and padding stay apart', async () => {
    mocks.select.mockResolvedValueOnce([
      {
        id: 'c1',
        story_id: 's1',
        name: 'Tony',
        traits: JSON.stringify(['Élan', 'Elan']),
        visual_descriptors: '{}',
      },
    ])

    const [character] = await database.getCharacters('s1')

    expect(character.traits).toEqual(['Élan', 'Elan'])
  })
})
