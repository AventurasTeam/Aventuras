/**
 * What the sync sender puts on the wire.
 *
 * Scoped deliberately to the pack binding. The section itself comes from the `.avt` exporter's
 * `gatherPackBinding`, but sync still assembles the payload around it (see the TECH DEBT note on
 * `exportStoryToJson`), so these assert on what ends up on the wire rather than on which module
 * produced it — folding the two exporters together later should not rewrite them.
 *
 * Two known divergences from the `.avt` path are asserted as-is rather than fixed, so that
 * closing them is a deliberate act with a failing test to update, not a silent drift: the
 * version stamp is pinned at `1.7.0`, and background images are not carried at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Module-scope Tauri and store imports that must merely resolve under Node.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('$lib/stores/story.svelte', () => ({
  story: { currentStory: null, loadStory: vi.fn(), createCheckpoint: vi.fn() },
}))

const db = {
  getStory: vi.fn(),
  getStoryEntries: vi.fn(),
  getCharacters: vi.fn(),
  getLocations: vi.fn(),
  getItems: vi.fn(),
  getStoryBeats: vi.fn(),
  getEntries: vi.fn(),
  getEmbeddedImagesForStory: vi.fn(),
  getCheckpoints: vi.fn(),
  getBranches: vi.fn(),
  getChapters: vi.fn(),
  getStoryPackId: vi.fn(),
  getPack: vi.fn(),
  getPackVariables: vi.fn(),
  getRuntimeVariables: vi.fn(),
  getStoryCustomVariables: vi.fn(),
  getBackgroundForBranch: vi.fn(),
}
vi.mock('./database', () => ({ database: db }))

const { syncService } = await import('./sync')

/** A story with no pack and nothing optional set — the baseline each test varies from. */
function baseline() {
  db.getStory.mockResolvedValue({
    id: 's1',
    title: 'Yuka',
    settings: {},
    styleReviewState: null,
    currentBgImage: null,
  })
  db.getStoryEntries.mockResolvedValue([{ id: 'e1', type: 'narration', content: 'once' }])
  db.getCharacters.mockResolvedValue([])
  db.getLocations.mockResolvedValue([])
  db.getItems.mockResolvedValue([])
  db.getStoryBeats.mockResolvedValue([])
  db.getEntries.mockResolvedValue([])
  db.getEmbeddedImagesForStory.mockResolvedValue([])
  db.getCheckpoints.mockResolvedValue([])
  db.getBranches.mockResolvedValue([])
  db.getChapters.mockResolvedValue([])
  db.getStoryPackId.mockResolvedValue(null)
  db.getPack.mockResolvedValue(null)
  db.getPackVariables.mockResolvedValue([])
  db.getRuntimeVariables.mockResolvedValue([])
  db.getStoryCustomVariables.mockResolvedValue(null)
}

/** Give the story a custom pack, with one variable of each kind. */
function withPack() {
  db.getStoryPackId.mockResolvedValue('pack-local-uuid')
  db.getPack.mockResolvedValue({
    id: 'pack-local-uuid',
    name: 'Grimdark',
    author: 'Kolya',
    description: 'grim',
    isDefault: false,
  })
  db.getPackVariables.mockResolvedValue([
    {
      id: 'v1',
      packId: 'pack-local-uuid',
      variableName: 'writing_style',
      displayName: 'Writing Style',
      variableType: 'text',
      isRequired: true,
      sortOrder: 0,
    },
  ])
  db.getRuntimeVariables.mockResolvedValue([
    {
      id: 'rv1',
      packId: 'pack-local-uuid',
      entityType: 'character',
      variableName: 'morale',
      displayName: 'Morale',
      variableType: 'number',
      minValue: 0,
      maxValue: 100,
      color: '#6366f1',
      pinned: false,
      sortOrder: 0,
    },
  ])
  db.getStoryCustomVariables.mockResolvedValue({ writing_style: 'terse' })
}

async function payload() {
  return JSON.parse(await syncService.exportStoryToJson('s1'))
}

beforeEach(() => {
  vi.clearAllMocks()
  baseline()
})

describe('exportStoryToJson — pack binding', () => {
  it('carries the pack identity and the story’s answers', async () => {
    withPack()
    const { packBinding } = await payload()

    expect(packBinding.pack).toEqual({ name: 'Grimdark', author: 'Kolya' })
    expect(packBinding.customVariableValues).toEqual({ writing_style: 'terse' })
  })

  it('carries variable definitions without device-local ids', async () => {
    withPack()
    const { packBinding } = await payload()

    expect(packBinding.variables[0]).toMatchObject({
      variableName: 'writing_style',
      variableType: 'text',
      isRequired: true,
    })
    expect(packBinding.runtimeVariables[0]).toMatchObject({
      entityType: 'character',
      variableName: 'morale',
      minValue: 0,
      maxValue: 100,
    })
    // Ids are minted per device; sending them would invite a receiver to match on them.
    expect(packBinding.variables[0]).not.toHaveProperty('id')
    expect(packBinding.variables[0]).not.toHaveProperty('packId')
    expect(packBinding.runtimeVariables[0]).not.toHaveProperty('id')
    expect(packBinding.runtimeVariables[0]).not.toHaveProperty('packId')
  })

  it('never sends template content', async () => {
    withPack()
    const raw = await syncService.exportStoryToJson('s1')

    expect(db.getPackVariables).toHaveBeenCalledWith('pack-local-uuid')
    expect(raw).not.toContain('templates')
    expect(raw).not.toContain('content_hash')
  })

  it('omits packBinding entirely for a story with no pack', async () => {
    expect('packBinding' in (await payload())).toBe(false)
  })

  it('omits packBinding when the story points at a pack that no longer exists', async () => {
    db.getStoryPackId.mockResolvedValue('deleted-pack')
    db.getPack.mockResolvedValue(null)

    expect('packBinding' in (await payload())).toBe(false)
  })
})

describe('exportStoryToJson — known divergences from the .avt path', () => {
  it('still stamps 1.7.0, which the shape-driven importer ignores', async () => {
    // Not an endorsement: pinned so that correcting it is deliberate. The importer never
    // compares this value, which is why the binding above is honoured despite it.
    withPack()
    const p = await payload()

    expect(p.version).toBe('1.7.0')
    expect(p.packBinding).toBeDefined()
  })

  it('does not claim to carry a background image', async () => {
    // The real value lives in `background_images` behind `getBackgroundForBranch`; `getStory`
    // hardcodes `currentBgImage: null`. Mocking a value in here would pass against a shape the
    // production query cannot produce and make the payload look richer than it is.
    const p = await payload()

    expect(p.currentBgImage ?? null).toBeNull()
    expect(db.getBackgroundForBranch).not.toHaveBeenCalled()
  })
})
