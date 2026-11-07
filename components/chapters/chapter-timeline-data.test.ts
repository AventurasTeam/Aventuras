import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CALENDAR_ID,
  MAX_WORLD_TIME_SECONDS,
  resolveCalendar,
  type CalendarFrame,
} from '@/lib/calendar'
import type { ChapterTimeRanges } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import type { StoreChapter } from '@/lib/stores'

import { chapterTimelineData } from './chapter-timeline-data'

const FRAME: CalendarFrame = {
  calendar: resolveCalendar(DEFAULT_CALENDAR_ID),
  origin: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
}
const NO_RANGES: ChapterTimeRanges = new Map()
const NO_INDEX: EntryIndex = new Map()

function chapter(sequenceNumber: number, branchId = 'br_1'): StoreChapter {
  return {
    id: `${branchId}_chap_${sequenceNumber}`,
    branchId,
    sequenceNumber,
    title: `Title ${sequenceNumber}`,
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: `${branchId}_start_${sequenceNumber}`,
    endEntryId: `${branchId}_end_${sequenceNumber}`,
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: false,
  }
}

function entryIndex(...refs: [id: string, position: number][]): EntryIndex {
  return new Map<string, EntryRef>(
    refs.map(([id, position]) => [
      id,
      { id, position, kind: 'ai_reply', chapterId: null, excerpt: '' },
    ]),
  )
}

type Overrides = {
  ranges?: ChapterTimeRanges
  entryIndex?: EntryIndex
  frame?: CalendarFrame | null
}

function data(rows: Iterable<StoreChapter>, overrides: Overrides = {}) {
  return chapterTimelineData({
    branchId: 'br_1',
    rows,
    ranges: overrides.ranges ?? NO_RANGES,
    entryIndex: overrides.entryIndex ?? NO_INDEX,
    frame: overrides.frame === undefined ? FRAME : overrides.frame,
  })
}

describe('chapterTimelineData', () => {
  it('orders the cards by sequence number whatever the input order', () => {
    const { cards } = data([chapter(10), chapter(2), chapter(9)])
    expect(cards.map((card) => card.row.id)).toEqual(['br_1_chap_2', 'br_1_chap_9', 'br_1_chap_10'])
    expect(cards.map((card) => card.number)).toEqual([2, 9, 10])
  })

  it("keeps only the branch's rows and counts them", () => {
    const { cards, closedCount } = data([chapter(1), chapter(4, 'br_2'), chapter(2)])
    expect(cards.map((card) => card.row.id)).toEqual(['br_1_chap_1', 'br_1_chap_2'])
    expect(closedCount).toBe(2)
  })

  it('flags only the highest sequence on the branch as latest', () => {
    const { cards } = data([chapter(10), chapter(2), chapter(9), chapter(11, 'br_2')])
    expect(cards.filter((card) => card.latest).map((card) => card.row.id)).toEqual(['br_1_chap_10'])
  })

  it('gives no cards for a branch with no closed chapter', () => {
    expect(data([chapter(1, 'br_2')])).toEqual({ cards: [], closedCount: 0, sinceLabel: null })
  })

  it('carries the store row itself', () => {
    const row = chapter(1)
    expect(data([row]).cards[0].row).toBe(row)
  })

  it("takes the store map's values iterator", () => {
    const row = chapter(1)
    expect(data(new Map([[row.id, row]]).values()).closedCount).toBe(1)
  })

  it("labels a chapter's time range through the calendar", () => {
    const row = chapter(1)
    const ranges: ChapterTimeRanges = new Map([[row.id, { first: 3_600, last: 7_200 }]])
    expect(data([row], { ranges }).cards[0].timeLabel).toBe(
      'January 1, 2024 AD 01:00 → January 1, 2024 AD 02:00',
    )
  })

  it('has no time label for a chapter missing from the ranges, a format miss, or no frame', () => {
    const missed = chapter(1)
    const absent = chapter(2)
    const pastTheEnd: ChapterTimeRanges = new Map([
      [missed.id, { first: 3_600, last: MAX_WORLD_TIME_SECONDS + 1 }],
      [null, { first: 3_600, last: 7_200 }],
    ])
    expect(data([missed, absent], { ranges: pastTheEnd }).cards.map((c) => c.timeLabel)).toEqual([
      null,
      null,
    ])

    const valid: ChapterTimeRanges = new Map([[missed.id, { first: 3_600, last: 7_200 }]])
    expect(data([missed], { ranges: valid, frame: null }).cards[0].timeLabel).toBeNull()
  })

  it('reads the entry range from the index positions', () => {
    const row = chapter(1)
    const index = entryIndex([row.startEntryId, 12], [row.endEntryId, 34])
    expect(data([row], { entryIndex: index }).cards[0].entryRange).toEqual({ first: 12, last: 34 })
  })

  it('has no entry range when either end is missing from the index', () => {
    const row = chapter(1)
    const startOnly = entryIndex([row.startEntryId, 12])
    const endOnly = entryIndex([row.endEntryId, 34])
    expect(data([row], { entryIndex: startOnly }).cards[0].entryRange).toBeNull()
    expect(data([row], { entryIndex: endOnly }).cards[0].entryRange).toBeNull()
    expect(data([row]).cards[0].entryRange).toBeNull()
  })

  it("labels the open region's start", () => {
    const ranges: ChapterTimeRanges = new Map([[null, { first: 3_600, last: 7_200 }]])
    expect(data([], { ranges }).sinceLabel).toBe('January 1, 2024 AD 01:00')
  })

  it('has no since label without an open-region range or a frame', () => {
    const row = chapter(1)
    const closedOnly: ChapterTimeRanges = new Map([[row.id, { first: 3_600, last: 7_200 }]])
    expect(data([row], { ranges: closedOnly }).sinceLabel).toBeNull()

    const open: ChapterTimeRanges = new Map([[null, { first: 3_600, last: 7_200 }]])
    expect(data([], { ranges: open, frame: null }).sinceLabel).toBeNull()
  })
})
