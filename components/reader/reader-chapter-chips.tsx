import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from 'react'

import { useChapterTimeRanges } from '@/hooks/use-chapter-time-ranges'
import type { CalendarFrame } from '@/lib/calendar'
import type { ChapterProgress } from '@/lib/chapters'
import type { StoryEntry } from '@/lib/db'
import { chaptersStore } from '@/lib/stores'
import { branchWorldTime } from '@/lib/world'

import {
  ChapterPopover,
  type ChapterPopoverHandle,
  type ChapterPopoverRow,
} from './chapter-popover'
import { chapterTimeRangeLabel, worldTimeLabel } from './chapter-time-range'
import { TimeChip } from './time-chip'

export type ReaderChapterChipsHandle = { openPopover: () => void }

export type ReaderChapterChipsProps = {
  branchId: string
  entries: readonly StoryEntry[]
  frame: CalendarFrame | null
  progress: ChapterProgress
  isFocused: boolean
  onJumpToEntry: (entryId: string) => void
  /** The popover opening or closing, for the other trigger the host gives it (the progress strip). */
  onOpenChange?: (open: boolean) => void
  ref?: Ref<ReaderChapterChipsHandle>
}

export function ReaderChapterChips({
  branchId,
  entries,
  frame,
  progress,
  isFocused,
  onJumpToEntry,
  onOpenChange,
  ref,
}: ReaderChapterChipsProps): ReactElement {
  const chapterRows = chaptersStore.useChapters((m) => m)
  const closed = useMemo(
    () =>
      [...chapterRows.values()]
        .filter((chapter) => chapter.branchId === branchId)
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    [chapterRows, branchId],
  )

  const [open, setOpen] = useState(false)
  const { ranges, refetch } = useChapterTimeRanges(branchId, { enabled: open })
  // A world-time edit moves no key part and the client never goes stale: only a refetch sees it.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
    if (next) void refetch()
  }

  const rows = useMemo(
    (): ChapterPopoverRow[] =>
      closed.map((chapter) => ({
        id: chapter.id,
        number: chapter.sequenceNumber,
        title: chapter.title,
        rangeLabel: chapterTimeRangeLabel(ranges.get(chapter.id), frame),
        startEntryId: chapter.startEntryId,
      })),
    [closed, ranges, frame],
  )
  const openRange = ranges.get(null)
  const sinceLabel = openRange != null ? worldTimeLabel(openRange.first, frame) : null

  const popoverRef = useRef<ChapterPopoverHandle>(null)
  useImperativeHandle(ref, () => ({ openPopover: () => popoverRef.current?.open() }), [])
  // A portaled overlay would keep painting over the screen pushed on top of this one.
  useEffect(() => {
    if (!isFocused) popoverRef.current?.close()
  }, [isFocused])

  return (
    <>
      <ChapterPopover
        ref={popoverRef}
        closed={rows}
        sinceLabel={sinceLabel}
        progress={progress}
        onOpenChange={handleOpenChange}
        onJumpToChapter={onJumpToEntry}
      />
      <TimeChip seconds={branchWorldTime(entries)} frame={frame} />
    </>
  )
}
