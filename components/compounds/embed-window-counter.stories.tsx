import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { Text } from '@/components/ui/text'

import { EmbedWindowCounter } from './embed-window-counter'

const meta: Meta<typeof EmbedWindowCounter> = {
  title: 'Compounds/EmbedWindowCounter',
  component: EmbedWindowCounter,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EmbedWindowCounter>

/**
 * Storybook configures no embedder, so there is no window to measure against and
 * nothing honest to say — the state every field opens in, and the one the reserved
 * row exists for. The row must still stand a line tall, or the field it sits under
 * shifts the moment a count arrives.
 */
export const ReservedBeforeTheFirstCount: Story = {
  render: () => (
    <View style={{ width: 420 }}>
      <View testID="counter-row">
        <EmbedWindowCounter text="A body short enough to say nothing about." />
      </View>
      <View testID="reference-row">
        <Text className="text-xs text-fg-muted">A rendered counter of the same type.</Text>
      </View>
    </View>
  ),
  play: async () => {
    const counter = screen.getByTestId('counter-row')
    // Pins the silent state: a Storybook that ever resolved an embedder would
    // render a real count here and measure nothing about the empty branch.
    expect(counter.textContent?.trim()).toBe('')

    const reserved = counter.getBoundingClientRect().height
    const rendered = screen.getByTestId('reference-row').getBoundingClientRect().height
    expect(reserved).toBeGreaterThan(0)
    expect(reserved).toBeCloseTo(rendered, 1)
  },
}
