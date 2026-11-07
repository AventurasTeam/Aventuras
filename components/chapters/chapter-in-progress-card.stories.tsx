import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterProgress, ChapterProgressTone } from '@/lib/chapters'
import { t } from '@/lib/i18n'

import { ChapterInProgressCard } from './chapter-in-progress-card'
import { ChapterTimelineHeader } from './chapter-timeline-header'

const SINCE = 'Day 9, dusk'
// chapterProgressCounts prints both numbers, so every tone keeps them; the bar's tone follows percent.
const COUNTS = '14,200 / 24,000 tok'
const PHONE_390 = { viewport: { value: 'phone390' } }

function progress(percent: number, tone: ChapterProgressTone): ChapterProgress {
  return {
    tokens: 14_200,
    threshold: 24_000,
    percent,
    tone,
    canClose: true,
    startEntryId: 'entry_59',
  }
}

function TierMark() {
  return <Text testID="tier">{useTier()}</Text>
}

const meta = {
  title: 'Compounds/Chapters/ChapterInProgressCard',
  component: ChapterInProgressCard,
  parameters: {
    layout: 'fullscreen',
    // No built-in viewport is 390 px wide, and an unknown key silently falls back to desktop.
    viewport: {
      options: {
        phone390: {
          name: 'Phone 390',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
      },
    },
  },
  args: { progress: progress(70, 'success'), sinceLabel: SINCE },
  decorators: [
    (Story) => (
      <View className="w-full max-w-[760px] gap-2.5 self-center p-4">
        <TierMark />
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ChapterInProgressCard>

export default meta
type Story = StoryObj<typeof meta>

async function waitForTier(tier: 'desktop' | 'phone') {
  await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent(tier))
}

const card = () => screen.getByTestId('chapter-in-progress-card')
const closeButton = () => screen.getByRole('button', { name: t('chapters:inProgress.close') })

async function expectProgress(tone: ChapterProgressTone, percent: number) {
  await expect(await screen.findByText(COUNTS)).toBeVisible()
  const fill = screen.getByTestId('chapter-progress-fill')
  await expect(fill).toHaveClass(`bg-${tone}`)
  // The bar has no default height; a dropped className collapses it to 0 px.
  expect(fill.getBoundingClientRect().height).toBeGreaterThan(0)
  // The track is bg-bg-sunken; a card of the same colour would hide it.
  const track = fill.parentElement as HTMLElement
  expect(getComputedStyle(card()).backgroundColor).not.toBe(getComputedStyle(track).backgroundColor)
  await waitFor(() => {
    const trackWidth = track.getBoundingClientRect().width
    expect(fill.getBoundingClientRect().width / trackWidth).toBeCloseTo(percent / 100, 1)
  })
}

// No row stands behind the card: nothing on it or inside it discloses, and Close waits for 5.10.
async function expectInert() {
  await expect(card()).not.toHaveAttribute('aria-expanded')
  expect(card().querySelector('[aria-expanded]')).toBeNull()
  const close = closeButton()
  await expect(close).toHaveAttribute('aria-disabled', 'true')
  await expect(screen.getByTitle(t('chapters:popover.closeLandsLater'))).toContainElement(close)
}

async function expectToneCard(tone: ChapterProgressTone, percent: number) {
  await waitForTier('desktop')
  await expect(
    await screen.findByText(t('chapters:inProgress.since', { time: SINCE })),
  ).toBeVisible()
  await expectProgress(tone, percent)
  await expect(screen.getByText(t('chapters:inProgress.placeholder'))).toBeVisible()
  await expectInert()
}

export const Success: Story = {
  play: async () => {
    await expectToneCard('success', 70)
    // Sized to its label at desktop; full width is phone's alone.
    await waitFor(() =>
      expect(closeButton().getBoundingClientRect().width).toBeLessThan(
        card().getBoundingClientRect().width * 0.5,
      ),
    )
  },
}

export const Warning: Story = {
  args: { progress: progress(85, 'warning') },
  play: () => expectToneCard('warning', 85),
}

export const Danger: Story = {
  args: { progress: progress(95, 'danger') },
  play: () => expectToneCard('danger', 95),
}

export const NoSince: Story = {
  args: { sinceLabel: null },
  play: async () => {
    await expect(await screen.findByText(t('chapters:inProgress.title'))).toBeVisible()
    expect(screen.queryByText(/since/)).toBeNull()
    await expectInert()
  },
}

export const EmptyTimeline: Story = {
  render: (args) => (
    <View className="gap-2.5">
      <ChapterTimelineHeader closedCount={0} />
      <ChapterInProgressCard {...args} />
    </View>
  ),
  play: async () => {
    const header = await screen.findByText('Chapters · 0 closed + 1 in progress')
    await expect(header).toBeVisible()
    expect(header.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      card().getBoundingClientRect().top,
    )
    await expectInert()
  },
}

export const Phone390: Story = {
  globals: PHONE_390,
  args: { progress: progress(95, 'danger') },
  play: async () => {
    await waitForTier('phone')
    await expectProgress('danger', 95)
    await expectInert()
    // chapter-timeline.md → Mobile expression: Close chapter… runs full width on phone.
    await waitFor(() =>
      expect(closeButton().getBoundingClientRect().width).toBeGreaterThan(
        card().getBoundingClientRect().width * 0.9,
      ),
    )
  },
}
