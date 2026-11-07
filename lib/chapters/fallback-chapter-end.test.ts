import { describe, expect, it, vi } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'
import { fallbackChapterEnd } from './fallback-chapter-end'

// Passes through to the real rule; one case swaps it, to prove the fallback asks it (C10).
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

  it('asks canEndChapter, the one copy of the rule (C10)', async () => {
    const actual = await vi.importActual<{ canEndChapter: typeof canEndChapter }>(
      './can-end-chapter',
    )
    vi.mocked(canEndChapter).mockImplementation((row) => row.kind === 'user_action')
    try {
      expect(fallbackChapterEnd([r(1), u(2), u(3)])?.id).toBe('u2')
    } finally {
      vi.mocked(canEndChapter).mockImplementation(actual.canEndChapter)
    }
  })
})
