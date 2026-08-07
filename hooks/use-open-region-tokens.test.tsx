// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema, type StoryEntry } from '@/lib/db'
import { countTokens } from '@/lib/retrieval'
import { currentStoryStore, entriesStore } from '@/lib/stores'

import { openRegionProgress, useOpenRegionTokens } from './use-open-region-tokens'

// Counts walk iterations so the memo claim is measured, not asserted: the pure
// function calls this once per entry it visits.
const probe = vi.hoisted(() => ({ walked: 0 }))

vi.mock('@/lib/retrieval', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const real = actual.countEntryTokens as (entryId: string, content: string) => number
  return {
    ...actual,
    countEntryTokens: (entryId: string, content: string) => {
      probe.walked += 1
      return real(entryId, content)
    },
  }
})

const THRESHOLD = 24_000
// Ordinary prose, not one repeated character. tiktoken's split regex leaves
// 'x'.repeat(4000) as a single word, and the BPE merge over it costs ~600ms
// against ~0ms for the same length of real text — enough of them here to blow
// the 5s default on CI while passing locally.
const LONG = 'the quick brown fox jumps over the lazy dog. '.repeat(90)
const SHORT = 'the quick brown fox jumps over the lazy dog. '.repeat(9)

function entry(
  id: string,
  content: string,
  chapterId: string | null = null,
  kind: StoryEntry['kind'] = 'ai_reply',
): Pick<StoryEntry, 'id' | 'content' | 'chapterId' | 'kind'> {
  return { id, content, chapterId, kind }
}

function pctOf(...contents: string[]): number {
  return (contents.reduce((sum, c) => sum + countTokens(c), 0) / THRESHOLD) * 100
}

describe('openRegionProgress', () => {
  it('counts only entries in the open region', () => {
    expect(
      openRegionProgress([entry('a', LONG, 'ch_1'), entry('b', SHORT)], THRESHOLD),
    ).toBeCloseTo(pctOf(SHORT), 10)
    // Positive control: the excluded entry is not inert — it counts once its
    // chapterId is null, so the assertion above is about the skip, not the row.
    expect(openRegionProgress([entry('a', LONG, null), entry('b', SHORT)], THRESHOLD)).toBeCloseTo(
      pctOf(LONG, SHORT),
      10,
    )
  })

  it('excludes system entries', () => {
    expect(openRegionProgress([entry('sys', SHORT, null, 'system')], THRESHOLD)).toBe(0)
    // Positive control: same body under a non-system kind is counted.
    expect(openRegionProgress([entry('ai', SHORT, null, 'ai_reply')], THRESHOLD)).toBeCloseTo(
      pctOf(SHORT),
      10,
    )
  })

  it('clamps at 100 past the threshold', () => {
    expect(openRegionProgress([entry('a', LONG)], 100)).toBe(100)
    // Positive control: below the threshold the same body reports its raw share.
    expect(openRegionProgress([entry('a', LONG)], 100_000)).toBeCloseTo(
      (countTokens(LONG) / 100_000) * 100,
      10,
    )
  })

  it('returns 0 for an empty branch and for a non-usable threshold', () => {
    expect(openRegionProgress([], THRESHOLD)).toBe(0)
    for (const bad of [0, -1, Number.NaN]) {
      expect(openRegionProgress([entry('a', SHORT)], bad)).toBe(0)
    }
    // Positive control: the same entry reports non-zero against a usable threshold.
    expect(openRegionProgress([entry('a', SHORT)], THRESHOLD)).toBeGreaterThan(0)
  })
})

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

function row(id: string, content: string, chapterId: string | null = null): StoryEntry {
  return {
    id,
    branchId: 'b1',
    position: Number(id.slice(1)),
    kind: 'ai_reply',
    content,
    chapterId,
    metadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
    createdAt: 1,
  }
}

function openStory(chapterTokenThreshold = THRESHOLD): void {
  currentStoryStore.set({
    storyId: 's1',
    branchId: 'b1',
    definition: DEFINITION,
    settings: { ...STORY_SETTINGS_DEFAULTS, chapterTokenThreshold },
  })
}

let latest = 0

function Probe({ storyId = 's1' }: { nonce: number; storyId?: string | null }) {
  latest = useOpenRegionTokens(storyId)
  return null
}

describe('useOpenRegionTokens', () => {
  beforeEach(() => {
    entriesStore.__reset()
    currentStoryStore.__reset()
    probe.walked = 0
    latest = 0
  })

  afterEach(cleanup)

  it('reads the open region off the entries store and the threshold off the open story', () => {
    entriesStore.hydrate('b1', [row('e1', LONG, 'ch_1'), row('e2', SHORT)])
    openStory()
    render(<Probe nonce={0} />)
    expect(latest).toBeCloseTo(pctOf(SHORT), 10)
  })

  it('returns 0 with no open story, so a cold-loaded route renders an empty strip', () => {
    entriesStore.hydrate('b1', [row('e2', SHORT)])
    render(<Probe nonce={0} />)
    expect(latest).toBe(0)
    // Positive control: the same rows report non-zero once a story is open.
    cleanup()
    openStory()
    render(<Probe nonce={0} />)
    expect(latest).toBeGreaterThan(0)
  })

  // The strip belongs to the surface's own story. Reading whichever story
  // happens to be open would show story A's open region against A's threshold
  // on story B's settings screen — reachable by opening a reader, then
  // navigating to another story's settings, which never clears the open story.
  it("returns 0 when the open story is not the caller's", () => {
    entriesStore.hydrate('b1', [row('e2', SHORT)])
    openStory()
    render(<Probe nonce={0} storyId="s2" />)
    expect(latest).toBe(0)
    // Positive control: the same store state reports non-zero for its own story.
    cleanup()
    render(<Probe nonce={0} storyId="s1" />)
    expect(latest).toBeGreaterThan(0)
  })

  it('returns 0 for a caller with no story of its own yet', () => {
    entriesStore.hydrate('b1', [row('e2', SHORT)])
    openStory()
    render(<Probe nonce={0} storyId={null} />)
    expect(latest).toBe(0)
  })

  it('does not re-walk the branch on a re-render with no entries write', () => {
    entriesStore.hydrate('b1', [row('e1', SHORT), row('e2', SHORT)])
    openStory()
    const { rerender } = render(<Probe nonce={0} />)
    const walkedOnce = probe.walked
    expect(walkedOnce).toBe(2)

    rerender(<Probe nonce={1} />)
    rerender(<Probe nonce={2} />)
    expect(probe.walked).toBe(walkedOnce)

    // Positive control: an entries write does re-walk, so the assertion above
    // is about the memo holding, not about the walk never running.
    act(() => {
      entriesStore.patch('b1', { op: 'update', id: 'e2', columns: { content: LONG } })
    })
    expect(probe.walked).toBeGreaterThan(walkedOnce)
    expect(latest).toBeCloseTo(pctOf(SHORT, LONG), 10)
  })
})
