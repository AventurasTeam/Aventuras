import { describe, expect, it } from 'vitest'

import type { Story as StoryRow } from '@/lib/db'

import { toStoryCardVM } from './view-model'

const NOW = 2_000_000

function row(partial: Partial<StoryRow>): StoryRow {
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
  } as StoryRow
}

describe('toStoryCardVM', () => {
  it('maps an active story with full definition', () => {
    const vm = toStoryCardVM(
      row({
        favorite: 1,
        lastOpenedAt: NOW - 7200,
         
        definition: { mode: 'adventure', genre: { label: 'Dark Fantasy' } } as any,
      }),
      NOW,
    )
    expect(vm).toMatchObject({
      mode: 'adventure',
      genreLabel: 'Dark Fantasy',
      favorited: true,
      archived: false,
      isDraft: false,
      chapterLabel: null,
      lastOpenedRelative: '2h ago',
    })
  })

  it('tolerates a draft with null definition', () => {
    const vm = toStoryCardVM(row({ status: 'draft', definition: null }), NOW)
    expect(vm).toMatchObject({ mode: 'creative', genreLabel: null, isDraft: true })
  })

  it('marks archived from status', () => {
    expect(toStoryCardVM(row({ status: 'archived' }), NOW).archived).toBe(true)
  })
})
