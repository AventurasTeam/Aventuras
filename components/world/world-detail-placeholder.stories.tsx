import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import type { Entity, Lore } from '@/lib/db'

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

const KAEL: Entity = {
  id: 'char_kael',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  description: null,
  status: 'active',
  retiredReason: null,
  injectionMode: 'always',
  nameCollisionFlag: 0,
  state: null,
  tags: [],
  keywords: [],
  priority: 30,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

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

export const EntitySelected: Story = {
  args: { selection: { type: 'entity', row: KAEL }, recentlyClassified: 'fresh' },
  play: async ({ canvasElement }) => {
    expect(screen.getByText('Kael')).toBeInTheDocument()
    expect(screen.getByText('character')).toBeInTheDocument()
    expect(screen.getByText('Recently classified')).toBeInTheDocument()
    expect(canvasElement.querySelector('.bg-recently-classified-bg.opacity-50')).toBeNull()
    expect(screen.getByText('Details land in Slice 4.2a')).toBeInTheDocument()
  },
}

export const LoreSelected: Story = {
  args: { selection: { type: 'lore', row: VEIL } },
  play: async () => {
    expect(screen.getByText('The Veil')).toBeInTheDocument()
    expect(screen.getByText('lore')).toBeInTheDocument()
    expect(screen.queryByText('Recently classified')).toBeNull()
    expect(
      screen.getByText("Tabs and editors for this row aren't available yet."),
    ).toBeInTheDocument()
    expect(screen.getByText('Details land in Slice 4.2b')).toBeInTheDocument()
  },
}

export const EntityFading: Story = {
  args: { selection: { type: 'entity', row: KAEL }, recentlyClassified: 'fading' },
  play: async ({ canvasElement }) => {
    expect(screen.getByText('Kael')).toBeInTheDocument()
    expect(screen.getByText('Recently classified')).toBeInTheDocument()
    expect(canvasElement.querySelector('.bg-recently-classified-bg.opacity-50')).toBeNull()
    expect(canvasElement.querySelector('.bg-recently-classified-bg')).not.toBeNull()
  },
}
