import { describe, expect, it } from 'vitest'

import type { ChapterPartCut } from '@/lib/chapters'

import { closeParts } from './parts'
import type { CloseRangeEntry } from '../chapter-context'

function entry(id: string, position: number): CloseRangeEntry {
  return {
    id,
    branchId: 'b1',
    position,
    kind: position % 2 === 1 ? 'ai_reply' : 'user_action',
    content: `Entry ${position}.`,
    contentTokens: 10,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

const ENTRIES = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id, i) => entry(id, i + 1))

const cut = (part: number, startEntryId: string, endEntryId: string): ChapterPartCut => ({
  part,
  startEntryId,
  endEntryId,
  tokens: 0,
})

describe('closeParts', () => {
  it('reads one cut over the range as one part numbered 1, every entry in it', () => {
    expect(closeParts(ENTRIES, [cut(1, 'e1', 'e6')])).toEqual([
      { index: 1, entryIds: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'] },
    ])
  })

  it('maps each cut to its entries by position, numbered as the cut is', () => {
    expect(
      closeParts(ENTRIES, [cut(1, 'e1', 'e2'), cut(2, 'e3', 'e3'), cut(3, 'e4', 'e6')]),
    ).toEqual([
      { index: 1, entryIds: ['e1', 'e2'] },
      { index: 2, entryIds: ['e3'] },
      { index: 3, entryIds: ['e4', 'e5', 'e6'] },
    ])
  })

  it('reads no part for no cut over no entry', () => {
    expect(closeParts([], [])).toEqual([])
  })

  it.each<{ name: string; cuts: ChapterPartCut[] }>([
    { name: 'a cut naming an entry the range lacks', cuts: [cut(1, 'e1', 'e9')] },
    { name: 'a gap between two cuts', cuts: [cut(1, 'e1', 'e2'), cut(2, 'e4', 'e6')] },
    { name: 'two cuts sharing an entry', cuts: [cut(1, 'e1', 'e3'), cut(2, 'e3', 'e6')] },
    { name: 'entries after the last cut', cuts: [cut(1, 'e1', 'e5')] },
    { name: 'a first cut past the range start', cuts: [cut(1, 'e2', 'e6')] },
    {
      name: 'a cut ending before it starts',
      cuts: [cut(1, 'e1', 'e1'), cut(2, 'e2', 'e1'), cut(3, 'e2', 'e6')],
    },
    { name: 'parts numbered out of order', cuts: [cut(2, 'e1', 'e3'), cut(1, 'e4', 'e6')] },
    { name: 'no cut over a range of entries', cuts: [] },
  ])('throws on $name', ({ cuts }) => {
    expect(() => closeParts(ENTRIES, cuts)).toThrow(RangeError)
  })
})
