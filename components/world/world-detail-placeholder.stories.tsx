import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { WorldDetailPlaceholder } from './world-detail-placeholder'

const meta: Meta<typeof WorldDetailPlaceholder> = {
  title: 'Compounds/World/WorldDetailPlaceholder',
  component: WorldDetailPlaceholder,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <View className="rounded-md border border-border" style={{ width: 520, height: 420 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof WorldDetailPlaceholder>

export const NoSelection: Story = {
  play: async () => {
    expect(screen.getByText('Select a row')).toBeInTheDocument()
    expect(
      screen.getByText('Pick an entity or lore entry from the list to see it here.'),
    ).toBeInTheDocument()
  },
}
