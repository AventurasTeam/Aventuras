import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ rowsAffected: 0 }))
  const select = vi.fn(async () => [] as any[])
  const close = vi.fn(async () => {})
  const connection = { execute, select, close }
  const load = vi.fn(async () => connection)
  const invoke = vi.fn(async () => [] as number[])
  return { execute, select, load, invoke }
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

describe('traits are stored without repeats', () => {
  const REPEATED_LIST = ['honest', 'Honest ']

  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  const lastCall = () => {
    const calls = mocks.execute.mock.calls as unknown as [string, unknown[]][]
    return calls[calls.length - 1]
  }

  it('adding a character', async () => {
    await database.addCharacter({
      id: 'c1',
      storyId: 's1',
      name: 'Tony',
      description: null,
      relationship: null,
      traits: REPEATED_LIST,
      translatedTraits: REPEATED_LIST,
      visualDescriptors: {},
      status: 'active',
    } as any)

    const values = lastCall()[1]
    expect(values).toContain('["honest"]')
    expect(values.filter((v) => v === '["honest"]')).toHaveLength(2)
  })

  it('updating a character', async () => {
    await database.updateCharacter('c1', { traits: REPEATED_LIST, translatedTraits: REPEATED_LIST })

    expect(lastCall()[1].filter((v) => v === '["honest"]')).toHaveLength(2)
  })

  it('a null translation stays null', async () => {
    await database.updateCharacter('c1', { translatedTraits: null as any })

    expect(lastCall()[1]).toContain(null)
    expect(lastCall()[1]).not.toContain('null')
  })

  it('adding a vault character', async () => {
    await database.addVaultCharacter({
      id: 'v1',
      name: 'Tony',
      description: null,
      traits: REPEATED_LIST,
      visualDescriptors: {},
      portrait: null,
      tags: [],
      favorite: false,
      source: 'manual',
      originalStoryId: null,
      metadata: null,
      createdAt: 1,
      updatedAt: 1,
    } as any)

    expect(lastCall()[1]).toContain('["honest"]')
  })

  it('updating a vault character', async () => {
    await database.updateVaultCharacter('v1', { traits: REPEATED_LIST })

    expect(lastCall()[1]).toContain('["honest"]')
  })
})
