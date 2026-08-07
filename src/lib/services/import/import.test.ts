/**
 * Tests for the import seam introduced for the native `.avt` importer: the image strategy, and
 * the compensating delete that stands in for a transaction.
 *
 * The structure/remapping behaviour itself is covered by `services/export.test.ts`, which goes
 * through the public entry point.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const calls = {
  stories: [] as any[],
  entries: [] as any[],
  images: [] as any[],
  deleted: [] as string[],
  characters: [] as any[],
  locations: [] as any[],
  items: [] as any[],
  storyBeats: [] as any[],
}
let failOnCreateStory = false

vi.mock('$lib/services/database', () => ({
  database: {
    createStory: vi.fn(async (s: any) => {
      if (failOnCreateStory) throw new Error('disk on fire')
      calls.stories.push(s)
    }),
    addStoryEntry: vi.fn(async (e: any) => void calls.entries.push(e)),
    createEmbeddedImage: vi.fn(async (i: any) => void calls.images.push(i)),
    deleteStory: vi.fn(async (id: string) => void calls.deleted.push(id)),
    addBranch: vi.fn(async () => {}),
    addCharacter: vi.fn(async (c: any) => void calls.characters.push(c)),
    addLocation: vi.fn(async (l: any) => void calls.locations.push(l)),
    addItem: vi.fn(async (i: any) => void calls.items.push(i)),
    addStoryBeat: vi.fn(async (b: any) => void calls.storyBeats.push(b)),
    addEntry: vi.fn(async () => {}),
    addChapter: vi.fn(async () => {}),
    createCheckpoint: vi.fn(async () => {}),
    updateBranch: vi.fn(async () => {}),
    setStoryCurrentBranch: vi.fn(async () => {}),
  },
}))

const { runImport, resolveImageMappings, buildIdMaps } = await import('./index')
const { importFromFile } = await import('./native')

beforeEach(() => {
  calls.stories.length = 0
  calls.entries.length = 0
  calls.images.length = 0
  calls.deleted.length = 0
  calls.characters.length = 0
  calls.locations.length = 0
  calls.items.length = 0
  calls.storyBeats.length = 0
  failOnCreateStory = false
  invoke.mockReset()
})

function sampleExport() {
  return {
    version: '1.8.0',
    exportedAt: 1,
    story: { id: 'story-old', title: 'T', settings: {} },
    entries: [
      {
        id: 'entry-1',
        type: 'narration',
        content: 'c',
        parentId: null,
        position: 0,
        reasoning: 'because the hero hesitated',
        suggestedActions: '[{"text":"Fight","type":"action"}]',
        // A realistic delta: almost every field in one is an entity id, and the import mints a
        // fresh id for every entity, so this is the shape that proves the remap happens.
        worldStateDelta: {
          classificationResult: { summary: 'the hero drew a blade' },
          previousState: {
            characters: [{ id: 'char-old', name: 'Ren', status: 'active', traits: [] }],
            locations: [{ id: 'loc-old', name: 'Cave', visited: true, current: true }],
            items: [{ id: 'item-old', name: 'Blade', quantity: 1, location: 'loc-old' }],
            storyBeats: [{ id: 'beat-old', title: 'Q', status: 'active' }],
            currentLocationId: 'loc-old',
            timeTracker: { years: 0, days: 1, hours: 2, minutes: 0 },
          },
          createdEntities: {
            characterIds: ['char-created'],
            locationIds: [],
            itemIds: [],
            storyBeatIds: [],
          },
        },
      },
    ],
    characters: [
      { id: 'char-old', name: 'Ren', traits: [] },
      { id: 'char-created', name: 'Shade', traits: [] },
    ],
    locations: [{ id: 'loc-old', name: 'Cave', connections: [] }],
    items: [{ id: 'item-old', name: 'Blade', location: 'loc-old' }],
    storyBeats: [{ id: 'beat-old', title: 'Q' }],
    embeddedImages: [
      { id: 'img-1', entryId: 'entry-1', imageData: 'BASE64', prompt: 'p', status: 'completed' },
      { id: 'img-orphan', entryId: 'gone', imageData: 'BASE64', prompt: 'p', status: 'completed' },
    ],
  } as any
}

describe('runImport — image strategy', () => {
  it('uses the inline path by default', async () => {
    const result = await runImport(sampleExport())

    expect(result.success).toBe(true)
    expect(calls.images).toHaveLength(1)
    expect(calls.images[0].imageData).toBe('BASE64')
  })

  it('lets a caller supply its own image strategy, and runs it after the structure', async () => {
    const order: string[] = []

    const result = await runImport(sampleExport(), {
      importImages: async (data, maps) => {
        // Entries must already exist: the image rows reference them by foreign key.
        expect(calls.entries).toHaveLength(1)
        // The strategy gets what it needs to place the rows itself.
        expect(data.embeddedImages).toHaveLength(2)
        expect(maps.newStoryId).toBe(calls.stories[0].id)
        order.push('images-after-structure')
      },
    })

    expect(result.success).toBe(true)
    expect(order).toEqual(['images-after-structure'])
    // The default inline path must not also run.
    expect(calls.images).toHaveLength(0)
  })
})

describe('runImport — rollback', () => {
  it('deletes the half-imported story when the image pass fails', async () => {
    const result = await runImport(sampleExport(), {
      importImages: async () => {
        throw new Error('native import blew up')
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('native import blew up')
    // Otherwise the user is left with a story whose pictures silently vanished.
    expect(calls.deleted).toEqual([calls.stories[0].id])
  })

  it('does not try to delete a story that was never created', async () => {
    failOnCreateStory = true

    const result = await runImport(sampleExport())

    expect(result.success).toBe(false)
    expect(calls.deleted).toEqual([])
  })

  it('deletes the half-imported story when a row fails inside importStructure itself', async () => {
    // Regression test: a failure partway through importStructure (e.g. a bad chapter row) used
    // to be missed by the rollback entirely, because `storyCreated` was only set true *after*
    // importStructure fully resolved. That left the story, its entries, and everything else
    // already written stuck in the database forever while `runImport` reported failure.
    const { database } = await import('$lib/services/database')
    vi.mocked(database.addChapter).mockRejectedValueOnce(new Error('FOREIGN KEY constraint failed'))

    const data = { ...sampleExport(), chapters: [{ id: 'chap-1', storyId: 'story-old' }] }
    const result = await runImport(data)

    expect(result.success).toBe(false)
    expect(result.error).toContain('FOREIGN KEY constraint failed')
    // The story row and the entry already written before the failure must not be left orphaned.
    expect(calls.deleted).toEqual([calls.stories[0].id])
  })

  it('reports the original failure even when the rollback itself fails', async () => {
    const { database } = await import('$lib/services/database')
    vi.mocked(database.deleteStory).mockRejectedValueOnce(new Error('rollback also failed'))

    const result = await runImport(sampleExport(), {
      importImages: async () => {
        throw new Error('the real cause')
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('the real cause')
  })
})

describe('runImport — entry fields', () => {
  it('carries reasoning, suggestedActions and worldStateDelta through to addStoryEntry', async () => {
    const result = await runImport(sampleExport())

    expect(result.success).toBe(true)
    expect(calls.entries[0].reasoning).toBe('because the hero hesitated')
    expect(calls.entries[0].suggestedActions).toBe('[{"text":"Fight","type":"action"}]')
    expect(calls.entries[0].worldStateDelta).not.toBeNull()
  })

  it('remaps every entity id inside worldStateDelta', async () => {
    const result = await runImport(sampleExport())
    expect(result.success).toBe(true)

    const delta = calls.entries[0].worldStateDelta
    const [charOld, charCreated] = calls.characters
    const [locOld] = calls.locations
    const [itemOld] = calls.items
    const [beatOld] = calls.storyBeats

    // Every id must be the freshly minted one, never the exporting install's.
    expect(delta.previousState.characters[0].id).toBe(charOld.id)
    expect(delta.previousState.locations[0].id).toBe(locOld.id)
    expect(delta.previousState.items[0].id).toBe(itemOld.id)
    expect(delta.previousState.storyBeats[0].id).toBe(beatOld.id)
    expect(delta.createdEntities.characterIds).toEqual([charCreated.id])

    // An item's `location` is a location id too.
    expect(delta.previousState.items[0].location).toBe(locOld.id)

    // The one that actually corrupts state when missed: `setCurrentLocation` clears `current` on
    // every location before matching this, so a stale id leaves the story with no location at all.
    expect(delta.previousState.currentLocationId).toBe(locOld.id)

    expect(JSON.stringify(delta)).not.toContain('-old')
    expect(JSON.stringify(delta)).not.toContain('char-created')

    // Non-id payload is carried through untouched.
    expect(delta.classificationResult).toEqual({ summary: 'the hero drew a blade' })
    expect(delta.previousState.timeTracker).toEqual({ years: 0, days: 1, hours: 2, minutes: 0 })
  })

  it("keeps the 'inventory' sentinel out of the delta's id remapping", async () => {
    const data = sampleExport()
    data.entries[0].worldStateDelta.previousState.items[0].location = 'inventory'

    const result = await runImport(data)

    expect(result.success).toBe(true)
    expect(calls.entries[0].worldStateDelta.previousState.items[0].location).toBe('inventory')
  })

  it('normalises a delta whose sub-objects are missing instead of failing the import', async () => {
    const data = sampleExport()
    data.entries[0].worldStateDelta = { classificationResult: { note: 'partial' } }

    const result = await runImport(data)

    expect(result.success).toBe(true)
    const delta = calls.entries[0].worldStateDelta
    expect(delta.previousState.characters).toEqual([])
    expect(delta.previousState.currentLocationId).toBeNull()
    expect(delta.createdEntities.itemIds).toEqual([])
  })

  it('imports an entry lacking all three fields without inventing values', async () => {
    const data = {
      ...sampleExport(),
      entries: [{ id: 'entry-1', type: 'narration', content: 'c', parentId: null, position: 0 }],
    }

    const result = await runImport(data)

    expect(result.success).toBe(true)
    // `reasoning` is optional-undefined on StoryEntry; the other two are nullable. Either way
    // `addStoryEntry` writes NULL, and regeneration still fires for a story with no choices.
    expect(calls.entries[0].reasoning).toBeUndefined()
    expect(calls.entries[0].suggestedActions).toBeNull()
    expect(calls.entries[0].worldStateDelta).toBeNull()
  })

  it('preserves the fields on entries belonging to a non-main branch', async () => {
    const data = {
      ...sampleExport(),
      branches: [
        {
          id: 'branch-1',
          storyId: 'story-old',
          name: 'side-quest',
          parentBranchId: null,
          forkEntryId: null,
          checkpointId: null,
          createdAt: 1,
        },
      ],
      entries: [
        {
          id: 'entry-1',
          type: 'narration',
          content: 'c',
          parentId: null,
          position: 0,
          branchId: 'branch-1',
          reasoning: 'branch reasoning',
          suggestedActions: '[{"text":"Explore","type":"move"}]',
          worldStateDelta: {
            classificationResult: {},
            previousState: {
              characters: [],
              locations: [],
              items: [],
              storyBeats: [],
              currentLocationId: 'loc-old',
              timeTracker: null,
            },
            createdEntities: {
              characterIds: [],
              locationIds: [],
              itemIds: [],
              storyBeatIds: [],
            },
          },
        },
      ],
    }

    const result = await runImport(data)

    expect(result.success).toBe(true)
    expect(calls.entries[0].branchId).not.toBeNull()
    expect(calls.entries[0].reasoning).toBe('branch reasoning')
    expect(calls.entries[0].suggestedActions).toBe('[{"text":"Explore","type":"move"}]')
    // The remap is not skipped just because the entry sits on a branch.
    expect(calls.entries[0].worldStateDelta.previousState.currentLocationId).toBe(
      calls.locations[0].id,
    )
  })
})

describe('resolveImageMappings', () => {
  it('maps images to their imported entry and drops the ones whose entry is gone', () => {
    const data = sampleExport()
    const maps = buildIdMaps(data)

    const mapping = resolveImageMappings(data, maps)

    expect(mapping).toHaveLength(1)
    expect(mapping[0].oldImageId).toBe('img-1')
    expect(mapping[0].newEntryId).toBe(maps.oldToNewId.get('entry-1'))
  })
})

describe('importFromFile', () => {
  it('reads the structure natively, then hands the payloads back to the native side', async () => {
    const light = sampleExport()
    // What Rust returns: the same JSON minus every imageData.
    for (const image of light.embeddedImages) delete image.imageData

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'avt_read_light') return JSON.stringify(light)
      if (cmd === 'avt_import_images') return 1
      throw new Error(`unexpected command ${cmd}`)
    })

    const result = await importFromFile('/tmp/story.avt')

    expect(result.success).toBe(true)

    const [readCmd, readArgs] = invoke.mock.calls[0]
    expect(readCmd).toBe('avt_read_light')
    expect(readArgs).toEqual({ srcPath: '/tmp/story.avt' })

    const [importCmd, importArgs] = invoke.mock.calls[1]
    expect(importCmd).toBe('avt_import_images')
    expect(importArgs.srcPath).toBe('/tmp/story.avt')
    expect(importArgs.storyId).toBe(result.storyId)
    // Only the orphan-free mapping crosses the bridge — and no base64 with it.
    expect(importArgs.mapping).toEqual([{ oldImageId: 'img-1', newEntryId: calls.entries[0].id }])
    expect(JSON.stringify(importArgs)).not.toContain('BASE64')

    // The inline path must not have run: that is what would put payloads in the JS heap.
    expect(calls.images).toHaveLength(0)
  })

  it('does not call the native image pass when the story has no images', async () => {
    const light = { ...sampleExport(), embeddedImages: [] }
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'avt_read_light') return JSON.stringify(light)
      throw new Error(`unexpected command ${cmd}`)
    })

    const result = await importFromFile('/tmp/story.avt')

    expect(result.success).toBe(true)
    expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['avt_read_light'])
  })

  it('rolls the story back when the native image pass fails', async () => {
    const light = sampleExport()
    for (const image of light.embeddedImages) delete image.imageData

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'avt_read_light') return JSON.stringify(light)
      throw new Error('SQLITE_BUSY')
    })

    const result = await importFromFile('/tmp/story.avt')

    expect(result.success).toBe(false)
    expect(result.error).toContain('SQLITE_BUSY')
    expect(calls.deleted).toEqual([calls.stories[0].id])
  })
})
