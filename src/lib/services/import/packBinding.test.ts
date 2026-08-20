/**
 * The pack decision inside `runImport`.
 *
 * Three behaviours carry the weight here. A story must never land bound to a pack nobody chose;
 * a file that named nothing must import exactly as it did before this existed, flag and all
 * (that is: no flag); and a cancel must be free, which is only true while the callback runs
 * ahead of the first write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PresetPack, RuntimeVariable, RuntimeVarsMap } from '$lib/services/packs/types'
import type { MatchConfidence } from '$lib/services/packs/binding'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const db = {
  packs: [] as PresetPack[],
  runtimeVars: [] as RuntimeVariable[],
  packVariables: [] as unknown[],
}

const calls = {
  stories: [] as any[],
  entries: [] as any[],
  characters: [] as any[],
  locations: [] as any[],
  items: [] as any[],
  beats: [] as any[],
  checkpoints: [] as any[],
  deleted: [] as string[],
}

vi.mock('$lib/services/database', () => ({
  database: {
    createStory: vi.fn(async (s: any) => void calls.stories.push(s)),
    addStoryEntry: vi.fn(async (e: any) => void calls.entries.push(e)),
    addCharacter: vi.fn(async (c: any) => void calls.characters.push(c)),
    addLocation: vi.fn(async (l: any) => void calls.locations.push(l)),
    addItem: vi.fn(async (i: any) => void calls.items.push(i)),
    addStoryBeat: vi.fn(async (b: any) => void calls.beats.push(b)),
    addEntry: vi.fn(async () => {}),
    addChapter: vi.fn(async () => {}),
    addBranch: vi.fn(async () => {}),
    createCheckpoint: vi.fn(async (c: any) => void calls.checkpoints.push(c)),
    createEmbeddedImage: vi.fn(async () => {}),
    updateBranch: vi.fn(async () => {}),
    setStoryCurrentBranch: vi.fn(async () => {}),
    deleteStory: vi.fn(async (id: string) => void calls.deleted.push(id)),
    getAllPacks: vi.fn(async () => db.packs),
    getRuntimeVariables: vi.fn(async () => db.runtimeVars),
    getPackVariables: vi.fn(async () => db.packVariables),
  },
}))

const {
  runImport,
  decidePackPrompt,
  planPackBinding,
  buildBindingContext,
  mergeCustomVariableValues,
} = await import('./index')
const { importFromFile } = await import('./native')

function pack(overrides: Partial<PresetPack>): PresetPack {
  return {
    id: 'p',
    name: 'Grimdark',
    description: null,
    author: 'Ada',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

/** A file whose characters carry a runtime value keyed by the *source* device's definition id. */
function sampleExport(packBinding?: unknown) {
  return {
    version: '1.9.0',
    exportedAt: 1,
    story: { id: 'story-old', title: 'T', settings: { tone: 'wry' } },
    entries: [{ id: 'entry-1', type: 'narration', content: 'c', parentId: null, position: 0 }],
    characters: [
      {
        id: 'char-1',
        name: 'Yuka',
        connections: [],
        metadata: { runtimeVars: { 'src-morale': { variableName: 'morale', v: 7 } } },
      },
    ],
    ...(packBinding === undefined ? {} : { packBinding }),
  } as any
}

const namedBinding = {
  pack: { name: 'Grimdark', author: 'Ada' },
  customVariableValues: { writing_style: 'terse' },
  runtimeVariables: [{ entityType: 'character', variableName: 'morale', variableType: 'number' }],
}

beforeEach(() => {
  for (const key of Object.keys(calls) as (keyof typeof calls)[]) calls[key].length = 0
  db.packs = [pack({ id: 'default-pack', name: 'Default', author: 'Aventuras', isDefault: true })]
  db.runtimeVars = []
  db.packVariables = []
  invoke.mockReset()
})

describe('runImport — resolving the pack binding', () => {
  it('binds to a local pack whose name and author match the file', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))

    const result = await runImport(sampleExport(namedBinding))

    expect(result.success).toBe(true)
    expect(calls.stories[0]).toMatchObject({
      packId: 'local-grimdark',
      customVariableValues: { writing_style: 'terse' },
    })
  })

  it('falls back to the built-in pack when nobody is there to ask', async () => {
    // No resolver supplied, so the headless fallback answers. Both real callers are interactive
    // and would have prompted instead; this is what a caller with no user attached produces.
    const result = await runImport(sampleExport(namedBinding))

    expect(result.success).toBe(true)
    expect(calls.stories[0].packId).toBe('default-pack')
    // Nothing is recorded about the pack it wanted: the story is bound, full stop.
    expect(calls.stories[0].settings).toEqual({ tone: 'wry' })
    // The answers survive the fallback rather than being discarded.
    expect(calls.stories[0].customVariableValues).toEqual({ writing_style: 'terse' })
  })

  it('does not bind silently on a name match with a different author', async () => {
    // One candidate is guaranteed by UNIQUE(name); the right one is not.
    db.packs.push(pack({ id: 'local-grimdark', author: 'Grace' }))

    await runImport(sampleExport(namedBinding))

    expect(calls.stories[0].packId).toBe('default-pack')
  })

  it('imports a file that records no pack exactly as it did before', async () => {
    // Every file written before v1.9.0.
    const result = await runImport(sampleExport(undefined))

    expect(result.success).toBe(true)
    expect(calls.stories[0].packId).toBe('default-pack')
    expect(calls.stories[0].settings).toEqual({ tone: 'wry' })
    expect(calls.stories[0].customVariableValues).toBeNull()
  })

  it('treats a malformed packBinding as a file that records no pack', async () => {
    const result = await runImport(sampleExport({ pack: { author: 'Ada' } }))

    expect(result.success).toBe(true)
    expect(calls.stories[0].packId).toBe('default-pack')
  })

  it('leaves no story row when the resolver returns null', async () => {
    const result = await runImport(sampleExport(namedBinding), {
      resolvePackBinding: async () => null,
    })

    expect(result.success).toBe(false)
    // Nothing to roll back, because nothing was written: the callback runs before the first
    // insert. A refactor that moved it after createStory would break this silently.
    expect(calls.stories).toEqual([])
    expect(calls.deleted).toEqual([])
  })

  it('returns an import failure when pack resolution throws before the first write', async () => {
    const result = await runImport(sampleExport(namedBinding), {
      resolvePackBinding: async () => {
        throw new Error('pack database unavailable')
      },
    })

    expect(result).toMatchObject({ success: false, error: 'pack database unavailable' })
    expect(calls.stories).toEqual([])
  })

  it('hands the resolver the file binding and the auto-match to pre-select', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))
    const seen: any[] = []

    await runImport(sampleExport(namedBinding), {
      resolvePackBinding: async (ctx) => {
        seen.push(ctx)
        return { packId: 'chosen-by-user', customVariableValues: { writing_style: 'lush' } }
      },
    })

    expect(seen[0].binding.pack).toEqual({ name: 'Grimdark', author: 'Ada' })
    expect(seen[0].match).toMatchObject({ confidence: 'exact' })
    expect(seen[0].match.pack.id).toBe('local-grimdark')
    // The resolver's answer wins over the match it was offered.
    expect(calls.stories[0]).toMatchObject({
      packId: 'chosen-by-user',
      customVariableValues: { writing_style: 'lush' },
    })
  })
})

describe('decidePackPrompt — what the interactive import asks about', () => {
  const recordsNoPack = { binding: null, match: { pack: null, confidence: 'none' } } as never
  const matched = pack({ id: 'local-grimdark' })

  /** A file naming Grimdark, resolved against the local packs with the given confidence. */
  function file(confidence: MatchConfidence, values?: Record<string, string>) {
    return {
      binding: {
        pack: { name: 'Grimdark', author: 'Ada' },
        ...(values ? { customVariableValues: values } : {}),
      },
      match: { pack: confidence === 'none' ? null : matched, confidence },
    } as never
  }

  const required = (defaultValue?: string) => [
    { variableName: 'writing_style', isRequired: true, defaultValue },
  ]

  const device = (over: Partial<Parameters<typeof decidePackPrompt>[1]> = {}) => ({
    legacyImportPackMapping: false,
    packCount: 3,
    ...over,
  })

  describe('a file that records no pack', () => {
    it('is not asked about while the opt-in is off', () => {
      // The compatibility promise: files written before packs were recorded import exactly as
      // they did, with no new step in a workflow people already rely on.
      expect(decidePackPrompt(recordsNoPack, device({ packCount: 4 }))).toEqual({ prompt: 'none' })
    })

    it('is asked about when the opt-in is on and there is more than one pack', () => {
      expect(
        decidePackPrompt(recordsNoPack, device({ legacyImportPackMapping: true, packCount: 2 })),
      ).toEqual({ prompt: 'choose-pack' })
    })

    it('is not asked about on a single-pack device, opt-in or not', () => {
      // Nothing was named, so there is no information to convey and no choice to make. Counting
      // packs rather than looking for a custom one also covers a renamed built-in pack.
      expect(
        decidePackPrompt(recordsNoPack, device({ legacyImportPackMapping: true, packCount: 1 })),
      ).toEqual({ prompt: 'none' })
    })
  })

  describe('a file that records a pack', () => {
    it('binds without asking on a name-and-author match', () => {
      // The point of the whole policy: every file written from 1.9.0 on records a pack, so a
      // confirm-on-match rule would put a modal in front of every import forever.
      expect(decidePackPrompt(file('exact'), device())).toEqual({ prompt: 'none' })
    })

    it('binds without asking whatever the legacy opt-in says', () => {
      for (const legacyImportPackMapping of [true, false]) {
        expect(decidePackPrompt(file('exact'), device({ legacyImportPackMapping }))).toEqual({
          prompt: 'none',
        })
      }
    })

    it('asks which pack when the name matches but the author does not', () => {
      // One candidate, guaranteed by UNIQUE(name). Not the right one, guaranteed by nothing.
      expect(decidePackPrompt(file('name-only'), device())).toEqual({ prompt: 'choose-pack' })
    })

    it('asks which pack when nothing matches, even on a single-pack device', () => {
      // Unlike a legacy file, this one carries information — the pack it wants is absent — and
      // the useful response may be to cancel and go install it.
      expect(decidePackPrompt(file('none'), device({ packCount: 1 }))).toEqual({
        prompt: 'choose-pack',
      })
    })
  })

  describe('a confident match that still needs something', () => {
    it('asks for a required value the story has no answer for', () => {
      // Reachable on an exact match because packs are not versioned: the recipient's copy can
      // define a required variable the sender's did not.
      expect(decidePackPrompt(file('exact'), device({ matchedPackVariables: required() }))).toEqual(
        { prompt: 'fill-values', missing: ['writing_style'] },
      )
    })

    it('does not ask when the story already answered it', () => {
      expect(
        decidePackPrompt(
          file('exact', { writing_style: 'terse' }),
          device({ matchedPackVariables: required() }),
        ),
      ).toEqual({ prompt: 'none' })
    })

    it('matches a story answer using the same normalized name as pack binding', () => {
      expect(
        decidePackPrompt(
          file('exact', { ' Writing_Style ': 'terse' }),
          device({ matchedPackVariables: required() }),
        ),
      ).toEqual({ prompt: 'none' })
    })

    it('does not ask when the pack supplies a default', () => {
      // A default is a usable value. Stopping an import to have someone retype it is exactly the
      // prompt this design removes.
      expect(
        decidePackPrompt(file('exact'), device({ matchedPackVariables: required('lush') })),
      ).toEqual({ prompt: 'none' })
    })

    it('treats a blank answer as no answer', () => {
      expect(
        decidePackPrompt(
          file('exact', { writing_style: '   ' }),
          device({ matchedPackVariables: required() }),
        ),
      ).toEqual({ prompt: 'fill-values', missing: ['writing_style'] })
    })

    it('ignores optional variables the story has no answer for', () => {
      expect(
        decidePackPrompt(
          file('exact'),
          device({ matchedPackVariables: [{ variableName: 'mood', isRequired: false }] }),
        ),
      ).toEqual({ prompt: 'none' })
    })

    it('does not consult variables when the pack itself is the question', () => {
      // No point asking for a value belonging to a pack the user may be about to reject.
      expect(
        decidePackPrompt(file('name-only'), device({ matchedPackVariables: required() })),
      ).toEqual({ prompt: 'choose-pack' })
    })
  })
})

describe('planPackBinding — the one policy both callers use', () => {
  /**
   * The library import and sync differ only in how they show a dialog. Everything up to that
   * point lives here, so a change in policy cannot land on one path and miss the other.
   */
  const named = {
    pack: { name: 'Grimdark', author: 'Ada' },
    customVariableValues: { writing_style: 'terse' },
  }

  it('answers outright on a confident match, loading nothing for the caller to decide', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))
    const ctx = await buildBindingContext(named as never)

    const plan = await planPackBinding(ctx, false)

    expect(plan).toEqual({
      ask: false,
      resolution: { packId: 'local-grimdark', customVariableValues: { writing_style: 'terse' } },
    })
  })

  it("adds the selected pack's canonical variable spelling on a confident match", async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))
    db.packVariables = [{ variableName: 'mood', isRequired: false }]
    const ctx = await buildBindingContext({
      pack: named.pack,
      customVariableValues: { Mood: 'somber' },
    } as never)

    const plan = await planPackBinding(ctx, false)

    expect(plan).toEqual({
      ask: false,
      resolution: {
        packId: 'local-grimdark',
        customVariableValues: { Mood: 'somber', mood: 'somber' },
      },
    })
  })

  it('asks which pack, with nothing locked, when the named pack is absent', async () => {
    const ctx = await buildBindingContext(named as never)

    await expect(planPackBinding(ctx, false)).resolves.toEqual({ ask: true, lockedPack: null })
  })

  it('locks the pack and names the gap when only a required value is missing', async () => {
    const local = pack({ id: 'local-grimdark' })
    db.packs.push(local)
    db.packVariables = [{ variableName: 'mood', isRequired: true } as never]
    const ctx = await buildBindingContext({ pack: named.pack } as never)

    const plan = await planPackBinding(ctx, false)

    expect(plan).toEqual({ ask: true, lockedPack: local, onlyVariables: ['mood'] })
  })

  it('passes the legacy opt-in through for a file that records no pack', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))
    const ctx = await buildBindingContext(undefined)

    await expect(planPackBinding(ctx, false)).resolves.toMatchObject({ ask: false })
    await expect(planPackBinding(ctx, true)).resolves.toEqual({ ask: true, lockedPack: null })
  })
})

describe('runImport — re-keying entity values', () => {
  it('makes the source device values readable under the local definition', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))
    db.runtimeVars = [
      {
        id: 'local-morale',
        packId: 'local-grimdark',
        entityType: 'character',
        variableName: 'morale',
        displayName: 'Morale',
        variableType: 'number',
        color: '#fff',
        pinned: false,
        sortOrder: 0,
        createdAt: 0,
      },
    ]

    await runImport(sampleExport(namedBinding))

    const runtimeVars = calls.characters[0].metadata.runtimeVars as RuntimeVarsMap
    expect(runtimeVars['local-morale']).toEqual({ variableName: 'morale', v: 7 })
    // The source key stays, which is what makes re-binding to the original pack reversible.
    expect(runtimeVars['src-morale']).toEqual({ variableName: 'morale', v: 7 })
  })

  it('leaves the values alone when the file carries no runtime definitions', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))

    await runImport(sampleExport({ pack: { name: 'Grimdark', author: 'Ada' } }))

    expect(calls.characters[0].metadata.runtimeVars).toEqual({
      'src-morale': { variableName: 'morale', v: 7 },
    })
  })

  it('re-keys rollback deltas and checkpoint snapshots as well as live rows', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))
    const entityTypes = ['character', 'location', 'item', 'story_beat'] as const
    db.runtimeVars = entityTypes.map((entityType) => ({
      id: `local-${entityType}`,
      packId: 'local-grimdark',
      entityType,
      variableName: 'state',
      displayName: 'State',
      variableType: 'text',
      color: '#fff',
      pinned: false,
      sortOrder: 0,
      createdAt: 0,
    }))
    const binding = {
      ...namedBinding,
      runtimeVariables: entityTypes.map((entityType) => ({ entityType, variableName: 'state' })),
    }
    const data = sampleExport(binding)
    const metadata = (entityType: string) => ({
      runtimeVars: { [`src-${entityType}`]: { variableName: 'state', v: entityType } },
    })
    data.characters[0].metadata = metadata('character')
    data.locations = [
      { id: 'loc-1', name: 'Cave', connections: [], metadata: metadata('location') },
    ]
    data.items = [
      { id: 'item-1', name: 'Blade', location: 'inventory', metadata: metadata('item') },
    ]
    data.storyBeats = [{ id: 'beat-1', title: 'Quest', metadata: metadata('story_beat') }]
    data.entries[0].worldStateDelta = {
      classificationResult: {},
      previousState: {
        characters: [{ id: 'char-1', metadata: metadata('character') }],
        locations: [{ id: 'loc-1', metadata: metadata('location') }],
        items: [{ id: 'item-1', location: 'inventory', metadata: metadata('item') }],
        storyBeats: [{ id: 'beat-1', metadata: metadata('story_beat') }],
        currentLocationId: null,
        timeTracker: null,
      },
      createdEntities: { characterIds: [], locationIds: [], itemIds: [], storyBeatIds: [] },
    }
    data.checkpoints = [
      {
        id: 'checkpoint-1',
        storyId: 'story-old',
        name: 'Before',
        lastEntryId: 'entry-1',
        lastEntryPreview: 'c',
        entryCount: 1,
        entriesSnapshot: [],
        charactersSnapshot: [structuredClone(data.characters[0])],
        locationsSnapshot: [structuredClone(data.locations[0])],
        itemsSnapshot: [structuredClone(data.items[0])],
        storyBeatsSnapshot: [structuredClone(data.storyBeats[0])],
        chaptersSnapshot: [],
        timeTrackerSnapshot: null,
      },
    ]

    expect((await runImport(data)).success).toBe(true)
    const deltaEntities = calls.entries[0].worldStateDelta.previousState
    const checkpoint = calls.checkpoints[0]
    const pairs = [
      [deltaEntities.characters[0], checkpoint.charactersSnapshot[0], 'character'],
      [deltaEntities.locations[0], checkpoint.locationsSnapshot[0], 'location'],
      [deltaEntities.items[0], checkpoint.itemsSnapshot[0], 'item'],
      [deltaEntities.storyBeats[0], checkpoint.storyBeatsSnapshot[0], 'story_beat'],
    ] as const
    for (const [deltaEntity, snapshotEntity, entityType] of pairs) {
      expect(deltaEntity.metadata.runtimeVars[`local-${entityType}`]).toEqual({
        variableName: 'state',
        v: entityType,
      })
      expect(snapshotEntity.metadata.runtimeVars[`local-${entityType}`]).toEqual({
        variableName: 'state',
        v: entityType,
      })
    }
  })
})

describe('dialog custom-variable persistence', () => {
  it('keeps file answers and edits without materialising untouched pack defaults', () => {
    const variables = [{ variableName: 'mood', defaultValue: 'bright' }]
    expect(mergeCustomVariableValues(undefined, variables, {})).toEqual({})
    expect(mergeCustomVariableValues({ Mood: 'somber' }, variables, {})).toEqual({
      Mood: 'somber',
      mood: 'somber',
    })
    expect(mergeCustomVariableValues(undefined, variables, { mood: 'stormy' })).toEqual({
      mood: 'stormy',
    })
  })
})

describe('sync — the decision is made before anything is written', () => {
  /**
   * What `SyncModal` does now: settle the pack up front, then hand the answer to the import.
   * The dialog itself lives in the component; what is testable here is that a held decision is
   * replayed rather than re-asked, and that a refusal writes nothing.
   */
  const syncImport = (data: unknown, held?: unknown) =>
    runImport(data as never, {
      skipImportedSuffix: true,
      ...(held === undefined ? {} : { resolvePackBinding: async () => held as never }),
    })

  it('binds to a confident match without the caller having to decide', async () => {
    db.packs.push(pack({ id: 'local-grimdark' }))

    const result = await syncImport(sampleExport(namedBinding))

    expect(result.success).toBe(true)
    expect(calls.stories[0]).toMatchObject({
      packId: 'local-grimdark',
      customVariableValues: { writing_style: 'terse' },
    })
  })

  it('uses the answer the caller already collected instead of asking again', async () => {
    // SyncModal resolves before it deletes the story being replaced, so by the time the import
    // runs the question is settled; the resolver here just returns what the user picked.
    let asked = 0
    await syncImport(sampleExport(namedBinding), { packId: 'picked-by-user' })
    await runImport(sampleExport(namedBinding), {
      resolvePackBinding: async () => {
        asked += 1
        return { packId: 'picked-by-user' }
      },
    })

    expect(calls.stories[0].packId).toBe('picked-by-user')
    expect(calls.stories[1].packId).toBe('picked-by-user')
    expect(asked).toBe(1)
  })

  it('writes nothing when the user abandons the transfer at the pack step', async () => {
    // The property the ordering in SyncModal exists to protect: a cancel must reach this with
    // the story being replaced still on disk, so no row is created and none is removed.
    const result = await syncImport(sampleExport(namedBinding), null)

    expect(result.success).toBe(false)
    expect(calls.stories).toEqual([])
    expect(calls.deleted).toEqual([])
  })

  it('binds a legacy file to the built-in pack without consulting the opt-in', async () => {
    await syncImport(sampleExport(undefined))

    expect(calls.stories[0].packId).toBe('default-pack')
    expect(calls.stories[0].settings).toEqual({ tone: 'wry' })
  })
})

describe('importFromFile — where the decision happens', () => {
  it('resolves the binding after the native read and before any write', async () => {
    const order: string[] = []
    invoke.mockImplementation(async (cmd: string) => {
      order.push(cmd)
      if (cmd === 'avt_read_light') return JSON.stringify(sampleExport(namedBinding))
      return 0
    })

    const result = await importFromFile('/tmp/story.avt', {
      resolvePackBinding: async () => {
        order.push('resolve')
        expect(calls.stories).toEqual([])
        return null
      },
    })

    expect(order).toEqual(['avt_read_light', 'resolve'])
    expect(result).toEqual({ success: false })
    // Cancelling costs no partial import: the file was read, and nothing else happened.
    expect(calls.stories).toEqual([])
    expect(calls.deleted).toEqual([])
  })
})
