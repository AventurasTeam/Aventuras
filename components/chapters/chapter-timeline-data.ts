import { chapterTimeRangeLabel, worldTimeLabel } from '@/components/reader/chapter-time-range'
import type { CalendarFrame } from '@/lib/calendar'
import type { ChapterTimeRanges } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import type { StoreChapter } from '@/lib/stores'

export type ChapterCardData = {
  /** The store row, by identity. */
  row: StoreChapter
  /** The stored sequence number, not a display index. */
  number: number
  latest: boolean
  timeLabel: string | null
  entryRange: { first: number; last: number } | null
}

export type ChapterTimelineData = {
  cards: readonly ChapterCardData[]
  closedCount: number
  /** The open region's first world time, as a label; null without one. */
  sinceLabel: string | null
}

function entryRangeOf(row: StoreChapter, entryIndex: EntryIndex): ChapterCardData['entryRange'] {
  const first = entryIndex.get(row.startEntryId)?.position
  const last = entryIndex.get(row.endEntryId)?.position
  return first == null || last == null ? null : { first, last }
}

/** One branch's closed chapters as card props, oldest first. */
export function chapterTimelineData({
  branchId,
  rows,
  ranges,
  entryIndex,
  frame,
}: {
  branchId: string
  rows: Iterable<StoreChapter>
  ranges: ChapterTimeRanges
  entryIndex: EntryIndex
  frame: CalendarFrame | null
}): ChapterTimelineData {
  const kept = Array.from(rows)
    .filter((row) => row.branchId === branchId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
  const cards = kept.map(
    (row, index): ChapterCardData => ({
      row,
      number: row.sequenceNumber,
      latest: index === kept.length - 1,
      timeLabel: chapterTimeRangeLabel(ranges.get(row.id), frame),
      entryRange: entryRangeOf(row, entryIndex),
    }),
  )
  const open = ranges.get(null)
  return {
    cards,
    closedCount: kept.length,
    sinceLabel: open == null ? null : worldTimeLabel(open.first, frame),
  }
}
