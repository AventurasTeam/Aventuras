import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useRef, useState } from 'react'
import { Pressable } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { ScreenShell } from '@/components/shells/screen-shell'
import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'
import { chaptersStore, type StoreChapter } from '@/lib/stores'

import {
  ReaderChapterChips,
  type ReaderChapterChipsHandle,
  type ReaderChapterChipsProps,
} from './reader-chapter-chips'

const BRANCH = 'br_chips'

const noop = () => {}

const closedChapter = (sequenceNumber: number): StoreChapter => ({
  id: `chap_${sequenceNumber}`,
  branchId: BRANCH,
  sequenceNumber,
  title: `Chapter title ${sequenceNumber}`,
  summary: '',
  theme: '',
  keywords: [],
  startEntryId: `entry_${sequenceNumber}`,
  endEntryId: `entry_${sequenceNumber}_end`,
  tokenCount: 0,
  closedAt: 1,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
  hasCloseReport: false,
})

const ARGS: ReaderChapterChipsProps = {
  branchId: BRANCH,
  entries: [
    {
      id: 'tail',
      branchId: BRANCH,
      position: 1,
      kind: 'ai_reply',
      metadata: { worldTime: 3_600 },
    } as StoryEntry,
  ],
  frame: {
    calendar: EARTH_GREGORIAN,
    origin: { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
  },
  progress: {
    tokens: 8_420,
    threshold: 24_000,
    percent: 35,
    tone: 'success',
    canClose: true,
    startEntryId: 'tail',
  },
  isFocused: true,
  onJumpToEntry: noop,
  onManageChapters: noop,
}

const meta = {
  title: 'Compounds/Reader/ReaderChapterChips',
  component: ReaderChapterChips,
  args: ARGS,
  render: (args) => (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      centerExtras={<ReaderChapterChips {...args} />}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <Text>Body</Text>
    </ScreenShell>
  ),
  beforeEach: () => {
    chaptersStore.hydrate(BRANCH, [])
    return () => chaptersStore.__reset()
  },
} satisfies Meta<typeof ReaderChapterChips>

export default meta
type Story = StoryObj<typeof meta>

export const NoClosedChapter: Story = {
  play: async () => {
    expect(await screen.findByTestId('chapter-chip')).toHaveTextContent('Chapter 1')
    expect(screen.getByTestId('time-chip')).toHaveTextContent('January 1, 2024 AD 01:00')
  },
}

/**
 * The phone chip shows before the first close. Read inside the phone-only chip strip: the first
 * commit can still be the desktop tier.
 */
export const PhoneNoClosedChapter: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    const strip = await screen.findByTestId('reader-chip-strip')
    expect(await within(strip).findByTestId('chapter-chip')).toHaveTextContent('Chapter 1')
  },
}

export const PhoneAfterTwoCloses: Story = {
  globals: { viewport: { value: 'mobile1' } },
  beforeEach: () => {
    chaptersStore.hydrate(BRANCH, [closedChapter(1), closedChapter(2)])
  },
  play: async () => {
    const strip = await screen.findByTestId('reader-chip-strip')
    expect(await within(strip).findByTestId('chapter-chip')).toHaveTextContent('Chapter 3')
  },
}

/** The time chip goes with the frame, and the chapter chip stays. */
export const NoCalendarFrame: Story = {
  args: { frame: null },
  play: async () => {
    expect(await screen.findByTestId('chapter-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('time-chip')).not.toBeInTheDocument()
  },
}

/** Stands in for a screen pushed over the reader: the same `isFocused` flip the route makes. */
function FocusLossHarness(args: ReaderChapterChipsProps) {
  const [focused, setFocused] = useState(true)
  return (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      centerExtras={<ReaderChapterChips {...args} isFocused={focused} />}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <Pressable role="button" aria-label="Push screen" onPress={() => setFocused(false)}>
        <Text>Push screen</Text>
      </Pressable>
    </ScreenShell>
  )
}

async function expectPopoverClosesOnFocusLoss() {
  const chip = await screen.findByRole('button', { name: 'Chapter 1' })
  await userEvent.click(chip)
  await waitFor(() => expect(screen.getByText('1 · in progress')).toBeVisible(), {
    timeout: 5_000,
  })
  // Through the DOM: a Sheet's backdrop covers the body, and a real press would dismiss a Popover.
  screen.getByLabelText('Push screen').click()
  await waitFor(() => expect(screen.queryByText('1 · in progress')).toBeNull(), {
    timeout: 5_000,
  })
}

/** A portaled overlay would keep painting over the screen pushed on top of the reader. */
export const ClosesWhenFocusLeaves: Story = {
  render: (args) => <FocusLossHarness {...args} />,
  play: expectPopoverClosesOnFocusLoss,
}

// The strip calls the chips' handle, as the reader route wires it.
function StripHarness(args: ReaderChapterChipsProps) {
  const chips = useRef<ReaderChapterChipsHandle>(null)
  return (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      centerExtras={<ReaderChapterChips {...args} ref={chips} />}
      chapterProgress={args.progress}
      onChapterProgressPress={() => chips.current?.openPopover()}
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <Text>Body</Text>
    </ScreenShell>
  )
}

/** A strip press while the popover is open closes it, as the chip's does. */
export const StripPressToggles: Story = {
  render: (args) => <StripHarness {...args} />,
  play: async () => {
    const strip = await screen.findByTestId('chapter-progress-hit')
    const chip = screen.getByRole('button', { name: 'Chapter 1' })
    await userEvent.click(strip)
    await waitFor(() => expect(screen.getByText('1 · in progress')).toBeVisible(), {
      timeout: 5_000,
    })
    await expect(chip).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(strip)
    await waitFor(() => expect(screen.queryByText('1 · in progress')).toBeNull())
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    expect(screen.queryByText('1 · in progress')).toBeNull()
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
  },
}

/** The dialog pattern returns focus to what opened it, here the strip, not the chip. */
export const StripOpenedEscapeFocusesStrip: Story = {
  render: (args) => <StripHarness {...args} />,
  play: async () => {
    const strip = await screen.findByTestId('chapter-progress-hit')
    await userEvent.click(strip)
    await waitFor(() => expect(screen.getByText('1 · in progress')).toBeVisible(), {
      timeout: 5_000,
    })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('1 · in progress')).toBeNull())
    await waitFor(() => expect(strip).toHaveFocus())
  },
}

/** An outside press keeps the focus it moved: a strip-opened popover doesn't take it back. */
export const StripOpenedOutsidePressKeepsFocus: Story = {
  render: (args) => <StripHarness {...args} />,
  play: async () => {
    const strip = await screen.findByTestId('chapter-progress-hit')
    await userEvent.click(strip)
    await waitFor(() => expect(screen.getByText('1 · in progress')).toBeVisible(), {
      timeout: 5_000,
    })

    const settings = screen.getByRole('button', { name: t('chrome.storySettings') })
    await userEvent.click(settings)
    await waitFor(() => expect(screen.queryByText('1 · in progress')).toBeNull())
    // Radix runs the close focus a task after the content unmounts.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(settings).toHaveFocus()
  },
}

/** A chip-opened popover still returns focus to the chip, after a strip-opened one has closed. */
export const ChipOpenedEscapeFocusesChip: Story = {
  render: (args) => <StripHarness {...args} />,
  play: async () => {
    const strip = await screen.findByTestId('chapter-progress-hit')
    const chip = screen.getByRole('button', { name: 'Chapter 1' })
    await userEvent.click(strip)
    await waitFor(() => expect(screen.getByText('1 · in progress')).toBeVisible(), {
      timeout: 5_000,
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(strip).toHaveFocus())

    await userEvent.click(chip)
    await waitFor(() => expect(screen.getByText('1 · in progress')).toBeVisible(), {
      timeout: 5_000,
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('1 · in progress')).toBeNull())
    await waitFor(() => expect(chip).toHaveFocus())
  },
}

export const ClosesWhenFocusLeavesPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: (args) => <FocusLossHarness {...args} />,
  play: async () => {
    await screen.findByTestId('reader-chip-strip')
    await expectPopoverClosesOnFocusLoss()
  },
}
