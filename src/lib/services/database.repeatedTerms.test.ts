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

  it('stored values that are not lists', async () => {
    mocks.select.mockResolvedValueOnce([
      {
        id: 'c1',
        story_id: 's1',
        name: 'Tony',
        traits: 'null',
        translated_traits: 'null',
        visual_descriptors: '{}',
      },
    ])

    const [character] = await database.getCharacters('s1')

    expect(character.traits).toEqual([])
    expect(character.translatedTraits).toBeNull()
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

describe('lorebook terms a row stores with repeats load without them', () => {
  beforeEach(async () => {
    await database.close()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await database.close()
  })

  const entryRow = (overrides: Record<string, unknown>) => ({
    id: 'e1',
    story_id: 's1',
    name: 'Keep',
    type: 'location',
    description: '',
    ...overrides,
  })

  it('entry aliases and keywords, keeping the rest of the injection', async () => {
    mocks.select.mockResolvedValueOnce([
      entryRow({
        aliases: REPEATED,
        injection: JSON.stringify({ mode: 'always', keywords: JSON.parse(REPEATED), priority: 7 }),
      }),
    ])

    const [entry] = await database.getEntries('s1')

    expect(entry.aliases).toEqual(CLEAN)
    expect(entry.injection).toEqual({ mode: 'always', keywords: CLEAN, priority: 7 })
  })

  it('an injection stored without keywords', async () => {
    mocks.select.mockResolvedValueOnce([
      entryRow({ injection: JSON.stringify({ mode: 'never', priority: 3 }) }),
    ])

    const [entry] = await database.getEntries('s1')

    expect(entry.injection).toEqual({ mode: 'never', keywords: [], priority: 3 })
  })

  it('a row with no injection or aliases', async () => {
    mocks.select.mockResolvedValueOnce([entryRow({})])

    const [entry] = await database.getEntries('s1')

    expect(entry.aliases).toEqual([])
    expect(entry.injection).toEqual({ mode: 'keyword', keywords: [], priority: 0 })
  })

  it('entry previews', async () => {
    mocks.select.mockResolvedValueOnce([entryRow({ aliases: REPEATED })])

    const [preview] = await database.getEntryPreviews('s1')

    expect(preview.aliases).toEqual(CLEAN)
  })

  it('vault lorebook entries', async () => {
    mocks.select.mockResolvedValueOnce([
      {
        id: 'l1',
        name: 'Lore',
        entries: JSON.stringify([
          {
            name: 'Keep',
            keywords: JSON.parse(REPEATED),
            aliases: JSON.parse(REPEATED),
            priority: 2,
          },
        ]),
      },
    ])

    const [lorebook] = await database.getVaultLorebooks()

    expect(lorebook.entries[0]).toMatchObject({ keywords: CLEAN, aliases: CLEAN, priority: 2 })
  })

  it('terms that differ beyond case and padding stay apart', async () => {
    mocks.select.mockResolvedValueOnce([entryRow({ aliases: JSON.stringify(['Élan', 'Elan']) })])

    const [entry] = await database.getEntries('s1')

    expect(entry.aliases).toEqual(['Élan', 'Elan'])
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

  it('adding a character without traits, as an imported file can', async () => {
    await database.addCharacter({
      id: 'c1',
      storyId: 's1',
      name: 'Tony',
      description: null,
      relationship: null,
      traits: undefined,
      visualDescriptors: {},
      status: 'active',
    } as any)

    expect(lastCall()[1]).toContain('[]')
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

describe('lorebook terms are stored without repeats', () => {
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

  const ALIASES = '["Keep"]'
  const INJECTION = '{"mode":"always","keywords":["Ward"],"priority":3}'
  const entry = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'e1',
      storyId: 's1',
      name: 'Keep',
      type: 'location',
      description: '',
      hiddenInfo: null,
      aliases: ['Keep', 'keep '],
      state: { type: 'location' },
      injection: { mode: 'always', keywords: ['Ward', 'ward'], priority: 3 },
      ...overrides,
    }) as any

  it('adding an entry', async () => {
    await database.addEntry(entry())

    const values = lastCall()[1]
    expect(values).toContain(ALIASES)
    expect(values).toContain(INJECTION)
  })

  it('adding entries in bulk', async () => {
    await database.bulkInsertEntries([entry()])

    const values = lastCall()[1]
    expect(values).toContain(ALIASES)
    expect(values).toContain(INJECTION)
  })

  it('binds one placeholder per column for every row of a bulk insert', async () => {
    await database.bulkInsertEntries([entry(), entry({ id: 'e2' })])

    const [sql, values] = lastCall()
    const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').length
    const groups = sql.slice(sql.indexOf('VALUES')).match(/\([?,]+\)/g) ?? []

    expect(groups).toHaveLength(2)
    for (const group of groups) expect(group.split('?').length - 1).toBe(columns)
    expect(values).toHaveLength(columns * 2)
  })

  it('adding an entry that has no injection, as an imported file can', async () => {
    await database.addEntry(entry({ injection: undefined }))

    expect(lastCall()[1][10]).toBeUndefined()
  })

  it('updating an entry', async () => {
    await database.updateEntry('e1', entry())

    const values = lastCall()[1]
    expect(values).toContain(ALIASES)
    expect(values).toContain(INJECTION)
  })

  it('updating only the aliases leaves the injection alone', async () => {
    await database.updateEntry('e1', { aliases: ['Keep', 'keep '] })

    const [sql, values] = lastCall()
    expect(values).toContain(ALIASES)
    expect(sql).not.toContain('injection')
  })

  const vaultEntries = [
    { name: 'Keep', keywords: ['Ward', 'ward'], aliases: ['Keep', 'keep '], priority: 2 },
  ]
  const STORED_VAULT_ENTRIES = JSON.stringify([
    { name: 'Keep', keywords: ['Ward'], aliases: ['Keep'], priority: 2 },
  ])

  it('adding a vault lorebook', async () => {
    await database.addVaultLorebook({
      id: 'l1',
      name: 'Lore',
      description: null,
      entries: vaultEntries,
      tags: [],
      favorite: false,
      source: 'import',
      originalFilename: null,
      originalStoryId: null,
      metadata: null,
      createdAt: 1,
      updatedAt: 1,
    } as any)

    expect(lastCall()[1]).toContain(STORED_VAULT_ENTRIES)
  })

  it('updating a vault lorebook', async () => {
    await database.updateVaultLorebook('l1', { entries: vaultEntries as any })

    expect(lastCall()[1]).toContain(STORED_VAULT_ENTRIES)
  })
})
