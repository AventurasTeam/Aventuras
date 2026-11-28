import type { TriggerRef } from '@rn-primitives/popover'
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useRef } from 'react'
import { Pressable, View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { ScreenShell } from '@/components/shells/screen-shell'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { TierMark, waitForTier } from '@/hooks/tier-probe'

import { BranchChip, BranchNavigatorAnchor } from './branch-chip'
import { ChapterChip } from './chapter-chip'

const TABLET = { viewport: { value: 'tablet' } }
const PHONE = { viewport: { value: 'mobile1' } }
const noop = fn()

/** The reader's bar: the chip after the chapter chip and a time chip stand-in. */
function ReaderBar() {
  return (
    <ScreenShell
      variant="in-story"
      title={<Text size="base">Aria&apos;s Descent</Text>}
      centerExtras={
        <>
          <ChapterChip number={3} />
          <Tag tone="soft">Day 3 dusk</Tag>
          <BranchChip count={3} currentName="Main" />
        </>
      }
      onBack={noop}
      onOpenStorySettings={noop}
      onOpenActions={noop}
    >
      <TierMark />
    </ScreenShell>
  )
}

// A key, not a button: the anchor must not be the thing that opens it.
function AnchorHarness() {
  const trigger = useRef<TriggerRef>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') trigger.current?.open()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <View className="flex-row items-center gap-2 p-4">
      <Pressable accessibilityRole="button" aria-label="Before">
        <Text>Before</Text>
      </Pressable>
      <Popover ariaLabel="Branches">
        <PopoverTrigger ref={trigger} asChild>
          <BranchNavigatorAnchor />
        </PopoverTrigger>
        <PopoverContent align="start">
          <Text>Navigator body</Text>
        </PopoverContent>
      </Popover>
      <Pressable accessibilityRole="button" aria-label="After">
        <Text>After</Text>
      </Pressable>
    </View>
  )
}

const meta: Meta<typeof BranchChip> = {
  title: 'Compounds/Reader/BranchChip',
  component: BranchChip,
  parameters: { layout: 'centered' },
  args: { count: 3, currentName: 'Main' },
}

export default meta
type Story = StoryObj<typeof BranchChip>

export const ThreeBranches: Story = {
  args: { onPress: fn() },
  play: async ({ args }) => {
    const chip = await screen.findByRole('button', { name: 'On Main · 3 branches' })
    await expect(chip).toHaveAttribute('data-testid', 'branch-chip')
    await expect(chip).toHaveTextContent('3')
    await expect(chip.querySelector('svg')).not.toBeNull()
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    // The web tooltip names the branch.
    await expect(screen.getByTitle('On Main · 3 branches')).toContainElement(chip)
    await userEvent.click(chip)
    await expect(args.onPress).toHaveBeenCalledTimes(1)
  },
}

export const Expanded: Story = {
  args: { expanded: true },
  play: async () => {
    await expect(
      await screen.findByRole('button', { name: 'On Main · 3 branches' }),
    ).toHaveAttribute('aria-expanded', 'true')
  },
}

export const AbsentAtOneBranch: Story = {
  render: () => (
    <View className="gap-2 p-4">
      <Text>Stage</Text>
      <BranchChip count={1} currentName="Main" />
      <BranchChip count={0} currentName="Main" />
    </View>
  ),
  play: async () => {
    await screen.findByText('Stage')
    await expect(screen.queryByTestId('branch-chip')).toBeNull()
    await expect(screen.queryByRole('button')).toBeNull()
  },
}

// A trigger measures this ref to place its content; a chip that drops it unanchors the popover.
export const UnderAsChildTrigger: Story = {
  render: () => (
    <Popover ariaLabel="Branches">
      <PopoverTrigger asChild>
        <BranchChip count={3} currentName="Main" />
      </PopoverTrigger>
      <PopoverContent align="start">
        <Text>Popover body</Text>
      </PopoverContent>
    </Popover>
  ),
  play: async () => {
    const chip = await screen.findByRole('button', { name: 'On Main · 3 branches' })
    await userEvent.click(chip)
    const body = await screen.findByText('Popover body')
    await waitFor(() =>
      expect(body.getBoundingClientRect().top).toBeGreaterThan(chip.getBoundingClientRect().bottom),
    )
    await expect(chip).toHaveAttribute('aria-expanded', 'true')
  },
}

export const InlineBesideTitleTablet: Story = {
  globals: TABLET,
  parameters: { layout: 'fullscreen' },
  render: () => <ReaderBar />,
  play: async () => {
    await waitForTier('tablet')
    const title = await screen.findByText("Aria's Descent")
    const chip = screen.getByRole('button', { name: 'On Main · 3 branches' })
    await expect(screen.queryByTestId('reader-chip-strip')).toBeNull()
    const titleRect = title.getBoundingClientRect()
    const chipRect = chip.getBoundingClientRect()
    expect(chipRect.left).toBeGreaterThan(titleRect.right)
    // The same bar row as the title.
    expect(chipRect.top).toBeLessThan(titleRect.bottom)
    expect(chipRect.bottom).toBeGreaterThan(titleRect.top)
  },
}

export const InPhoneChipStrip: Story = {
  globals: PHONE,
  parameters: { layout: 'fullscreen' },
  render: () => <ReaderBar />,
  play: async () => {
    await waitForTier('phone')
    const strip = await screen.findByTestId('reader-chip-strip')
    const chapter = within(strip).getByRole('button', { name: 'Chapter 3' })
    const time = within(strip).getByText('Day 3 dusk')
    const branch = within(strip).getByRole('button', { name: 'On Main · 3 branches' })
    expect(time.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      chapter.getBoundingClientRect().right,
    )
    expect(branch.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      time.getBoundingClientRect().right,
    )
    await expect(screen.getAllByRole('button', { name: 'On Main · 3 branches' })).toHaveLength(1)
  },
}

export const AnchorUnderTrigger: Story = {
  render: () => <AnchorHarness />,
  play: async () => {
    const anchor = await screen.findByTestId('branch-navigator-anchor')
    await expect(anchor).toHaveAttribute('aria-hidden', 'true')
    await expect(anchor).not.toHaveAttribute('role', 'button')
    await expect(anchor).toHaveAttribute('tabindex', '-1')
    expect(getComputedStyle(anchor).pointerEvents).toBe('none')
    expect(anchor.getBoundingClientRect().width).toBe(0)
    // hidden: aria-hidden alone drops the button role from the default query. Scoped to the row
    // (the preview body has hidden buttons); the Popover wraps the anchor, so it is two levels up.
    const buttons = within(anchor.parentElement?.parentElement as HTMLElement)
      .getAllByRole('button', { hidden: true })
      .map((button) => button.getAttribute('aria-label'))
    expect(buttons).toEqual(['Before', 'After'])

    screen.getByRole('button', { name: 'Before' }).focus()
    await userEvent.tab()
    await expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()

    // pointer-events stop a pointer, not a script's click: the anchor carries no click handler.
    anchor.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    await expect(screen.queryByRole('dialog', { name: 'Branches' })).toBeNull()

    // Still an anchor: a handle's open places the content at it.
    await userEvent.keyboard('{F2}')
    const dialog = await screen.findByRole('dialog', { name: 'Branches' })
    await waitFor(() => {
      const anchorRect = anchor.getBoundingClientRect()
      const dialogRect = dialog.getBoundingClientRect()
      expect(dialogRect.top).toBeGreaterThanOrEqual(anchorRect.bottom)
      expect(Math.abs(dialogRect.left - anchorRect.left)).toBeLessThan(2)
    })
  },
}
