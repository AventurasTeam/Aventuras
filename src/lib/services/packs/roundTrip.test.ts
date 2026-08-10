/**
 * The whole point of the change, end to end: a story written on a custom pack, exported, and
 * imported onto a device where "the same pack" is a different row with a different id.
 *
 * The unit tests either side of this one each pin half of it. What they cannot show is that the
 * two halves agree — that what the exporter chose to record is exactly what the importer needs,
 * and that a value written on one device is readable on the other without anything in between
 * knowing an id.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PresetPack, RuntimeVariable, RuntimeVarsMap } from './types'

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

/** Definitions for one pack, differing only in the ids — which is the entire problem. */
function runtimeVar(id: string, packId: string): RuntimeVariable {
  return {
    id,
    packId,
    entityType: 'character',
    variableName: 'morale',
    displayName: 'Morale',
    variableType: 'number',
    color: '#fff',
    pinned: false,
    sortOrder: 0,
    createdAt: 0,
  }
}

function pack(id: string, name: string, author: string | null): PresetPack {
  return {
    id,
    name,
    description: null,
    author,
    isDefault: id === 'default-pack',
    createdAt: 0,
    updatedAt: 0,
  }
}

/** The source device: one custom pack, one story bound to it, one character with a value. */
const SOURCE = {
  packId: 'source-side-uuid',
  runtimeVars: [runtimeVar('source-morale-uuid', 'source-side-uuid')],
}

/** The receiving device: the same pack by name and author, every id different. */
const local = {
  packs: [] as PresetPack[],
  runtimeVarsByPack: new Map<string, RuntimeVariable[]>(),
}

const written = {
  stories: [] as any[],
  characters: [] as any[],
}

vi.mock('$lib/services/database', () => ({
  database: {
    // --- export side ---
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
    getStoryPackId: vi.fn(async () => SOURCE.packId),
    getPack: vi.fn(async () => pack(SOURCE.packId, 'Grimdark', 'Ada')),
    getPackVariables: vi.fn(async () => []),
    getStoryCustomVariables: vi.fn(async () => ({ writing_style: 'terse' })),
    // --- import side ---
    getAllPacks: vi.fn(async () => local.packs),
    getRuntimeVariables: vi.fn(async (packId: string) => {
      // Called for the source pack during export, and for the target pack during import.
      if (packId === SOURCE.packId) return SOURCE.runtimeVars
      return local.runtimeVarsByPack.get(packId) ?? []
    }),
    createStory: vi.fn(async (s: any) => void written.stories.push(s)),
    addStoryEntry: vi.fn(async () => {}),
    addCharacter: vi.fn(async (c: any) => void written.characters.push(c)),
    addLocation: vi.fn(async () => {}),
    addItem: vi.fn(async () => {}),
    addStoryBeat: vi.fn(async () => {}),
    addEntry: vi.fn(async () => {}),
    addChapter: vi.fn(async () => {}),
    addBranch: vi.fn(async () => {}),
    createCheckpoint: vi.fn(async () => {}),
    createEmbeddedImage: vi.fn(async () => {}),
    updateBranch: vi.fn(async () => {}),
    setStoryCurrentBranch: vi.fn(async () => {}),
    deleteStory: vi.fn(async () => {}),
  },
}))

const { gatherStoryData } = await import('../export/ExportCoordinationService')
const { exportService } = await import('../export')
const { runImport } = await import('../import')
const { remapRuntimeVars } = await import('./binding')

beforeEach(() => {
  invoke.mockClear()
  written.stories.length = 0
  written.characters.length = 0
  local.packs = [pack('default-pack', 'Default', 'Aventuras')]
  local.runtimeVarsByPack = new Map()
})

/** Export a story carrying one character with a morale value, and return the file's JSON. */
async function exportStory() {
  const data = await gatherStoryData('story-1')
  await exportService.exportToAventura(
    { id: 'story-1', title: 'Yuka', styleReviewState: null, settings: {} } as never,
    [{ id: 'entry-1', type: 'narration', content: 'c', parentId: null, position: 0 }] as never,
    [
      {
        id: 'char-1',
        name: 'Yuka',
        metadata: { runtimeVars: { 'source-morale-uuid': { variableName: 'morale', v: 7 } } },
      },
    ] as never,
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    null,
    data.packBinding,
  )
  return JSON.parse(invoke.mock.calls[0][1].storyJson)
}

describe('export -> import against the same pack under a different id', () => {
  it('binds the story and makes the character values readable under the local definition', async () => {
    // The receiving device installed the same pack from the same .prompt.json, so it matches by
    // name and author and by nothing else — its ids were minted locally.
    local.packs.push(pack('target-side-uuid', 'Grimdark', 'Ada'))
    local.runtimeVarsByPack.set('target-side-uuid', [
      runtimeVar('target-morale-uuid', 'target-side-uuid'),
    ])

    const file = await exportStory()
    const result = await runImport(file)

    expect(result.success).toBe(true)
    expect(written.stories[0]).toMatchObject({
      packId: 'target-side-uuid',
      customVariableValues: { writing_style: 'terse' },
    })

    // What the world panels and ContextBuilder read: the local definition's id.
    const runtimeVars = written.characters[0].metadata.runtimeVars as RuntimeVarsMap
    expect(runtimeVars['target-morale-uuid']).toEqual({ variableName: 'morale', v: 7 })
  })

  it('carries no template content across', async () => {
    local.packs.push(pack('target-side-uuid', 'Grimdark', 'Ada'))
    const file = await exportStory()
    // The receiving device's own pack narrates. Nothing in the file can change that, because
    // there is nothing in it to change it with.
    expect(JSON.stringify(file.packBinding)).not.toMatch(/content|template/i)
  })
})

describe('the retention that makes a later re-binding possible', () => {
  it('keeps every key, so binding to another pack loses no earlier values', async () => {
    local.packs.push(pack('target-side-uuid', 'Grimdark', 'Ada'))
    local.runtimeVarsByPack.set('target-side-uuid', [
      runtimeVar('target-morale-uuid', 'target-side-uuid'),
    ])

    const file = await exportStory()
    await runImport(file)
    const imported = written.characters[0].metadata

    // Re-bind to a third pack that also defines "morale" for characters...
    const other = [runtimeVar('other-morale-uuid', 'other-pack')]
    const onOther = remapRuntimeVars(
      imported,
      'character',
      file.packBinding.runtimeVariables,
      other,
    )
    expect((onOther.runtimeVars as RuntimeVarsMap)['other-morale-uuid']).toEqual({
      variableName: 'morale',
      v: 7,
    })

    // ...and back. The key the story was readable under before the detour is still there, which
    // is what "no earlier value is destroyed" actually means in storage terms.
    const backHome = remapRuntimeVars(
      onOther,
      'character',
      file.packBinding.runtimeVariables,
      local.runtimeVarsByPack.get('target-side-uuid')!,
    )
    const finalVars = backHome.runtimeVars as RuntimeVarsMap
    expect(finalVars['target-morale-uuid']).toEqual({ variableName: 'morale', v: 7 })
    expect(finalVars['other-morale-uuid']).toEqual({ variableName: 'morale', v: 7 })
    expect(finalVars['source-morale-uuid']).toEqual({ variableName: 'morale', v: 7 })
  })
})
