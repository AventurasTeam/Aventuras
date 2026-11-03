import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, waitFor } from 'storybook/test'

import { ChapterProgressBar } from './chapter-progress-bar'

const TRACK_PX = 200

const meta: Meta<typeof ChapterProgressBar> = {
  title: 'Compounds/ChapterProgressBar',
  component: ChapterProgressBar,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View style={{ width: TRACK_PX }} className="gap-3">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ChapterProgressBar>

export const Tones: Story = {
  render: () => (
    <>
      <ChapterProgressBar percent={35} tone="success" className="h-1.5" />
      <ChapterProgressBar percent={85} tone="warning" className="h-1.5" />
      <ChapterProgressBar percent={95} tone="danger" className="h-1.5" />
    </>
  ),
  play: async () => {
    const fills = await screen.findAllByTestId('chapter-progress-fill')
    expect(fills[0]).toHaveClass('bg-success')
    expect(fills[1]).toHaveClass('bg-warning')
    expect(fills[2]).toHaveClass('bg-danger')
    expect(new Set(fills.map((fill) => getComputedStyle(fill).backgroundColor)).size).toBe(3)
    await waitFor(() => expect(fills[0].getBoundingClientRect().width).toBe(70))
  },
}

export const ClampsPercent: Story = {
  render: () => (
    <>
      <ChapterProgressBar percent={140} tone="danger" className="h-1.5" />
      <ChapterProgressBar percent={-5} tone="success" className="h-1.5" />
      <ChapterProgressBar percent={Number.NaN} tone="success" className="h-1.5" />
    </>
  ),
  play: async () => {
    const fills = await screen.findAllByTestId('chapter-progress-fill')
    await waitFor(() => expect(fills[0].getBoundingClientRect().width).toBe(TRACK_PX))
    expect(fills[1].getBoundingClientRect().width).toBe(0)
    expect(fills[2].getBoundingClientRect().width).toBe(0)
  },
}

export const TakesItsHeightFromClassName: Story = {
  args: { percent: 50, tone: 'success', className: 'h-[3px]' },
  play: async () => {
    const fill = await screen.findByTestId('chapter-progress-fill')
    await waitFor(() => expect(fill.getBoundingClientRect().height).toBe(3))
  },
}
