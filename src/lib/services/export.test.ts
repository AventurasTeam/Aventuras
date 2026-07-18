/**
 * Characterization tests for story import.
 *
 * These lock in the CURRENT behaviour of `importFromContent` before the native `.avt` importer
 * refactor, so that work can be judged by "these still pass" rather than by inspection. They
 * deliberately go through the public entry point rather than any internal helper: the internals
 * are about to be extracted into `services/import/`, and tests pinned to internals would have to
 * be rewritten by the very change they are supposed to guard.
 *
 * The id remapping is the fiddly part (COW `overridesId`, topological branch insertion, FK-safe
 * fallbacks), so that is where the assertions are concentrated. Nothing here asserts on literal
 * UUIDs — only on the *relationships* between them, which is what the remapping actually promises.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// The service imports Tauri plugins at module scope; none are reachable from importFromContent,
// but they must resolve for the module to load under Node.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const dialogOpen = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => dialogOpen(...a) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn(), readTextFile: vi.fn() }))
const importFromFile = vi.fn()
vi.mock('$lib/services/import/native', () => ({
  importFromFile: (...a: unknown[]) => importFromFile(...a),
}))
vi.mock('$lib/services/exportTarget', () => ({ resolveSaveTarget: vi.fn() }))

/** Records every write the import performs, so tests can assert on the resulting graph. */
const calls = {
  stories: [] as any[],
  entries: [] as any[],
  branches: [] as any[],
  characters: [] as any[],
  locations: [] as any[],
  items: [] as any[],
  beats: [] as any[],
  lorebook: [] as any[],
  chapters: [] as any[],
  checkpoints: [] as any[],
  images: [] as any[],
  branchUpdates: [] as any[],
  currentBranch: [] as any[],
}

vi.mock('$lib/services/database', () => ({
  database: {
    createStory: vi.fn(async (s: any) => void calls.stories.push(s)),
    addStoryEntry: vi.fn(async (e: any) => void calls.entries.push(e)),
    addBranch: vi.fn(async (b: any) => void calls.branches.push(b)),
    addCharacter: vi.fn(async (c: any) => void calls.characters.push(c)),
    addLocation: vi.fn(async (l: any) => void calls.locations.push(l)),
    addItem: vi.fn(async (i: any) => void calls.items.push(i)),
    addStoryBeat: vi.fn(async (b: any) => void calls.beats.push(b)),
    addEntry: vi.fn(async (e: any) => void calls.lorebook.push(e)),
    addChapter: vi.fn(async (c: any) => void calls.chapters.push(c)),
    createCheckpoint: vi.fn(async (c: any) => void calls.checkpoints.push(c)),
    createEmbeddedImage: vi.fn(async (i: any) => void calls.images.push(i)),
    updateBranch: vi.fn(async (id: string, u: any) => void calls.branchUpdates.push({ id, ...u })),
    setStoryCurrentBranch: vi.fn(
      async (s: string, b: string) => void calls.currentBranch.push({ s, b }),
    ),
  },
}))

// Imported after the mocks are registered.
const { exportService } = await import('./export')

beforeEach(() => {
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key].length = 0
  dialogOpen.mockReset()
  importFromFile.mockReset()
})

/** A minimal but valid export: one narration entry, nothing else. */
function baseExport(overrides: Record<string, any> = {}) {
  return {
    version: '1.7.0',
    exportedAt: 1_700_000_000_000,
    story: {
      id: 'story-old',
      title: 'The Old Story',
      description: 'desc',
      genre: 'fantasy',
      mode: 'adventure',
      settings: {},
      memoryConfig: null,
      timeTracker: null,
      currentBgImage: null,
    },
    entries: [
      {
        id: 'entry-1',
        type: 'narration',
        content: 'Once upon a time',
        parentId: null,
        position: 0,
      },
    ],
    ...overrides,
  }
}

const json = (data: unknown) => JSON.stringify(data)

describe('importFromAventura — reads the picked file natively', () => {
  // Regression guard: the Library's Import button used to read the file with an <input
  // type="file"> and file.text(). That materialises the whole .avt as a JS string, and V8 caps a
  // string at 2^29-24 bytes (~512 MiB) — a real 546 MB export failed with a misleading
  // "not a valid JSON file", because the read silently never delivered the whole file.
  // The native reader has no such ceiling, so nothing may route around it.
  it('hands the picked path to the native reader instead of reading it in JS', async () => {
    dialogOpen.mockResolvedValue('/sdcard/yuka.avt')
    importFromFile.mockResolvedValue({ success: true, storyId: 'new-id' })

    const result = await exportService.importFromAventura()

    expect(importFromFile).toHaveBeenCalledWith('/sdcard/yuka.avt')
    expect(result).toEqual({ success: true, storyId: 'new-id' })
  })

  it('does nothing when the picker is dismissed', async () => {
    dialogOpen.mockResolvedValue(null)

    const result = await exportService.importFromAventura()

    expect(result).toEqual({ success: false })
    expect(importFromFile).not.toHaveBeenCalled()
  })

  it('surfaces a native read failure as an error message', async () => {
    dialogOpen.mockResolvedValue('/sdcard/yuka.avt')
    importFromFile.mockRejectedValue('failed to open source: permission denied')

    const result = await exportService.importFromAventura()

    expect(result.success).toBe(false)
    expect(result.error).toContain('permission denied')
  })
})

describe('importFromContent — validation', () => {
  it('rejects content that is not JSON', async () => {
    const result = await exportService.importFromContent('definitely not json {{{')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Not a valid JSON file')
    expect(calls.stories).toHaveLength(0)
  })

  it('rejects a JSON file that is not an Aventura export', async () => {
    const result = await exportService.importFromContent(json({ hello: 'world' }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing required fields')
  })

  it('rejects an export with no entries', async () => {
    const result = await exportService.importFromContent(json(baseExport({ entries: [] })))
    expect(result.success).toBe(false)
    expect(result.error).toContain('no story entries')
  })
})

describe('importFromContent — version compatibility warnings', () => {
  it('does not warn about missing features when importing a file this app just wrote', async () => {
    // The exporter stamps EXPORT_FORMAT_VERSION into `version`, and the importer warns for
    // anything older than each feature. A file we wrote ourselves therefore must not warn about
    // anything: if it does, the stamped version has fallen behind the feature checks.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const currentVersion = (exportService as any).VERSION
      const data = baseExport({
        version: currentVersion,
        story: { ...baseExport().story, currentBgImage: 'BG_BASE64' },
      })

      await exportService.importFromContent(json(data))

      const importWarnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((msg) => msg.startsWith('[Import]'))
      expect(importWarnings).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('restores the background image carried on the story record', async () => {
    const data = baseExport({ story: { ...baseExport().story, currentBgImage: 'BG_BASE64' } })
    await exportService.importFromContent(json(data))
    expect(calls.stories[0].currentBgImage).toBe('BG_BASE64')
  })

  it('still warns for a genuinely old file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await exportService.importFromContent(json(baseExport({ version: '1.0.0' })))
      const importWarnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((msg) => msg.startsWith('[Import]'))
      expect(importWarnings.length).toBeGreaterThan(0)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('importFromContent — story identity', () => {
  it('gives the story a fresh id and marks the title as imported', async () => {
    const result = await exportService.importFromContent(json(baseExport()))

    expect(result.success).toBe(true)
    expect(calls.stories).toHaveLength(1)
    expect(calls.stories[0].id).not.toBe('story-old')
    expect(result.storyId).toBe(calls.stories[0].id)
    expect(calls.stories[0].title).toBe('The Old Story (Imported)')
  })

  it('keeps the original title when the suffix is skipped (sync path)', async () => {
    await exportService.importFromContent(json(baseExport()), true)
    expect(calls.stories[0].title).toBe('The Old Story')
  })

  it('clears retry state on import', async () => {
    await exportService.importFromContent(json(baseExport()))
    expect(calls.stories[0].retryState).toBeNull()
  })
})

describe('importFromContent — entry remapping', () => {
  it('remaps entry ids and keeps parent links pointing at the remapped parents', async () => {
    const data = baseExport({
      entries: [
        { id: 'e1', type: 'narration', content: 'first', parentId: null, position: 0 },
        { id: 'e2', type: 'action', content: 'second', parentId: 'e1', position: 1 },
        { id: 'e3', type: 'narration', content: 'third', parentId: 'e2', position: 2 },
      ],
    })

    await exportService.importFromContent(json(data))

    const [e1, e2, e3] = calls.entries
    // Every id is fresh...
    for (const e of calls.entries) expect(['e1', 'e2', 'e3']).not.toContain(e.id)
    // ...and the chain still hangs together after remapping.
    expect(e1.parentId).toBeNull()
    expect(e2.parentId).toBe(e1.id)
    expect(e3.parentId).toBe(e2.id)
    // All entries belong to the new story.
    for (const e of calls.entries) expect(e.storyId).toBe(calls.stories[0].id)
  })

  it('preserves entry content and position verbatim', async () => {
    await exportService.importFromContent(json(baseExport()))
    expect(calls.entries[0].content).toBe('Once upon a time')
    expect(calls.entries[0].position).toBe(0)
  })
})

describe('importFromContent — branches', () => {
  it('inserts parent branches before their children', async () => {
    // Order matters here: the implementation walks `pending` BACKWARDS, so listing the root first
    // is what makes it reach the child first and forces the topological guard to do the work.
    // (Listing child-first would pass even with the guard removed — verified by mutation.)
    const data = baseExport({
      branches: [
        { id: 'b-root', name: 'root', parentBranchId: null, forkEntryId: 'entry-1' },
        { id: 'b-child', name: 'child', parentBranchId: 'b-root', forkEntryId: 'entry-1' },
      ],
    })

    await exportService.importFromContent(json(data))

    expect(calls.branches).toHaveLength(2)
    const [first, second] = calls.branches
    expect(first.name).toBe('root')
    expect(second.name).toBe('child')
    expect(second.parentBranchId).toBe(first.id)
  })

  it('still inserts a branch whose parent is missing, rather than dropping it', async () => {
    const data = baseExport({
      branches: [
        { id: 'b-orphan', name: 'orphan', parentBranchId: 'nope', forkEntryId: 'entry-1' },
      ],
    })

    await exportService.importFromContent(json(data))

    expect(calls.branches).toHaveLength(1)
    expect(calls.branches[0].parentBranchId).toBeNull()
  })

  it('remaps forkEntryId onto the imported entry', async () => {
    const data = baseExport({
      branches: [{ id: 'b1', name: 'b', parentBranchId: null, forkEntryId: 'entry-1' }],
    })

    await exportService.importFromContent(json(data))

    expect(calls.branches[0].forkEntryId).toBe(calls.entries[0].id)
    expect(calls.branches[0].forkEntryId).not.toBe('entry-1')
  })
})

describe('importFromContent — world state', () => {
  it('resolves COW overridesId to the remapped entity', async () => {
    const data = baseExport({
      characters: [
        { id: 'c-base', name: 'Base', description: '', traits: [], overridesId: null },
        { id: 'c-override', name: 'Override', description: '', traits: [], overridesId: 'c-base' },
      ],
    })

    await exportService.importFromContent(json(data))

    const base = calls.characters.find((c) => c.name === 'Base')
    const override = calls.characters.find((c) => c.name === 'Override')
    expect(base.overridesId).toBeNull()
    expect(override.overridesId).toBe(base.id)
    expect(override.overridesId).not.toBe('c-base')
  })

  it('nulls an overridesId that points at nothing, never keeping the stale id', async () => {
    const data = baseExport({
      characters: [{ id: 'c1', name: 'Ghost', description: '', traits: [], overridesId: 'gone' }],
    })

    await exportService.importFromContent(json(data))

    expect(calls.characters[0].overridesId).toBeNull()
  })

  it('remaps location connections onto the imported locations', async () => {
    const data = baseExport({
      locations: [
        {
          id: 'l1',
          name: 'Town',
          description: '',
          visited: true,
          current: true,
          connections: ['l2'],
        },
        {
          id: 'l2',
          name: 'Forest',
          description: '',
          visited: false,
          current: false,
          connections: ['l1'],
        },
      ],
    })

    await exportService.importFromContent(json(data))

    const town = calls.locations.find((l) => l.name === 'Town')
    const forest = calls.locations.find((l) => l.name === 'Forest')
    expect(town.connections).toEqual([forest.id])
    expect(forest.connections).toEqual([town.id])
  })

  it('remaps an item location but leaves the "inventory" sentinel alone', async () => {
    const data = baseExport({
      locations: [
        { id: 'l1', name: 'Town', description: '', visited: true, current: true, connections: [] },
      ],
      items: [
        {
          id: 'i1',
          name: 'Sword',
          description: '',
          quantity: 1,
          equipped: false,
          location: 'inventory',
        },
        { id: 'i2', name: 'Statue', description: '', quantity: 1, equipped: false, location: 'l1' },
      ],
    })

    await exportService.importFromContent(json(data))

    const sword = calls.items.find((i) => i.name === 'Sword')
    const statue = calls.items.find((i) => i.name === 'Statue')
    expect(sword.location).toBe('inventory')
    expect(statue.location).toBe(calls.locations[0].id)
  })
})

describe('importFromContent — checkpoints', () => {
  /** A checkpoint carrying a snapshot of one chapter, which the import must remap. */
  function exportWithCheckpointChapter() {
    const chapter = {
      id: 'chap-1',
      number: 1,
      title: 'Chapter One',
      startEntryId: 'entry-1',
      endEntryId: 'entry-1',
      entryCount: 1,
      summary: 's',
      keywords: [],
      characters: [],
      locations: [],
      plotThreads: [],
      branchId: null,
      createdAt: 1,
    }
    return baseExport({
      chapters: [chapter],
      checkpoints: [
        {
          id: 'cp-1',
          name: 'A checkpoint',
          lastEntryId: 'entry-1',
          lastEntryPreview: 'p',
          entryCount: 1,
          entriesSnapshot: [],
          charactersSnapshot: [],
          locationsSnapshot: [],
          itemsSnapshot: [],
          storyBeatsSnapshot: [],
          chaptersSnapshot: [chapter],
          timeTrackerSnapshot: null,
          createdAt: 1,
        },
      ],
    })
  }

  it('remaps the chapter id in a checkpoint snapshot to the imported chapter', async () => {
    await exportService.importFromContent(json(exportWithCheckpointChapter()))

    const importedChapter = calls.chapters[0]
    const snapshotChapter = calls.checkpoints[0].chaptersSnapshot[0]

    expect(importedChapter.id).not.toBe('chap-1')
    // A snapshot pointing at an id that no longer exists would restore a phantom chapter.
    expect(snapshotChapter.id).toBe(importedChapter.id)
  })
})

describe('importFromContent — embedded images', () => {
  it('attaches images to the remapped entry and gives them fresh ids', async () => {
    const data = baseExport({
      embeddedImages: [
        {
          id: 'img-1',
          entryId: 'entry-1',
          sourceText: 'src',
          prompt: 'a castle',
          styleId: 'style',
          model: 'flux',
          imageData: 'BASE64DATA',
          status: 'completed',
        },
      ],
    })

    await exportService.importFromContent(json(data))

    expect(calls.images).toHaveLength(1)
    expect(calls.images[0].id).not.toBe('img-1')
    expect(calls.images[0].entryId).toBe(calls.entries[0].id)
    expect(calls.images[0].storyId).toBe(calls.stories[0].id)
    expect(calls.images[0].imageData).toBe('BASE64DATA')
  })

  it('skips an image whose entry is not in the export, instead of failing the import', async () => {
    const data = baseExport({
      embeddedImages: [
        {
          id: 'img-orphan',
          entryId: 'entry-that-does-not-exist',
          sourceText: '',
          prompt: '',
          styleId: '',
          model: '',
          imageData: 'X',
          status: 'completed',
        },
      ],
    })

    const result = await exportService.importFromContent(json(data))

    expect(result.success).toBe(true)
    expect(calls.images).toHaveLength(0)
  })
})
