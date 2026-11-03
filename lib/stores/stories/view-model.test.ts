import { describe, expect, it } from 'vitest'

import type { Story } from '@/lib/db'

import { toStoryCardData } from './view-model'

const NOW = 2_000_000_000_000 // unix ms

function row(partial: Partial<Story>): Story {
  return {
    id: 's1',
    title: 'Aria',
    description: null,
    tags: [],
    coverAssetId: null,
    accentColor: null,
    status: 'active',
    favorite: 0,
    lastOpenedAt: null,
    definition: null,
    settings: null,
    createdAt: 1,
    updatedAt: 1,
    currentBranchId: null,
    ...partial,
  } as Story
}

describe('toStoryCardData', () => {
  it('spreads the row through and adds the two derived display fields', () => {
    const data = toStoryCardData(
      row({
        favorite: 1,
        status: 'active',
        lastOpenedAt: NOW - 7_200_000,
        definition: { mode: 'adventure', genre: { label: 'Dark Fantasy' } } as never,
      }),
      NOW,
      new Map([['s1', 3]]),
    )
    expect(data).toMatchObject({
      id: 's1',
      title: 'Aria',
      status: 'active',
      favorite: 1,
      definition: { mode: 'adventure', genre: { label: 'Dark Fantasy' } },
      chapterLabel: 'Chapter 3',
      lastOpenedRelative: '2h ago',
    })
  })

  it('formats lastOpenedRelative from the row and yields chapterLabel null on a draft', () => {
    const data = toStoryCardData(
      row({ status: 'draft', lastOpenedAt: null }),
      NOW,
      new Map([['s1', 3]]),
    )
    expect(data.status).toBe('draft')
    expect(data.lastOpenedRelative).toBe('Never')
    expect(data.chapterLabel).toBeNull()
  })

  it('reads a story with no number as Chapter 1', () => {
    expect(toStoryCardData(row({}), NOW, new Map()).chapterLabel).toBe('Chapter 1')
  })

  it('leaves the label null until the numbers are read', () => {
    expect(toStoryCardData(row({}), NOW, null).chapterLabel).toBeNull()
  })

  it('keeps the label on an archived story', () => {
    const data = toStoryCardData(row({ status: 'archived' }), NOW, new Map([['s1', 2]]))
    expect(data.chapterLabel).toBe('Chapter 2')
  })
})
