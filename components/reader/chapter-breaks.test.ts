import { describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'
import type { StoreChapter } from '@/lib/stores'

import { chapterBreaksOf } from './chapter-breaks'

const chapter = (sequenceNumber: number, endEntryId: string, branchId = 'br_1'): StoreChapter => ({
  id: `chap_${sequenceNumber}`,
  branchId,
  sequenceNumber,
  title: `Chapter ${sequenceNumber}`,
  summary: '',
  theme: '',
  keywords: [],
  startEntryId: `start_${sequenceNumber}`,
  endEntryId,
  tokenCount: 0,
  closedAt: 1,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
  hasCloseReport: false,
})

const row = (id: string, branchId = 'br_1') => ({ id, branchId }) as StoryEntry

describe('chapterBreaksOf', () => {
  it('keys one break per closed chapter by its end entry, naming the next chapter', () => {
    expect(
      chapterBreaksOf(
        [chapter(1, 'e10'), chapter(2, 'e20')],
        [row('e10'), row('e11'), row('e20')],
        {
          e10: { label: 'Day 2, dawn', raw: 90 },
          e20: { label: 'Day 5, dusk', raw: 180 },
        },
      ),
    ).toEqual({
      e10: { number: 2, timeLabel: 'Day 2, dawn' },
      e20: { number: 3, timeLabel: 'Day 5, dusk' },
    })
  })

  it('has no break for a chapter whose end row is not loaded', () => {
    expect(chapterBreaksOf([chapter(1, 'e10'), chapter(2, 'e20')], [row('e20')], {})).toEqual({
      e20: { number: 3 },
    })
  })

  it('has no break for a row with the end id on another branch', () => {
    expect(chapterBreaksOf([chapter(1, 'e10')], [row('e10', 'br_fork')], {})).toEqual({})
  })

  it('finds the end row among copies of it on other branches', () => {
    expect(chapterBreaksOf([chapter(1, 'e10')], [row('e10', 'br_fork'), row('e10')], {})).toEqual({
      e10: { number: 2 },
    })
  })

  it('leaves timeLabel absent when the decoration is missing', () => {
    const breaks = chapterBreaksOf([chapter(1, 'e10')], [row('e10')], {})
    expect(breaks).toStrictEqual({ e10: { number: 2 } })
  })

  it('is empty with no closed chapter', () => {
    expect(chapterBreaksOf([], [row('e1')], {})).toEqual({})
  })
})
