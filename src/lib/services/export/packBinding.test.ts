/**
 * What an exported story says about its prompt pack.
 *
 * Two properties matter and pull in opposite directions: the file must carry enough for a
 * recipient to re-establish the binding, and it must carry none of the pack's template content —
 * a story is not a pack-distribution channel, and receiving one must not fork the recipient's
 * templates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn(async (_cmd: string, _args: { storyJson: string }) => 'ok')
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: { storyJson: string }) => invoke(cmd, args),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn(), readTextFile: vi.fn() }))
vi.mock('$lib/services/import/native', () => ({ importFromFile: vi.fn() }))
vi.mock('$lib/services/exportTarget', () => ({
  resolveSaveTarget: vi.fn(async () => ({ destPath: '/tmp/out.avt' })),
}))

const SECRET_TEMPLATE = 'You are a grim narrator. Never break character.'

const db = {
  storyPackId: 'pack-local' as string | null,
  pack: {
    id: 'pack-local',
    name: 'Grimdark',
    description: 'Bleak',
    author: 'Ada',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  } as Record<string, unknown> | null,
  variables: [] as Record<string, unknown>[],
  runtimeVariables: [] as Record<string, unknown>[],
  customVariableValues: null as Record<string, string> | null,
}

vi.mock('$lib/services/database', () => ({
  database: {
    getStoryEntries: vi.fn(async () => []),
    getCharacters: vi.fn(async () => []),
    getLocations: vi.fn(async () => []),
    getItems: vi.fn(async () => []),
    getStoryBeats: vi.fn(async () => []),
    getEntries: vi.fn(async () => []),
    getEmbeddedImageMetaForStory: vi.fn(async () => []),
    getCheckpoints: vi.fn(async () => []),
    getBranches: vi.fn(async () => []),
    getChapters: vi.fn(async () => []),
    getStoryPackId: vi.fn(async () => db.storyPackId),
    getPack: vi.fn(async () => db.pack),
    getPackVariables: vi.fn(async () => db.variables),
    getRuntimeVariables: vi.fn(async () => db.runtimeVariables),
    getStoryCustomVariables: vi.fn(async () => db.customVariableValues),
    // Templates exist on the pack, and gatherStoryData must never reach for them.
    getPackTemplates: vi.fn(async () => [{ templateId: 'adventure', content: SECRET_TEMPLATE }]),
  },
}))

const { gatherStoryData, exportService } = await import('$lib/services/export')

beforeEach(() => {
  invoke.mockClear()
  db.storyPackId = 'pack-local'
  db.pack = {
    id: 'pack-local',
    name: 'Grimdark',
    description: 'Bleak',
    author: 'Ada',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
  }
  db.variables = [
    {
      id: 'var-1',
      packId: 'pack-local',
      variableName: 'writing_style',
      displayName: 'Writing Style',
      variableType: 'enum',
      isRequired: true,
      sortOrder: 0,
      defaultValue: 'terse',
      enumOptions: [{ label: 'Terse', value: 'terse' }],
      createdAt: 0,
    },
  ]
  db.runtimeVariables = [
    {
      id: 'rv-1',
      packId: 'pack-local',
      entityType: 'character',
      variableName: 'morale',
      displayName: 'Morale',
      variableType: 'number',
      minValue: 0,
      maxValue: 10,
      color: '#fff',
      pinned: false,
      sortOrder: 0,
      createdAt: 0,
    },
  ]
  db.customVariableValues = { writing_style: 'terse' }
})

describe('gatherStoryData — packBinding', () => {
  it('records the pack identity, the story answers and the definitions', async () => {
    const { packBinding } = await gatherStoryData('s1')

    expect(packBinding?.pack).toEqual({ name: 'Grimdark', author: 'Ada' })
    expect(packBinding?.customVariableValues).toEqual({ writing_style: 'terse' })
    expect(packBinding?.variables).toEqual([
      {
        variableName: 'writing_style',
        displayName: 'Writing Style',
        description: undefined,
        variableType: 'enum',
        isRequired: true,
        sortOrder: 0,
        defaultValue: 'terse',
        enumOptions: [{ label: 'Terse', value: 'terse' }],
      },
    ])
    expect(packBinding?.runtimeVariables).toEqual([
      {
        entityType: 'character',
        variableName: 'morale',
        displayName: 'Morale',
        description: undefined,
        variableType: 'number',
        defaultValue: undefined,
        minValue: 0,
        maxValue: 10,
        enumOptions: undefined,
      },
    ])
  })

  it('carries no definition ids', async () => {
    // Ids are per-device. Exporting them invites a future matcher to trust one, which is the
    // exact bug this whole change exists to undo.
    const { packBinding } = await gatherStoryData('s1')
    const serialized = JSON.stringify(packBinding)
    expect(serialized).not.toContain('var-1')
    expect(serialized).not.toContain('rv-1')
    expect(serialized).not.toContain('pack-local')
  })

  it('records no pack when the story has none', async () => {
    db.storyPackId = null
    await expect(gatherStoryData('s1')).resolves.toMatchObject({ packBinding: null })
  })

  it('records no pack when the story points at a pack row that is gone', async () => {
    db.pack = null
    await expect(gatherStoryData('s1')).resolves.toMatchObject({ packBinding: null })
  })
})

describe('exportToAventura — packBinding', () => {
  /** The JSON the native writer was handed. */
  async function exportedFile(packBinding: unknown) {
    await exportService.exportToAventura(
      { id: 's1', title: 'T', styleReviewState: null } as never,
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      null,
      packBinding as never,
    )
    return invoke.mock.calls[0][1].storyJson
  }

  it('writes the binding it was given, and no template text', async () => {
    const { packBinding } = await gatherStoryData('s1')

    const json = await exportedFile(packBinding)

    expect(JSON.parse(json).packBinding).toEqual(packBinding)
    expect(json).not.toContain(SECRET_TEMPLATE)
    expect(json).not.toContain('Never break character')
  })

  it('omits the field entirely for a story with no pack, rather than writing null', async () => {
    // A file with `packBinding: null` and one with no such key must import identically, and the
    // cheapest way to guarantee that is to emit only the legacy shape.
    const json = await exportedFile(null)
    expect(Object.keys(JSON.parse(json))).not.toContain('packBinding')
  })
})
