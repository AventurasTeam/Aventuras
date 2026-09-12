import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { Entity } from '@/lib/db'

import { EntityRow } from './entity-row'

const meta: Meta<typeof EntityRow> = {
  title: 'Compounds/Entity/EntityRow',
  component: EntityRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md bg-bg-base" style={{ width: 340 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EntityRow>

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'name'>): Entity {
  return {
    branchId: 'br_1',
    kind: 'character',
    description: 'A courier turned fugitive, carrying an amulet that should not exist.',
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const NONE = { lead: null, inScene: false }

export const Active: Story = {
  args: {
    row: entity({ id: 'char_kael', name: 'Kael' }),
    selected: false,
    onPress: fn(),
    signals: NONE,
  },
  play: async ({ canvasElement }) => {
    const statusText = screen.getByText('active')
    expect(statusText).toHaveClass('text-fg-muted')
    expect(statusText.parentElement).toHaveClass('bg-bg-base')
    expect(canvasElement.querySelector('.left-0.bg-success')).toBeNull()
    expect(canvasElement.querySelector('.bg-recently-classified-bg')).toBeNull()
  },
}

/** Lead badge + in-scene stripe + fresh tint — every channel at once. */
export const LeadInSceneFresh: Story = {
  args: {
    row: entity({ id: 'char_kael', name: 'Kael' }),
    selected: false,
    onPress: fn(),
    signals: { lead: 'you', inScene: true, recentlyClassified: 'fresh' },
  },
  play: async ({ args, canvasElement }) => {
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(canvasElement.querySelector('.left-0.bg-success')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Kael' })).toHaveClass('bg-recently-classified-bg')
    await userEvent.click(screen.getByRole('button', { name: 'Kael' }))
    await waitFor(() => expect(args.onPress).toHaveBeenCalled())
  },
}

/** Protagonist mode swaps the lead label but keeps the same channel. */
export const LeadProtagonist: Story = {
  args: {
    row: entity({ id: 'char_kael', name: 'Kael' }),
    selected: false,
    onPress: fn(),
    signals: { lead: 'protagonist', inScene: false },
  },
  play: async () => {
    expect(screen.getByText('Protagonist')).toBeInTheDocument()
  },
}

export const Staged: Story = {
  args: {
    row: entity({ id: 'char_sage', name: 'The Ashen Sage', status: 'staged' }),
    selected: false,
    onPress: fn(),
    signals: NONE,
  },
  play: async ({ canvasElement }) => {
    expect(screen.getByText('staged')).toHaveClass('text-success-fg')
    // The staged pill is itself success-toned; the stripe selector must not false-match it here.
    expect(canvasElement.querySelector('.left-0.bg-success')).toBeNull()
  },
}

export const RetiredFading: Story = {
  args: {
    row: entity({
      id: 'char_bran',
      name: 'Bran',
      status: 'retired',
      retiredReason: 'left the city',
    }),
    selected: true,
    onPress: fn(),
    signals: { lead: null, inScene: false, recentlyClassified: 'fading' },
  },
  play: async ({ canvasElement }) => {
    expect(screen.getByText('retired')).toHaveClass('text-warning-fg')
    expect(canvasElement.querySelector('.bg-recently-classified-bg.opacity-50')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Bran' })).toHaveAttribute('aria-selected', 'true')
  },
}

const onJumpToOther = fn()

/** Flagged row: the strip renders below the row with a disabled Resolve. */
export const Collision: Story = {
  args: {
    row: entity({ id: 'char_brannoc_2', name: 'Brannoc', nameCollisionFlag: 1 }),
    selected: false,
    onPress: fn(),
    signals: {
      lead: null,
      inScene: false,
      collision: {
        otherName: 'Brannoc',
        onJumpToOther,
        resolveDisabledReason: 'Lands in Slice 4.2c',
      },
    },
  },
  play: async () => {
    const link = screen.getByRole('link', { name: '⚠ Collides with Brannoc' })
    expect(link).toBeInTheDocument()
    expect(screen.getByTitle('Lands in Slice 4.2c')).toBeInTheDocument()
    await userEvent.click(link)
    await waitFor(() => expect(onJumpToOther).toHaveBeenCalled())
  },
}

/** No description line at any density — entity rows never carry one. */
export const Compact: Story = {
  render: () => (
    <View>
      <EntityRow
        row={entity({ id: 'char_kael', name: 'Kael' })}
        selected={false}
        onPress={fn()}
        signals={NONE}
      />
      <EntityRow
        row={entity({ id: 'char_kael', name: 'Kael' })}
        selected={false}
        onPress={fn()}
        signals={NONE}
        density="compact"
      />
    </View>
  ),
  play: async () => {
    expect(screen.getAllByRole('button', { name: 'Kael' })).toHaveLength(2)
    expect(screen.getAllByText('active')).toHaveLength(2)
    expect(screen.queryAllByText(/courier turned fugitive/)).toHaveLength(0)
  },
}
