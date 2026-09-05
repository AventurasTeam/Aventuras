import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StoryEntry } from '$lib/types'

// `tier3Selection` reaches `sdk/generate`, which transitively pulls in the debug rune store
// and fails to import under `environment: 'node'`. Mocked rather than worked around: the LLM
// call is not what these tests are about, and stubbing it is what makes the failure path
// reachable at all.
vi.mock('$lib/stores/activity.svelte', () => ({
  activity: {
    startStep: vi.fn(() => ''),
    endStep: vi.fn(),
    recordStep: vi.fn(() => ''),
  },
}))

vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))

const generateStructured = vi.fn()
vi.mock('../sdk/generate', () => ({
  generateStructured: (...args: unknown[]) => generateStructured(...args),
}))

const rendered: Record<string, string>[] = []
const packedFor: (string | undefined)[] = []
vi.mock('$lib/services/context', () => ({
  ContextBuilder: class ContextBuilderMock {
    static async forPack(storyId: string | undefined) {
      packedFor.push(storyId)
      return new ContextBuilderMock()
    }
    add(vars: Record<string, string>) {
      rendered.push(vars)
    }
    async render() {
      return { system: 'system', user: 'user' }
    }
  },
}))

import {
  resolveTier3Selection,
  runTier3Selection,
  countWholesaleWords,
  clearTier3SelectionCache,
  type Tier3SelectionResult,
} from './tier3Selection'
import { TIER3_SELECTION_CACHE_POSITIONS } from '../core/defaults'
import { activity } from '$lib/stores/activity.svelte'

/** A candidate list in the order the prompt was built from. */
const candidates = [
  { id: 'a-uuid', name: 'Aria' },
  { id: 'b-uuid', name: 'Bramble' },
  { id: 'c-uuid', name: 'Corin' },
  { id: 'd-uuid', name: 'Dain' },
]

const selection = (...ids: string[]): Tier3SelectionResult => ({ selectedIndices: new Set(ids) })

beforeEach(() => {
  generateStructured.mockReset()
  rendered.length = 0
  packedFor.length = 0
  clearTier3SelectionCache()
})

describe('resolveTier3Selection', () => {
  it('matches by index', () => {
    const selected = resolveTier3Selection(candidates, selection('0', '2'))
    expect(selected.map((c) => c.name)).toEqual(['Aria', 'Corin'])
  })

  it('does not match by id, which never appears in the prompt', () => {
    expect(resolveTier3Selection(candidates, selection('b-uuid'))).toEqual([])
  })

  it("returns them in the model's order, not in candidate order", () => {
    // Both callers cap the result, so the order decides what survives the cap.
    const selected = resolveTier3Selection(candidates, selection('3', '0', '2'))
    expect(selected.map((c) => c.name)).toEqual(['Dain', 'Aria', 'Corin'])
  })

  it('extracts the index out of whatever decoration the model wrapped it in', () => {
    const selected = resolveTier3Selection(candidates, selection('#0', '[2]', ' 1 ', '3.'))
    expect(selected.map((c) => c.name)).toEqual(['Aria', 'Corin', 'Bramble', 'Dain'])
  })

  it('drops an entry with no digits at all rather than guessing', () => {
    const selected = resolveTier3Selection(candidates, selection('Aria', '1'))
    expect(selected.map((c) => c.name)).toEqual(['Bramble'])
  })

  it('ignores an index past the end of the list', () => {
    expect(resolveTier3Selection(candidates, selection('99'))).toEqual([])
  })

  it('does not return a candidate twice when the model names it twice', () => {
    const selected = resolveTier3Selection(candidates, selection('0', '#0'))
    expect(selected).toHaveLength(1)
    expect(selected[0].name).toBe('Aria')
  })

  it('returns nothing for an empty selection', () => {
    expect(resolveTier3Selection(candidates, selection())).toEqual([])
  })

  it('returns nothing when there are no candidates', () => {
    expect(resolveTier3Selection([], selection('0'))).toEqual([])
  })
})

describe('countWholesaleWords', () => {
  it('counts the words the context block would actually inject', () => {
    expect(
      countWholesaleWords([
        { name: 'Aria', description: 'one two three' },
        { name: 'The Iron Tower', description: 'four' },
      ]),
    ).toBe(1 + 3 + 3 + 1)
  })

  it('stops the description at maxWordsPerEntry, where the block truncates', () => {
    expect(countWholesaleWords([{ name: 'X', description: 'a b c d e' }], 2)).toBe(3)
  })

  it('still charges for an entry that has a name and no description', () => {
    expect(countWholesaleWords([{ name: 'Aria' }, { name: 'Borin', description: null }])).toBe(2)
  })

  it('treats a blank string as nothing to pay for', () => {
    expect(countWholesaleWords([{ name: '   ', description: '   ' }, {}])).toBe(0)
  })
})

describe('runTier3Selection', () => {
  const request = {
    storyId: 'story-1',
    candidates: [
      { id: 'a-uuid', type: 'character', name: 'Aria', description: 'A swordswoman.' },
      { id: 'b-uuid', type: 'location', name: 'The Tower', description: null },
    ],
    userInput: 'She climbs the tower.',
    recentEntries: [{ type: 'narration', content: 'The tower loomed.' } as StoryEntry],
    recentEntriesCount: 5,
    presetId: 'entryRetrieval',
    serviceLabel: 'entry-retrieval-tier3',
  }

  it('returns an empty selection without calling the model when there are no candidates', async () => {
    const result = await runTier3Selection({ ...request, candidates: [] })

    expect(result).toEqual({ selectedIndices: new Set() })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it('returns the indices the model selected, plus its reasoning', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: ['1'], reasoning: 'She is there.' })

    const result = await runTier3Selection(request)

    expect(result).toEqual({ selectedIndices: new Set(['1']), reasoning: 'She is there.' })
  })

  it('numbers the candidates from zero, which is what the result resolves against', () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    return runTier3Selection(request).then(() => {
      const summaries = rendered.find((v) => 'entrySummaries' in v)?.entrySummaries ?? ''
      expect(summaries).toContain('0. [character] Aria')
      expect(summaries).toContain('1. [location] The Tower')
    })
  })

  it('drops the user action entry from the recent context, by id', async () => {
    // Not by text: with translation on, the stored entry holds the translated wording
    // while `userInput` holds it too — but the two are only guaranteed equal by identity.
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({
      ...request,
      recentEntries: [
        { id: 'n1', type: 'narration', content: 'The tower loomed.' } as StoryEntry,
        { id: 'a1', type: 'user_action', content: 'Sale la torre.' } as StoryEntry,
      ],
      userActionEntryId: 'a1',
    })

    const recent = rendered.find((v) => 'recentContent' in v)?.recentContent ?? ''
    expect(recent).toContain('The tower loomed.')
    expect(recent).not.toContain('Sale la torre.')
  })

  it('keeps every recent entry when no user action id is given', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({
      ...request,
      recentEntries: [{ id: 'a1', type: 'user_action', content: 'Sale la torre.' } as StoryEntry],
    })

    const recent = rendered.find((v) => 'recentContent' in v)?.recentContent ?? ''
    expect(recent).toContain('Sale la torre.')
  })

  it('omits the colon for a candidate with no description', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection(request)

    const summaries = rendered.find((v) => 'entrySummaries' in v)?.entrySummaries ?? ''
    expect(summaries).toContain('1. [location] The Tower')
    expect(summaries).not.toContain('The Tower:')
  })

  it("renders the template from the story's pack, not the default one", async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection(request)

    expect(packedFor).toEqual(['story-1'])
  })

  it('returns null when the call fails, rather than throwing into the turn', async () => {
    // Both callers read null as "no Tier 3 entries". Throwing would take down a retrieval
    // stage whose other tiers succeeded.
    generateStructured.mockRejectedValue(new Error('provider is down'))

    expect(await runTier3Selection(request)).toBeNull()
  })
})

describe('runTier3Selection caching', () => {
  const cachedRequest = {
    storyId: 'story-1',
    candidates: [
      { id: 'a-uuid', type: 'character', name: 'Aria', description: 'A swordswoman.' },
      { id: 'b-uuid', type: 'location', name: 'The Tower', description: null },
    ],
    userInput: 'She climbs the tower.',
    recentEntries: [{ type: 'narration', content: 'The tower loomed.' } as StoryEntry],
    recentEntriesCount: 5,
    presetId: 'entryRetrieval',
    serviceLabel: 'tier3-lorebook-selection',
  }

  it('reuses the answer when the same question is asked again', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: ['1'] })

    const first = await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    const second = await runTier3Selection({ ...cachedRequest, currentPosition: 100 })

    expect(generateStructured).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('reuses across a retry, which moves the position backwards', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({ ...cachedRequest, currentPosition: 99 })

    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  it('asks again for another story, which renders the question from a different pack', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({ ...cachedRequest, storyId: 'story-2', currentPosition: 100 })

    expect(generateStructured).toHaveBeenCalledTimes(2)
    expect(packedFor).toEqual(['story-1', 'story-2'])
  })

  it('asks again for a new player action, even on an unchanged pool', async () => {
    // The answer is a judgement about a scene. Reusing it across actions would answer the
    // new one with the previous one's verdict.
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      userInput: 'She draws her sword.',
      currentPosition: 101,
    })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  // The prompt is built from the recent story as much as from the action, so the key has
  // to be. Without this, two branches sitting at the same position with the same lorebook
  // and a repeated action ("continue") answered each other's scene.
  it('asks again when the story behind an identical action differs', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({
      ...cachedRequest,
      recentEntries: [{ id: 'n1', type: 'narration', content: 'The tower loomed.' } as StoryEntry],
      currentPosition: 100,
    })
    await runTier3Selection({
      ...cachedRequest,
      recentEntries: [{ id: 'n2', type: 'narration', content: 'The tower fell.' } as StoryEntry],
      currentPosition: 100,
    })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('reuses when the history is the same entries, whatever their text now says', async () => {
    // Translation rewrites stored content in place; the entries are still these entries.
    generateStructured.mockResolvedValue({ selectedIndices: [] })
    const history = [{ id: 'n1', type: 'narration', content: 'The tower loomed.' } as StoryEntry]

    await runTier3Selection({ ...cachedRequest, recentEntries: history, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      recentEntries: [{ ...history[0], content: 'La torre incombeva.' }],
      currentPosition: 100,
    })

    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  it('ignores history the recent-entries window would not have shown the model', async () => {
    // Only the slice that reaches the prompt is part of the question.
    generateStructured.mockResolvedValue({ selectedIndices: [] })
    const shown = { id: 'n9', type: 'narration', content: 'Here.' } as StoryEntry

    await runTier3Selection({
      ...cachedRequest,
      recentEntriesCount: 1,
      recentEntries: [{ id: 'old', type: 'narration', content: 'Long ago.' } as StoryEntry, shown],
      currentPosition: 100,
    })
    await runTier3Selection({
      ...cachedRequest,
      recentEntriesCount: 1,
      recentEntries: [
        { id: 'different', type: 'narration', content: 'Elsewhere.' } as StoryEntry,
        shown,
      ],
      currentPosition: 100,
    })

    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  it('asks again once the candidate set changes', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      candidates: [
        ...cachedRequest.candidates,
        { id: 'c-uuid', type: 'item', name: 'Key', description: null },
      ],
      currentPosition: 100,
    })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('asks again on a reordered pool, because the answer is in index space', async () => {
    // A hit here would resolve "1" against a list where position 1 is a different entity.
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      candidates: [...cachedRequest.candidates].reverse(),
      currentPosition: 100,
    })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('reuses inside the window', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      currentPosition: 100 + TIER3_SELECTION_CACHE_POSITIONS - 1,
    })

    expect(generateStructured).toHaveBeenCalledTimes(1)
  })

  // The window edge is exclusive, and this is why. A turn is exactly two positions, and
  // `TIER3_SELECTION_CACHE_POSITIONS` is 2 — so an inclusive edge let the *next* turn hit
  // the cache whenever the action text repeated ("continue", "wait") and the pool had not
  // moved, answering a new scene with the previous turn's verdict.
  it('asks again a whole turn later, even on an identical question', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      currentPosition: 100 + TIER3_SELECTION_CACHE_POSITIONS,
    })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('keeps the two callers apart', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    await runTier3Selection({
      ...cachedRequest,
      serviceLabel: 'tier3-world-state-selection',
      currentPosition: 100,
    })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failed call', async () => {
    generateStructured.mockRejectedValueOnce(new Error('provider is down'))
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    expect(await runTier3Selection({ ...cachedRequest, currentPosition: 100 })).toBeNull()
    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('bypasses the cache entirely when the caller gives no position', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection(cachedRequest)
    await runTier3Selection(cachedRequest)

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })

  it('is emptied by clearTier3SelectionCache', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: [] })

    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })
    clearTier3SelectionCache()
    await runTier3Selection({ ...cachedRequest, currentPosition: 100 })

    expect(generateStructured).toHaveBeenCalledTimes(2)
  })
})

describe('runTier3Selection activity reporting', () => {
  const request = {
    storyId: 'story-1',
    candidates: [
      { id: 'a-uuid', type: 'character', name: 'Aria', description: 'A swordswoman.' },
      { id: 'b-uuid', type: 'location', name: 'The Tower', description: null },
    ],
    userInput: 'She climbs the tower.',
    recentEntries: [{ type: 'narration', content: 'The tower loomed.' } as StoryEntry],
    recentEntriesCount: 5,
    presetId: 'entryRetrieval',
    serviceLabel: 'tier3-activity-selection',
    activityParentId: 'parent-step',
  }

  beforeEach(() => {
    vi.mocked(activity.startStep).mockClear()
    vi.mocked(activity.endStep).mockClear()
    vi.mocked(activity.recordStep).mockClear()
  })

  it('records nothing when there are no candidates to select from', async () => {
    await runTier3Selection({ ...request, candidates: [] })

    expect(activity.startStep).not.toHaveBeenCalled()
    expect(activity.recordStep).not.toHaveBeenCalled()
  })

  it('records the selection as an LLM step nested under its caller', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: ['1'] })

    await runTier3Selection(request)

    expect(activity.startStep).toHaveBeenCalledWith('Tier 3 selection', {
      parentId: 'parent-step',
      isLLM: true,
      detail: '2 candidates',
    })
    expect(activity.endStep).toHaveBeenCalledWith('', 'done', '1 of 2')
  })

  it('records a failed selection as failed', async () => {
    generateStructured.mockRejectedValue(new Error('boom'))

    await runTier3Selection(request)

    expect(activity.endStep).toHaveBeenCalledWith('', 'failed')
  })

  it('records a cache hit as a finished step that cost no model call', async () => {
    generateStructured.mockResolvedValue({ selectedIndices: ['0'] })
    await runTier3Selection({ ...request, currentPosition: 100 })
    vi.mocked(activity.recordStep).mockClear()

    await runTier3Selection({ ...request, currentPosition: 100 })

    expect(generateStructured).toHaveBeenCalledTimes(1)
    expect(activity.recordStep).toHaveBeenCalledWith('Tier 3 selection', {
      parentId: 'parent-step',
      detail: 'cached · 1 of 2',
    })
  })
})
