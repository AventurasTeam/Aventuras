import { describe, expect, it, vi } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'
import { fallbackChapterEnd } from './fallback-chapter-end'

// Passes through to the real rule; the C10 cases swap it, to prove the fallback asks it.
vi.mock('./can-end-chapter', async (importOriginal) => {
  const actual = await importOriginal<{ canEndChapter: typeof canEndChapter }>()
  return { canEndChapter: vi.fn(actual.canEndChapter) }
})

type Row = { id: string; kind: StoryEntry['kind'] }

const entry = (id: string, kind: StoryEntry['kind']): Row => ({ id, kind })
const opening = entry('o1', 'opening')
const u = (n: number): Row => entry(`u${n}`, 'user_action')
const r = (n: number): Row => entry(`r${n}`, 'ai_reply')

const CASES: { name: string; series: readonly Row[]; end: string | null }[] = [
  { name: 'the head when no reply comes before it', series: [u(5), r(5)], end: 'r5' },
  { name: 'the latest reply before a user_action head', series: [r(1), u(2), u(3)], end: 'r1' },
  { name: 'the latest reply before a reply head', series: [r(1), u(2), r(2)], end: 'r1' },
  {
    name: 'the newest of several replies before the head',
    series: [opening, u(1), r(1), u(2), r(2), u(3), r(3)],
    end: 'r2',
  },
  { name: 'nothing for a region with no reply', series: [opening, u(1)], end: null },
  { name: 'nothing for an empty region', series: [], end: null },
]

describe('fallbackChapterEnd', () => {
  it.each(CASES)('gives $name', ({ series, end }) => {
    expect(fallbackChapterEnd(series)?.id ?? null).toBe(end)
  })

  it("returns the series' own row", () => {
    const series = [u(1), r(1), u(2)]
    expect(fallbackChapterEnd(series)).toBe(series[1])
  })

  // Swapped so the rule, not the kind, decides: the head case needs a row before it that fails.
  it.each([
    {
      name: 'the latest user_action before the head',
      series: [r(1), u(2), u(3)],
      end: 'u2',
    },
    {
      name: 'the user_action head when nothing before it qualifies',
      series: [r(1), u(2)],
      end: 'u2',
    },
  ])('asks canEndChapter, the one copy of the rule (C10), for $name', async ({ series, end }) => {
    const actual = await vi.importActual<{ canEndChapter: typeof canEndChapter }>(
      './can-end-chapter',
    )
    vi.mocked(canEndChapter).mockImplementation((row) => row.kind === 'user_action')
    try {
      expect(fallbackChapterEnd(series)?.id ?? null).toBe(end)
    } finally {
      vi.mocked(canEndChapter).mockImplementation(actual.canEndChapter)
    }
  })
})
