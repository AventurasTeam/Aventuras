import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import type { Lore } from '@/lib/db'

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

const VEIL: Lore = {
  id: 'lore_veil',
  branchId: 'br_1',
  title: 'The Veil',
  body: null,
  category: 'cosmology',
  tags: [],
  keywords: [],
  injectionMode: 'always',
  priority: 10,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

export const NoSelection: Story = {
  args: { selection: null },
  play: async () => {
    expect(screen.getByText('Select a row')).toBeInTheDocument()
  },
}

export const LoreSelected: Story = {
  args: { selection: { type: 'lore', row: VEIL } },
  play: async () => {
    expect(screen.getByText('The Veil')).toBeInTheDocument()
    expect(screen.queryByText('Recently classified')).toBeNull()
    expect(
      screen.getByText("Tabs and editors for this row aren't available yet."),
    ).toBeInTheDocument()
    expect(screen.getByText('Details land in Slice 4.2b')).toBeInTheDocument()
  },
}

export const LoreFading: Story = {
  args: { selection: { type: 'lore', row: VEIL }, recentlyClassified: 'fading' },
  play: async ({ canvasElement }) => {
    expect(screen.getByText('The Veil')).toBeInTheDocument()
    expect(screen.getByText('Recently classified')).toBeInTheDocument()
    expect(canvasElement.querySelector('.bg-recently-classified-bg.opacity-50')).toBeNull()
    expect(canvasElement.querySelector('.bg-recently-classified-bg')).not.toBeNull()
  },
}
