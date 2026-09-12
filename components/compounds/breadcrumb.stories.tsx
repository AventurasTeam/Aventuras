import type { Decorator, Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { ScreenShell } from '@/components/shells/screen-shell'
import { TextClassContext } from '@/components/ui/text'

import { Breadcrumb } from './breadcrumb'

const meta: Meta<typeof Breadcrumb> = {
  title: 'Compounds/Breadcrumb',
  component: Breadcrumb,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md bg-bg-base p-3" style={{ width: 360 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Breadcrumb>

/** Master-detail sub-header: parent is a link, current segment is inert and emphasized. */
export const SubHeader: Story = {
  args: {
    segments: [
      { key: 'category', label: 'Characters', onPress: fn() },
      { key: 'row', label: 'Kael' },
    ],
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('link', { name: 'Characters' }))
    await waitFor(() => expect(args.segments[0].onPress).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Kael' })).toBeNull()
    expect(screen.getByText('Kael')).toBeInTheDocument()
    const separator = screen.getByText('/')
    expect(separator.parentElement).toHaveAttribute('aria-hidden')
  },
}

/** Top-bar shape: story title is a link, current surface segment is inert. */
export const TopBar: Story = {
  args: {
    segments: [
      { key: 'story', label: 'The Veilstone Courier', onPress: fn() },
      { key: 'surface', label: 'World' },
    ],
  },
  play: async () => {
    expect(screen.getByRole('link', { name: 'The Veilstone Courier' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'World' })).toBeNull()
  },
}

/** A single segment renders no separator and no link. */
export const Single: Story = {
  args: { segments: [{ key: 'category', label: 'Lore' }] },
  play: async () => {
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText('/')).toBeNull()
  },
}

/** Parent segment without onPress is inert, not a link. */
export const ParentWithoutOnPressIsInert: Story = {
  args: {
    segments: [
      { key: 'category', label: 'Characters' },
      { key: 'row', label: 'Kael' },
    ],
  },
  play: async () => {
    expect(screen.queryByRole('link', { name: 'Characters' })).toBeNull()
    expect(screen.getByText('Characters')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kael' })).toBeNull()
    expect(screen.getByText('Kael')).toBeInTheDocument()
  },
}

/** Current segment is never a link, even if onPress is defined. */
export const CurrentSegmentNeverLink: Story = {
  args: {
    segments: [
      { key: 'category', label: 'Characters', onPress: fn() },
      { key: 'row', label: 'Kael', onPress: fn() },
    ],
  },
  play: async ({ args }) => {
    expect(screen.getByRole('link', { name: 'Characters' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kael' })).toBeNull()
    await userEvent.click(screen.getByText('Kael'))
    expect(args.segments[1].onPress).not.toHaveBeenCalled()
  },
}

/** Only the story title shrinks; middle segment stays at natural width. */
export const LongTitle: Story = {
  args: {
    segments: [
      {
        key: 'story',
        label: 'The Extraordinarily Long Chronicle of the Veilstone Courier and the Crown of Ash',
        onPress: fn(),
      },
      { key: 'surface', label: 'World' },
    ],
  },
  render: (args) => (
    <View style={{ width: 240 }} className="flex-row gap-2" testID="long-title-container">
      <Breadcrumb {...args} />
    </View>
  ),
  play: async () => {
    const container = screen.getByTestId('long-title-container')
    const containerRect = container.getBoundingClientRect()
    const worldEl = screen.getByText('World')
    expect(worldEl.scrollWidth).toBeLessThanOrEqual(worldEl.clientWidth)
    const containerRight = Math.round(containerRect.right)
    const bcRight = Math.round(
      container.querySelector('[role="link"]')!.getBoundingClientRect().right,
    )
    expect(bcRight).toBeLessThanOrEqual(containerRight)
  },
}

/** Current segment truncates when its label exceeds the 70% width cap. */
export const LongTitleLongCurrent: Story = {
  args: {
    segments: [
      {
        key: 'story',
        label: 'The Extraordinarily Long Chronicle of the Veilstone Courier and the Crown of Ash',
        onPress: fn(),
      },
      {
        key: 'surface',
        label: 'Kael Vex, Warden of the Shattered Eastern Marches and Keeper of the Ninth Gate',
      },
    ],
  },
  render: (args) => (
    <View style={{ width: 240 }} className="flex-row gap-2" testID="long-current-container">
      <Breadcrumb {...args} />
    </View>
  ),
  play: async () => {
    const container = screen.getByTestId('long-current-container')
    const containerRect = container.getBoundingClientRect()
    const currentEl = screen.getByText(/Kael/)
    const rect = currentEl.getBoundingClientRect()
    expect(Math.round(rect.right)).toBeLessThanOrEqual(Math.round(containerRect.right))
    expect(currentEl.scrollWidth).toBeGreaterThan(currentEl.clientWidth)
  },
}

/** Three segments: only the first (story title) shrinks; World stays at natural width. Includes a non-link middle parent. */
export const ThreeSegmentsLongFirst: Story = {
  args: {
    segments: [
      {
        key: 'story',
        label: 'The Extraordinarily Long Chronicle of the Veilstone Courier and the Crown of Ash',
        onPress: fn(),
      },
      { key: 'surface', label: 'World' },
      { key: 'category', label: 'Characters' },
    ],
  },
  render: (args) => (
    <View style={{ width: 300 }} testID="three-segment-container">
      <Breadcrumb {...args} />
    </View>
  ),
  play: async () => {
    const container = screen.getByTestId('three-segment-container')
    const containerRect = container.getBoundingClientRect()
    const worldEl = screen.getByText('World')
    expect(worldEl.scrollWidth).toBeLessThanOrEqual(worldEl.clientWidth)
    const containerRight = Math.round(containerRect.right)
    const bcRight = Math.round((container.firstChild as HTMLElement).getBoundingClientRect().right)
    expect(bcRight).toBeLessThanOrEqual(containerRight)
  },
}

const inShellTitle: Decorator = (Story) => (
  <TextClassContext.Provider value="text-fg-primary !leading-none translate-y-[0.08em]">
    <Story />
  </TextClassContext.Provider>
)

/** Under ScreenShell's title context, size="base" overrides inherited size to 16px. */
export const SizeInShellTitle: Story = {
  decorators: [inShellTitle],
  args: {
    segments: [
      { key: 'a', label: 'Characters', onPress: fn() },
      { key: 'b', label: 'Kael' },
    ],
  },
  play: async () => {
    expect(getComputedStyle(screen.getByText('Kael')).fontSize).toBe('16px')
    expect(getComputedStyle(screen.getByText('Characters')).fontSize).toBe('16px')
    expect(getComputedStyle(screen.getByText('/')).fontSize).toBe('16px')
  },
}

/** Under ScreenShell's title context, size="sm" renders at 14px. */
export const SizeSmInShellTitle: Story = {
  decorators: [inShellTitle],
  args: {
    segments: [
      { key: 'a', label: 'Characters', onPress: fn() },
      { key: 'b', label: 'Kael' },
    ],
    size: 'sm',
  },
  play: async () => {
    expect(getComputedStyle(screen.getByText('Kael')).fontSize).toBe('14px')
    expect(getComputedStyle(screen.getByText('/')).fontSize).toBe('14px')
  },
}

/**
 * World's sub-header: a `flex-row` bar sizes the breadcrumb. The current segment's 70%
 * cap must follow the bar, not the breadcrumb's own content, so a label with room fits.
 */
export const CurrentSegmentCappedByBarNotContent: Story = {
  args: { segments: [] },
  render: () => (
    <View className="gap-2">
      <View style={{ width: 320 }} className="flex-row items-center">
        <Breadcrumb segments={[{ key: 'category', label: 'Characters' }]} />
      </View>
      <View style={{ width: 320 }} className="flex-row items-center">
        <Breadcrumb
          segments={[
            { key: 'category', label: 'Lore', onPress: fn() },
            { key: 'row', label: 'Origins of the Veil' },
          ]}
        />
      </View>
    </View>
  ),
  play: async () => {
    for (const label of ['Characters', 'Origins of the Veil']) {
      const text = await screen.findByText(label)
      expect(text.scrollWidth, `${label} truncated`).toBeLessThanOrEqual(text.clientWidth)
    }
  },
}

const LONG_STORY_TITLE =
  'The Extraordinarily Long Chronicle of the Veilstone Courier and the Crown of Ash'

/**
 * ScreenShell's title slot: the growing root keeps the status slot and icons in place,
 * and only the story title truncates.
 */
export const InShellTopBar: Story = {
  args: { segments: [] },
  render: () => (
    <View testID="shell-frame" style={{ width: 320 }}>
      <ScreenShell
        variant="in-story"
        title={
          <Breadcrumb
            testID="shell-title"
            segments={[
              { key: 'story', label: LONG_STORY_TITLE, onPress: fn() },
              { key: 'surface', label: 'World' },
            ]}
          />
        }
        statusSlot={<View testID="status-probe" style={{ width: 72, height: 20 }} />}
        onBack={fn()}
        onOpenStorySettings={fn()}
        onOpenActions={fn()}
      >
        <View />
      </ScreenShell>
    </View>
  ),
  play: async () => {
    const frame = (await screen.findByTestId('shell-frame')).getBoundingClientRect()
    const title = screen.getByTestId('shell-title').getBoundingClientRect()
    const status = screen.getByTestId('status-probe').getBoundingClientRect()
    const actions = screen.getByRole('button', { name: 'Actions' }).getBoundingClientRect()
    expect(title.right, 'title clear of the status slot').toBeLessThanOrEqual(status.left)
    expect(actions.right, 'actions inside the bar').toBeLessThanOrEqual(frame.right)
    const storyTitle = screen.getByText(LONG_STORY_TITLE)
    expect(storyTitle.scrollWidth, 'story title truncates').toBeGreaterThan(storyTitle.clientWidth)
    const world = screen.getByText('World')
    expect(world.scrollWidth, 'World stays whole').toBeLessThanOrEqual(world.clientWidth)
  },
}

const SIZES = ['sm', 'base'] as const

/**
 * The sub-header's two states at each size: the bar keeps its height when the current
 * segment becomes a parent link, and the link keeps its 8px-per-side tap padding.
 */
export const HeightStableWhenCurrentBecomesParent: Story = {
  args: { segments: [] },
  render: () => (
    <View className="gap-2">
      {SIZES.map((size) => (
        <View key={size} className="gap-2">
          <Breadcrumb
            testID={`single-${size}`}
            size={size}
            segments={[{ key: 'category', label: 'Characters' }]}
          />
          <Breadcrumb
            testID={`pair-${size}`}
            size={size}
            segments={[
              { key: 'category', label: 'Characters', onPress: fn() },
              { key: 'row', label: 'Kael' },
            ]}
          />
        </View>
      ))}
    </View>
  ),
  play: async () => {
    for (const size of SIZES) {
      const single = await screen.findByTestId(`single-${size}`)
      const pair = screen.getByTestId(`pair-${size}`)
      const link = pair.querySelector<HTMLElement>('[role="link"]')
      expect(link, `${size}: parent link`).not.toBeNull()
      const singleHeight = single.getBoundingClientRect().height
      expect(singleHeight, `${size}: rendered`).toBeGreaterThan(0)
      expect(pair.getBoundingClientRect().height, `${size}: bar height`).toBe(singleHeight)
      const labelHeight = (link?.firstElementChild as HTMLElement).getBoundingClientRect().height
      expect(link?.getBoundingClientRect().height, `${size}: tap padding`).toBeGreaterThanOrEqual(
        labelHeight + 16,
      )
      expect(link?.getBoundingClientRect().height, `${size}: no phone floor`).toBeLessThan(44)
    }
  },
}

/** Phone tier: every segment box meets the 44px touch floor, links and inert segments alike. */
export const PhoneTapFloor: Story = {
  args: { segments: [] },
  globals: { viewport: { value: 'mobile1' } },
  render: HeightStableWhenCurrentBecomesParent.render,
  play: async () => {
    for (const size of SIZES) {
      const single = await screen.findByTestId(`single-${size}`)
      const pair = screen.getByTestId(`pair-${size}`)
      // RN-Web's Dimensions reaches the phone tier on an async resize after mount.
      await waitFor(() => {
        const link = pair.querySelector<HTMLElement>('[role="link"]')
        expect(link?.getBoundingClientRect().height, `${size}: tap floor`).toBeGreaterThanOrEqual(
          44,
        )
        expect(pair.getBoundingClientRect().height, `${size}: bar height`).toBe(
          single.getBoundingClientRect().height,
        )
      })
    }
  },
}

/** Phone top bar: the 44px segments fit inside the bar and leave the right cluster alone. */
export const InShellTopBarPhone: Story = {
  args: { segments: [] },
  globals: { viewport: { value: 'mobile1' } },
  render: InShellTopBar.render,
  play: async () => {
    const frame = (await screen.findByTestId('shell-frame')).getBoundingClientRect()
    const link = screen.getByRole('link', { name: LONG_STORY_TITLE })
    await waitFor(() =>
      expect(link.getBoundingClientRect().height, 'tap floor').toBeGreaterThanOrEqual(44),
    )
    const actions = screen.getByRole('button', { name: 'Actions' })
    let bar = screen.getByRole('button', { name: 'Back' }).parentElement
    while (bar != null && !bar.contains(actions)) bar = bar.parentElement
    const barRect = (bar as HTMLElement).getBoundingClientRect()
    const title = screen.getByTestId('shell-title').getBoundingClientRect()
    expect(title.top, 'title inside the bar').toBeGreaterThanOrEqual(barRect.top)
    expect(title.bottom, 'title inside the bar').toBeLessThanOrEqual(barRect.bottom)
    const status = screen.getByTestId('status-probe').getBoundingClientRect()
    expect(title.right, 'title clear of the status slot').toBeLessThanOrEqual(status.left)
    expect(actions.getBoundingClientRect().right, 'actions inside the bar').toBeLessThanOrEqual(
      frame.right,
    )
  },
}
