import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { fn } from 'storybook/test'

import type { SuggestionCategory } from '@/lib/db'

import { SuggestionStrip } from './suggestion-strip'

const categories: SuggestionCategory[] = [
  {
    id: 'action',
    label: 'Action',
    promptHint: 'a physical beat',
    color: 'blue',
    enabled: true,
    order: 0,
  },
  {
    id: 'dialogue',
    label: 'Dialogue',
    promptHint: 'spoken words',
    color: 'green',
    enabled: true,
    order: 1,
  },
  {
    id: 'examine',
    label: 'Examine',
    promptHint: 'inspect something',
    color: 'indigo',
    enabled: true,
    order: 2,
  },
]

const chips = [
  {
    categoryId: 'action',
    text: 'You brace a shoulder against the vault door and shove until the hinges groan.',
  },
  {
    categoryId: 'dialogue',
    text: '"Whatever is behind this door," you say, "it has been waiting a long time."',
  },
  {
    categoryId: 'examine',
    text: 'You crouch to read the tally marks scratched into the stone beside the frame.',
  },
]

const meta = {
  title: 'Compounds/Reader/SuggestionStrip',
  component: SuggestionStrip,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  args: {
    phase: 'visible',
    collapsed: false,
    chips,
    categories,
    onTapChip: fn(),
    onRefresh: fn(),
    onCancel: fn(),
    onToggleCollapsed: fn(),
  },
} satisfies Meta<typeof SuggestionStrip>

export default meta
type Story = StoryObj<typeof meta>

export const Visible: Story = {}

export const Loading: Story = { args: { phase: 'loading' } }

/** Generate pressed from empty-state: busy before any chip exists. */
export const LoadingEmpty: Story = { args: { phase: 'loading', chips: [] } }

export const Error: Story = { args: { phase: 'error' } }

export const Collapsed: Story = { args: { collapsed: true } }

/** Refresh is reachable from collapsed, so the busy signal has to survive it. */
export const CollapsedLoading: Story = { args: { collapsed: true, phase: 'loading' } }

/** Body owns the only ⟳ here — the chrome one would duplicate it. */
export const EmptyState: Story = { args: { phase: 'empty-state', chips: [] } }

/** Collapsed hides the body's Generate, so the chrome ⟳ comes back. */
export const EmptyStateCollapsed: Story = {
  args: { phase: 'empty-state', collapsed: true, chips: [] },
}

/** Deleted category: label falls back to `(removed)`, color to neutral, tap still fires. */
export const OrphanCategory: Story = {
  args: {
    chips: [
      chips[0]!,
      { categoryId: 'twist', text: 'The tally marks rearrange themselves while you watch.' },
    ],
  },
}

/** `enabled: false` gates emission, not render — this chip resolves like any other. */
export const DisabledCategory: Story = {
  args: {
    categories: categories.map((c) => (c.id === 'examine' ? { ...c, enabled: false } : c)),
    chips: [chips[2]!],
  },
}

/** Custom hex straight from the ColorPicker, plus the 3-digit shorthand it also accepts. */
export const CustomHexColor: Story = {
  args: {
    categories: [
      { id: 'twist', label: 'Twist', promptHint: '', color: '#7c3aed', enabled: true, order: 0 },
      { id: 'move', label: 'Move', promptHint: '', color: '#0aa', enabled: true, order: 1 },
    ],
    chips: [
      {
        categoryId: 'twist',
        text: 'The door was never locked — someone has been holding it shut.',
      },
      { categoryId: 'move', text: 'You back down the corridor, keeping the doorway in sight.' },
    ],
  },
}

/** In-flight per-turn generation: chips dim and stop taking taps, collapse stays live. */
export const DisabledDuringGeneration: Story = { args: { disabled: true } }
