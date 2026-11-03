// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EARTH_GREGORIAN, type CalendarFrame } from '@/lib/calendar'
import type { ChapterProgress } from '@/lib/chapters'
import type { Chapter, StoryEntry } from '@/lib/db'
import { chaptersStore, resetAllStores } from '@/lib/stores'

import type { ChapterPopoverHandle, ChapterPopoverProps } from './chapter-popover'
import { ReaderChapterChips, type ReaderChapterChipsHandle } from './reader-chapter-chips'
import type { TimeChipProps } from './time-chip'

const stubs = vi.hoisted(() => ({
  popover: null as ChapterPopoverProps | null,
  timeChip: null as TimeChipProps | null,
  handle: { open: vi.fn(), close: vi.fn() },
  ranges: new Map<string | null, { first: number; last: number }>(),
  refetch: vi.fn(async () => {}),
  enabled: false,
}))

// The view and the chip have their own stories; this file pins what the connected piece feeds them.
vi.mock('./chapter-popover', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    ChapterPopover: (props: ChapterPopoverProps) => {
      stubs.popover = props
      useImperativeHandle(props.ref, (): ChapterPopoverHandle => stubs.handle, [])
      return null
    },
  }
})
vi.mock('./time-chip', () => ({
  TimeChip: (props: TimeChipProps) => {
    stubs.timeChip = props
    return null
  },
}))
vi.mock('@/hooks/use-chapter-time-ranges', () => ({
  useChapterTimeRanges: (_branchId: string, options: { enabled: boolean }) => {
    stubs.enabled = options.enabled
    return { ranges: stubs.ranges, refetch: stubs.refetch }
  },
}))

const FRAME: CalendarFrame = {
  calendar: EARTH_GREGORIAN,
  origin: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
}

const PROGRESS: ChapterProgress = {
  tokens: 8_420,
  threshold: 24_000,
  percent: 35,
  tone: 'success',
  canClose: true,
}

function chapter(sequenceNumber: number, branchId = 'br_1'): Chapter {
  return {
    id: `${branchId}_chap_${sequenceNumber}`,
    branchId,
    sequenceNumber,
    title: `Title ${sequenceNumber}`,
    startEntryId: `${branchId}_start_${sequenceNumber}`,
  } as Chapter
}

function entry(position: number, worldTime: number): StoryEntry {
  return {
    id: `e${position}`,
    branchId: 'br_1',
    position,
    kind: 'ai_reply',
    metadata: { worldTime },
  } as StoryEntry
}

const jump = vi.fn()

function chips(overrides: { isFocused?: boolean; frame?: CalendarFrame | null } = {}) {
  return (
    <ReaderChapterChips
      branchId="br_1"
      entries={[entry(1, 3_600), entry(2, 7_200)]}
      frame={overrides.frame === undefined ? FRAME : overrides.frame}
      progress={PROGRESS}
      isFocused={overrides.isFocused ?? true}
      onJumpToEntry={jump}
    />
  )
}

describe('ReaderChapterChips', () => {
  beforeEach(() => {
    resetAllStores()
    stubs.popover = null
    stubs.timeChip = null
    stubs.ranges = new Map()
    stubs.enabled = false
    stubs.refetch.mockClear()
    stubs.handle.open.mockClear()
    stubs.handle.close.mockClear()
    jump.mockClear()
  })
  afterEach(() => {
    cleanup()
  })

  it('numbers the open chapter from this branch alone', () => {
    chaptersStore.hydrate('br_1', [chapter(1), chapter(2), chapter(9, 'br_other')])
    render(chips())
    expect(stubs.popover?.number).toBe(3)
  })

  it('numbers the open chapter 1 with no closed chapter', () => {
    render(chips())
    expect(stubs.popover?.number).toBe(1)
    expect(stubs.popover?.closed).toEqual([])
  })

  it('lists this branch closed chapters oldest first, with their ranges', () => {
    chaptersStore.hydrate('br_1', [chapter(2), chapter(1), chapter(9, 'br_other')])
    stubs.ranges = new Map([['br_1_chap_1', { first: 3_600, last: 7_200 }]])
    render(chips())
    expect(stubs.popover?.closed).toEqual([
      {
        id: 'br_1_chap_1',
        number: 1,
        title: 'Title 1',
        rangeLabel: 'January 1, 2024 AD 01:00 → January 1, 2024 AD 02:00',
        startEntryId: 'br_1_start_1',
      },
      {
        id: 'br_1_chap_2',
        number: 2,
        title: 'Title 2',
        rangeLabel: null,
        startEntryId: 'br_1_start_2',
      },
    ])
  })

  it('takes since from the open region first time, alone', () => {
    stubs.ranges = new Map([[null, { first: 3_600, last: 7_200 }]])
    render(chips())
    expect(stubs.popover?.sinceLabel).toBe('January 1, 2024 AD 01:00')
  })

  it('has no since with no open-region time or no frame', () => {
    render(chips())
    expect(stubs.popover?.sinceLabel).toBeNull()
    cleanup()
    stubs.ranges = new Map([[null, { first: 3_600, last: 7_200 }]])
    render(chips({ frame: null }))
    expect(stubs.popover?.sinceLabel).toBeNull()
  })

  it('hands the time chip the tail time and the frame', () => {
    render(chips())
    expect(stubs.timeChip).toEqual({ seconds: 7_200, frame: FRAME })
  })

  it('passes the progress through untouched', () => {
    render(chips())
    expect(stubs.popover?.progress).toBe(PROGRESS)
  })

  it('reads ranges only while open, and refetches on every open', () => {
    render(chips())
    expect(stubs.enabled).toBe(false)
    expect(stubs.refetch).not.toHaveBeenCalled()

    act(() => stubs.popover?.onOpenChange?.(true))
    expect(stubs.enabled).toBe(true)
    expect(stubs.refetch).toHaveBeenCalledTimes(1)

    act(() => stubs.popover?.onOpenChange?.(false))
    expect(stubs.enabled).toBe(false)
    expect(stubs.refetch).toHaveBeenCalledTimes(1)

    act(() => stubs.popover?.onOpenChange?.(true))
    expect(stubs.refetch).toHaveBeenCalledTimes(2)
  })

  it('routes a row press to the jump', () => {
    render(chips())
    stubs.popover?.onJumpToChapter('e1')
    expect(jump).toHaveBeenCalledWith('e1')
  })

  it('leaves both actions absent, so the popover disables them with a reason', () => {
    render(chips())
    expect(stubs.popover?.onCloseChapter).toBeUndefined()
    expect(stubs.popover?.onManageChapters).toBeUndefined()
  })

  it('closes the popover when focus leaves, and not before', () => {
    const { rerender } = render(chips())
    expect(stubs.handle.close).not.toHaveBeenCalled()
    rerender(chips({ isFocused: false }))
    expect(stubs.handle.close).toHaveBeenCalledTimes(1)
  })

  it('opens the popover through its own handle', () => {
    const ref = createRef<ReaderChapterChipsHandle>()
    render(
      <ReaderChapterChips
        ref={ref}
        branchId="br_1"
        entries={[]}
        frame={null}
        progress={PROGRESS}
        isFocused
        onJumpToEntry={jump}
      />,
    )
    ref.current?.openPopover()
    expect(stubs.handle.open).toHaveBeenCalledTimes(1)
  })
})
