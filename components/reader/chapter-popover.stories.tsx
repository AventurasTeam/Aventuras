import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterProgress } from '@/lib/chapters'

import {
  ChapterPopover,
  type ChapterPopoverHandle,
  type ChapterPopoverProps,
  type ChapterPopoverRow,
} from './chapter-popover'

const PHONE = { viewport: { value: 'mobile1' } }
// CI runs plays several times slower than local.
const ANIMATION = { timeout: 3000 }

const CLOSED: ChapterPopoverRow[] = [
  {
    id: 'ch_1',
    number: 1,
    title: 'Into the Undercity',
    rangeLabel: 'Day 1 → Day 2, dawn',
    startEntryId: 'entry_1',
  },
  {
    id: 'ch_2',
    number: 2,
    title: "The Warden's Mark",
    rangeLabel: 'Day 2, dawn → Day 3, dusk',
    startEntryId: 'entry_2',
  },
]

const LONG_LIST: ChapterPopoverRow[] = Array.from({ length: 30 }, (_, i) => ({
  id: `ch_${i + 1}`,
  number: i + 1,
  title: `Chapter title ${i + 1}`,
  rangeLabel: `Day ${i + 1}`,
  startEntryId: `entry_${i + 1}`,
}))

const PROGRESS: ChapterProgress = {
  tokens: 8_420,
  threshold: 24_000,
  percent: 35.08,
  tone: 'success',
  canClose: true,
  startEntryId: 'entry_3',
}

// Right after a close at the tail: the open chapter has no entry to jump to.
const EMPTY_OPEN: ChapterProgress = { ...PROGRESS, tokens: 0, percent: 0, startEntryId: null }

function TierMark() {
  return <Text testID="tier">{useTier()}</Text>
}

// gorhom's container fills this stage, so a detent is a share of the stage's height.
function Stage({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions()
  return (
    <View style={{ height, padding: 16, gap: 8, alignItems: 'flex-start' }}>
      <TierMark />
      {children}
    </View>
  )
}

const dialog = () => screen.getByRole('dialog', { name: 'Chapters' })
const chip = (number = 3) => screen.findByRole('button', { name: `Chapter ${number}` })
const listScroller = () => screen.findByTestId('chapter-popover-list')

async function waitForTier(tier: 'desktop' | 'phone') {
  await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent(tier))
}

async function openOverlay(number = 3) {
  await userEvent.click(await chip(number))
  await waitFor(() => expect(screen.getByText(`${number} · in progress`)).toBeVisible(), ANIMATION)
}

// gorhom's content keeps rising after it turns visible; a click on a row below the window makes
// the browser scroll the container and lift the Sheet.
async function waitForSheetSettled() {
  let last = Number.NaN
  let still = 0
  await waitFor(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const top = dialog().getBoundingClientRect().top
    still = Math.abs(top - last) < 0.5 ? still + 1 : 0
    last = top
    expect(still).toBeGreaterThanOrEqual(5)
  }, ANIMATION)
}

async function expectOpenedOnLastRow() {
  const list = await listScroller()
  await waitFor(() => {
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    expect(list.scrollTop + list.clientHeight).toBeGreaterThanOrEqual(list.scrollHeight - 1)
  }, ANIMATION)
  const openRow = screen.getByText(/^\d+ · in progress$/).getBoundingClientRect()
  expect(openRow.bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom)
}

function expectClosedBeforeCalled(onOpenChange: unknown, callback: unknown) {
  const opens = onOpenChange as ReturnType<typeof fn>
  const closedAt = opens.mock.calls.findIndex(([open]) => open === false)
  expect(closedAt).toBeGreaterThanOrEqual(0)
  const called = (callback as ReturnType<typeof fn>).mock.invocationCallOrder[0]
  expect(opens.mock.invocationCallOrder[closedAt]).toBeLessThan(called)
}

const meta: Meta<typeof ChapterPopover> = {
  title: 'Compounds/Reader/ChapterPopover',
  component: ChapterPopover,
  parameters: { layout: 'fullscreen' },
  args: {
    closed: CLOSED,
    sinceLabel: 'Day 3, dusk',
    progress: PROGRESS,
    onOpenChange: fn(),
    onJumpToChapter: fn(),
  },
  decorators: [
    (Story) => (
      <Stage>
        <Story />
      </Stage>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ChapterPopover>

async function expectRowOrder() {
  const list = await listScroller()
  await expect(list).toHaveTextContent(
    /^1 · Into the Undercity.*2 · The Warden's Mark.*3 · in progress/,
  )
  const openRow = screen.getByTestId('chapter-popover-open').getBoundingClientRect()
  expect(openRow.top).toBeGreaterThanOrEqual(list.getBoundingClientRect().top)
}

async function expectContents(args: ChapterPopoverProps) {
  await expectRowOrder()
  await expect(screen.getByRole('button', { name: /1 · Into the Undercity/ })).toBeVisible()
  await expect(screen.getByText('Day 1 → Day 2, dawn')).toBeVisible()
  await expect(screen.getByRole('button', { name: /2 · The Warden's Mark/ })).toBeVisible()
  await expect(screen.getByText('Day 2, dawn → Day 3, dusk')).toBeVisible()

  // Pressable like the closed rows, and no resting fill that would read as a selection.
  const openRow = screen.getByRole('button', { name: /3 · in progress/ })
  await expect(openRow).toBe(screen.getByTestId('chapter-popover-open'))
  await expect(openRow).toHaveTextContent('since Day 3, dusk')
  await expect(openRow).not.toHaveClass('bg-tint-press')
  await expect(screen.getByText('3 · in progress')).toHaveClass('font-medium')

  await expect(screen.getByText('chapter progress · 8,420 / 24,000 tok')).toBeVisible()
  const fill = screen.getByTestId('chapter-progress-fill')
  await expect(fill).toHaveClass('bg-success')
  const track = fill.parentElement?.getBoundingClientRect().width ?? Number.NaN
  expect(fill.getBoundingClientRect().width / track).toBeCloseTo(0.35, 1)

  const closeChapter = screen.getByRole('button', { name: 'Close chapter manually' })
  await expect(closeChapter).toHaveAttribute('aria-disabled', 'true')
  await expect(screen.getByTitle('Closing a chapter lands in a later milestone')).toContainElement(
    closeChapter,
  )
  const manage = screen.getByRole('button', { name: 'Manage chapters →' })
  await expect(manage).toHaveAttribute('aria-disabled', 'true')
  await expect(screen.getByTitle('Chapter Timeline lands in a later milestone')).toContainElement(
    manage,
  )
  // RN-Web blocks a disabled Pressable's pointer; fireEvent goes past that to its guard.
  fireEvent.click(closeChapter)
  fireEvent.click(manage)
  await expect(args.onOpenChange).not.toHaveBeenCalledWith(false)
}

export const Desktop: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay()
    await expectContents(args)
    await expect(args.onOpenChange).toHaveBeenCalledWith(true)
    // Both surfaces are dialogs; only the Popover sits inside Radix's popper wrapper.
    await expect(
      screen.getByText('3 · in progress').closest('[data-radix-popper-content-wrapper]'),
    ).not.toBeNull()
  },
}

export const Phone: Story = {
  globals: PHONE,
  play: async ({ args }) => {
    await waitForTier('phone')
    await openOverlay()
    await waitForSheetSettled()
    await expectContents(args)
    await expect(args.onOpenChange).toHaveBeenCalledWith(true)
    await expect(
      screen.getByText('3 · in progress').closest('[data-radix-popper-content-wrapper]'),
    ).toBeNull()
    await expect(await chip()).toHaveAttribute('aria-expanded', 'true')
    // The medium detent: a taller or shorter size would change this share of the window.
    const share = dialog().getBoundingClientRect().height / window.innerHeight
    expect(share).toBeGreaterThan(0.5)
    expect(share).toBeLessThan(0.65)
  },
}

export const NoTimes: Story = {
  args: {
    closed: CLOSED.map((row) => ({ ...row, rangeLabel: null })),
    sinceLabel: null,
  },
  play: async () => {
    await waitForTier('desktop')
    await openOverlay()
    await expect(screen.getByText('1 · Into the Undercity')).toBeVisible()
    await expect(screen.queryByText(/^Day/)).toBeNull()
    await expect(screen.queryByText(/^since/)).toBeNull()
    // A null range label leaves the title as the row's only text.
    const row = screen.getByRole('button', { name: /1 · Into the Undercity/ })
    expect(row.querySelectorAll('[dir="auto"]')).toHaveLength(1)
  },
}

// The default calendar's real label, which measured wider than both overlays.
const LONG_RANGE = 'September 12, 2024 AD 01:00 → September 14, 2024 AD 02:00'

async function expectRangeFits() {
  const ranges = screen.getAllByText(LONG_RANGE)
  expect(ranges).toHaveLength(2)
  for (const range of ranges) {
    await expect(range).toBeVisible()
    expect(range.scrollWidth).toBeLessThanOrEqual(range.clientWidth)
  }
}

export const LongRange: Story = {
  args: { closed: CLOSED.map((row) => ({ ...row, rangeLabel: LONG_RANGE })) },
  play: async () => {
    await waitForTier('desktop')
    await openOverlay()
    await expectRangeFits()
  },
}

export const LongRangePhone: Story = {
  globals: PHONE,
  args: { closed: CLOSED.map((row) => ({ ...row, rangeLabel: LONG_RANGE })) },
  play: async () => {
    await waitForTier('phone')
    await openOverlay()
    await waitForSheetSettled()
    await expectRangeFits()
  },
}

export const JumpClosesFirst: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay()
    await userEvent.click(screen.getByRole('button', { name: /2 · The Warden's Mark/ }))

    await expect(args.onJumpToChapter).toHaveBeenCalledTimes(1)
    await expect(args.onJumpToChapter).toHaveBeenCalledWith('entry_2')
    expectClosedBeforeCalled(args.onOpenChange, args.onJumpToChapter)
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
  },
}

export const OpenRowJumpsToItsStart: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay()
    await userEvent.click(screen.getByRole('button', { name: /3 · in progress/ }))

    await expect(args.onJumpToChapter).toHaveBeenCalledTimes(1)
    await expect(args.onJumpToChapter).toHaveBeenCalledWith('entry_3')
    expectClosedBeforeCalled(args.onOpenChange, args.onJumpToChapter)
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
  },
}

export const EmptyOpenRowIsPlain: Story = {
  args: { progress: EMPTY_OPEN },
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay()
    const openRow = screen.getByTestId('chapter-popover-open')
    await expect(openRow).not.toHaveAttribute('role', 'button')
    await expect(screen.queryByRole('button', { name: /3 · in progress/ })).toBeNull()
    await expect(screen.getByRole('button', { name: /2 · The Warden's Mark/ })).toBeVisible()

    await userEvent.click(openRow)
    await expect(args.onJumpToChapter).not.toHaveBeenCalled()
    await expect(screen.getByText('3 · in progress')).toBeVisible()
  },
}

export const JumpClosesFirstPhone: Story = {
  globals: PHONE,
  play: async ({ args }) => {
    await waitForTier('phone')
    await openOverlay()
    await waitForSheetSettled()
    await userEvent.click(screen.getByRole('button', { name: /2 · The Warden's Mark/ }))

    await expect(args.onJumpToChapter).toHaveBeenCalledWith('entry_2')
    expectClosedBeforeCalled(args.onOpenChange, args.onJumpToChapter)
    await waitFor(async () => expect(await chip()).toHaveAttribute('aria-expanded', 'false'))
  },
}

export const ActionsClose: Story = {
  args: { onCloseChapter: fn(), onManageChapters: fn() },
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay()
    const closeChapter = screen.getByRole('button', { name: 'Close chapter manually' })
    await expect(closeChapter).not.toHaveAttribute('aria-disabled', 'true')
    await expect(screen.queryByTitle('Closing a chapter lands in a later milestone')).toBeNull()

    await userEvent.click(closeChapter)
    await expect(args.onCloseChapter).toHaveBeenCalledTimes(1)
    expectClosedBeforeCalled(args.onOpenChange, args.onCloseChapter)
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())

    await openOverlay()
    await userEvent.click(screen.getByRole('button', { name: 'Manage chapters →' }))
    await expect(args.onManageChapters).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
  },
}

export const LongListDesktop: Story = {
  args: { closed: LONG_LIST },
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()
    await expect((await listScroller()).clientHeight).toBeLessThanOrEqual(320)
  },
}

export const LongListPhone: Story = {
  globals: PHONE,
  args: { closed: LONG_LIST },
  play: async () => {
    await waitForTier('phone')
    await openOverlay(31)
    await waitForSheetSettled()
    await expectOpenedOnLastRow()
    await expect(screen.getByRole('button', { name: 'Manage chapters →' })).toBeVisible()
  },
}

// Radix focuses the first tabbable on open, far above the last row, which drags the list up.
export const FocusStartsOnLastRow: Story = {
  args: { closed: LONG_LIST },
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()
    const openRow = screen.getByRole('button', { name: /31 · in progress/ })
    await waitFor(() => expect(openRow).toHaveFocus(), ANIMATION)
    await expectOpenedOnLastRow()
  },
}

export const FocusSkipsAnEmptyOpenRow: Story = {
  args: { closed: LONG_LIST, progress: EMPTY_OPEN },
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()
    const lastClosedRow = screen.getByRole('button', { name: /30 · Chapter title 30/ })
    await waitFor(() => expect(lastClosedRow).toHaveFocus(), ANIMATION)
    await expectOpenedOnLastRow()
  },
}

// Chapter 1 still open: its row is the only way back to the branch's first entry.
export const NoClosedRows: Story = {
  args: { closed: [], progress: { ...PROGRESS, startEntryId: 'entry_1' } },
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay(1)
    const openRow = screen.getByRole('button', { name: /1 · in progress/ })
    await waitFor(() => expect(openRow).toHaveFocus(), ANIMATION)
    await userEvent.click(openRow)
    await expect(args.onJumpToChapter).toHaveBeenCalledWith('entry_1')
  },
}

export const NoRowToFocus: Story = {
  args: { closed: [], progress: EMPTY_OPEN },
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(1)
    // Without a row to focus, Radix's own focus stays on its content.
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-radix-popper-content-wrapper]')).not.toBeNull(),
    )
  },
}

// A cold open lists the rows before the read lands, and each row grows by its range line.
function RangesLandHarness(props: ChapterPopoverProps) {
  const [closed, setClosed] = useState(props.closed)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') setClosed(LONG_LIST)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return <ChapterPopover {...props} closed={closed} />
}

export const LongListRangesLand: Story = {
  args: { closed: LONG_LIST.map((row) => ({ ...row, rangeLabel: null })) },
  render: (args) => <RangesLandHarness {...args} />,
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()

    await userEvent.keyboard('{F2}')
    await screen.findByText('Day 30')
    await expectOpenedOnLastRow()
  },
}

const twoFrames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

/**
 * Web has no drag: a scroll up the list, by wheel, key or scrollbar, keeps the reader's place, so
 * rows landing later don't pull it back. Setting `scrollTop` stands in for any of them.
 */
export const LongListScrollUpKeepsPlace: Story = {
  args: { closed: LONG_LIST.map((row) => ({ ...row, rangeLabel: null })) },
  render: (args) => <RangesLandHarness {...args} />,
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()

    const list = await listScroller()
    list.scrollTop = 0
    await twoFrames()
    await userEvent.keyboard('{F2}')
    await screen.findByText('Day 30')
    await twoFrames()
    expect(list.scrollTop).toBe(0)
  },
}

// A closed row going away while the list is open (an undone close), then the open row's line.
function RowLeavesHarness(props: ChapterPopoverProps) {
  const [closed, setClosed] = useState(props.closed)
  const [sinceLabel, setSinceLabel] = useState(props.sinceLabel)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F3') setClosed(LONG_LIST.slice(0, -1))
      if (event.key === 'F4') setSinceLabel('Day 30, dusk')
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return <ChapterPopover {...props} closed={closed} sinceLabel={sinceLabel} />
}

/** A shrink clamps the offset with no input, so the list stays pinned to the open row. */
export const LongListShrinkKeepsPin: Story = {
  args: { closed: LONG_LIST, sinceLabel: null },
  render: (args) => <RowLeavesHarness {...args} />,
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()

    const list = await listScroller()
    // Chromium's scroll anchoring happens to hide a lost pin here; the pin must hold without it.
    list.style.overflowAnchor = 'none'
    const pinnedTop = list.scrollTop
    await userEvent.keyboard('{F3}')
    await waitFor(() => expect(list.scrollTop).toBeLessThan(pinnedTop))
    await twoFrames()
    await userEvent.keyboard('{F4}')
    await screen.findByText(/Day 30, dusk/)
    await expectOpenedOnLastRow()
  },
}

/** A scroll up in the shrink's own frame is still the reader's, so the list lets go. */
export const LongListShrinkWithAScrollUpUnpins: Story = {
  args: { closed: LONG_LIST, sinceLabel: null },
  render: (args) => <RowLeavesHarness {...args} />,
  play: async () => {
    await waitForTier('desktop')
    await openOverlay(31)
    await expectOpenedOnLastRow()

    const list = await listScroller()
    list.style.overflowAnchor = 'none'
    // A microtask after the commit runs before the frame's scroll event, so one event carries both.
    const scrolledUp = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (screen.queryByText('Day 30') != null) return
        observer.disconnect()
        list.scrollTop = 0
        resolve()
      })
      observer.observe(list, { childList: true, subtree: true })
    })
    await userEvent.keyboard('{F3}')
    await scrolledUp
    await twoFrames()
    await userEvent.keyboard('{F4}')
    await screen.findByText(/Day 30, dusk/)
    await twoFrames()
    expect(list.scrollTop).toBe(0)
  },
}

/** A wheel over a list too short to scroll moves nothing, so the list stays pinned as it grows. */
export const ShortListWheelThenGrowsShowsLastRow: Story = {
  args: { closed: LONG_LIST.slice(0, 2) },
  render: (args) => <RangesLandHarness {...args} />,
  play: async () => {
    await waitForTier('desktop')
    await openOverlay()
    const list = await listScroller()
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight)

    list.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }))
    await twoFrames()
    await userEvent.keyboard('{F2}')
    await screen.findByText('Day 30')
    await expectOpenedOnLastRow()
  },
}

/** Runs `play` with the window resized, then puts it back; a no-op outside Vitest. */
async function withWindowSize(
  size: { width?: number; height?: number },
  play: () => Promise<void>,
) {
  const browser = await import('vitest/browser').catch(() => null)
  if (browser == null) return
  const original = { width: window.innerWidth, height: window.innerHeight }
  await browser.page.viewport(size.width ?? original.width, size.height ?? original.height)
  try {
    await play()
  } finally {
    await browser.page.viewport(original.width, original.height)
  }
}

const withWindowWidth = (width: number, play: () => Promise<void>) =>
  withWindowSize({ width }, play)

// Electron sets no minimum window height; the popover measures about 472 px with a long list.
export const LongListShortWindowKeepsActions: Story = {
  args: { closed: LONG_LIST },
  play: async () => {
    await withWindowSize({ height: 380 }, async () => {
      await waitForTier('desktop')
      await openOverlay(31)
      const manage = screen.getByRole('button', { name: 'Manage chapters →' })
      await waitFor(() =>
        expect(manage.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight),
      )
      const list = await listScroller()
      await expect(list.clientHeight).toBeGreaterThan(0)
      await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
      await expectOpenedOnLastRow()
    })
  },
}

// The open arm unmounts with the tier; its owner would otherwise keep reading an overlay that's
// gone.
export const TierFlipToPhoneReportsClosed: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openOverlay()
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(true)
    await withWindowWidth(400, async () => {
      await waitForTier('phone')
      await expect(await chip()).toHaveAttribute('aria-expanded', 'false')
      await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
    })
    // The flip back unmounts a closed arm, which has nothing to report.
    await waitForTier('desktop')
    await expect(args.onOpenChange).toHaveBeenCalledTimes(2)
  },
}

export const TierFlipToDesktopReportsClosed: Story = {
  globals: PHONE,
  play: async ({ args }) => {
    await waitForTier('phone')
    await openOverlay()
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(true)
    await withWindowWidth(1200, async () => {
      await waitForTier('desktop')
      await expect(await chip()).toHaveAttribute('aria-expanded', 'false')
      await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
    })
    // The flip back unmounts a closed arm, which has nothing to report.
    await waitForTier('phone')
    await expect(args.onOpenChange).toHaveBeenCalledTimes(2)
  },
}

// A key, not a button: a click outside the popover would dismiss it before the handle's close.
function HandleHarness(props: ChapterPopoverProps) {
  const handle = useRef<ChapterPopoverHandle>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') handle.current?.open()
      if (event.key === 'F3') handle.current?.close()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return <ChapterPopover {...props} ref={handle} />
}

export const HandleOpensAndCloses: Story = {
  render: (args) => <HandleHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('desktop')
    await chip()
    await userEvent.keyboard('{F3}')
    await expect(args.onOpenChange).not.toHaveBeenCalled()

    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(screen.getByText('3 · in progress')).toBeVisible(), ANIMATION)
    await expect(args.onOpenChange).toHaveBeenCalledTimes(1)
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(true)

    await userEvent.keyboard('{F3}')
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
    await expect(args.onOpenChange).toHaveBeenCalledTimes(2)
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
  },
}

// Stands in for the reader's progress strip: a press outside the popover that calls `open()`.
function OutsideOpenerHarness(props: ChapterPopoverProps) {
  const handle = useRef<ChapterPopoverHandle>(null)
  return (
    <>
      <Pressable role="button" aria-label="Outside opener" onPress={() => handle.current?.open()}>
        <Text>Outside opener</Text>
      </Pressable>
      <ChapterPopover {...props} ref={handle} />
    </>
  )
}

const openCalls = (onOpenChange: unknown) =>
  (onOpenChange as ReturnType<typeof fn>).mock.calls.map(([open]) => open)

/** Radix closes on the press's pointerdown; the press itself must not open it again. */
export const OutsideOpenerToggles: Story = {
  render: (args) => <OutsideOpenerHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('desktop')
    const opener = screen.getByRole('button', { name: 'Outside opener' })
    await userEvent.click(opener)
    await waitFor(() => expect(screen.getByText('3 · in progress')).toBeVisible(), ANIMATION)

    await userEvent.click(opener)
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
    await twoFrames()
    expect(openCalls(args.onOpenChange)).toEqual([true, false])

    // The next press opens it, and the chip still toggles.
    await userEvent.click(opener)
    await waitFor(() => expect(screen.getByText('3 · in progress')).toBeVisible(), ANIMATION)
    await userEvent.click(await chip())
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
    expect(openCalls(args.onOpenChange)).toEqual([true, false, true, false])

    // Closed by a press elsewhere, then opened from the keyboard.
    await openOverlay()
    await userEvent.click(screen.getByTestId('tier'))
    await waitFor(() => expect(screen.queryByText('3 · in progress')).toBeNull())
    opener.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByText('3 · in progress')).toBeVisible(), ANIMATION)
    expect(openCalls(args.onOpenChange)).toEqual([true, false, true, false, true, false, true])
  },
}

export const HandleOnPhone: Story = {
  globals: PHONE,
  render: (args) => <HandleHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('phone')
    const trigger = await chip()
    await userEvent.keyboard('{F2}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(args.onOpenChange).not.toHaveBeenCalled()

    await userEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
    await userEvent.keyboard('{F3}')
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
  },
}
