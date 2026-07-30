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

/** Re-roll over an existing stack: spinner rides on top, outgoing chips stay put. */
export const Loading: Story = { args: { phase: 'loading' } }

/** Generate pressed from empty-state: busy before any chip exists. */
export const LoadingEmpty: Story = { args: { phase: 'loading', chips: [] } }

/** A failed re-roll keeps the chips it failed to replace — they are still tappable. */
export const Error: Story = {
  args: { phase: 'error', errorMessage: 'The model returned no usable suggestions.' },
}

/** First-ever generate failed: nothing to preserve, so the notice stands alone. */
export const ErrorEmpty: Story = {
  args: { phase: 'error', chips: [], errorMessage: "Couldn't generate suggestions." },
}

/** A deterministic config failure: Retry would never succeed, so the fix replaces it. */
export const ErrorNeedsProfile: Story = {
  args: {
    phase: 'error',
    errorMessage: 'The suggestion agent has no profile assigned.',
    errorFix: { label: 'Assign profile', onPress: fn() },
  },
}

/** Every category disabled: historical chips still render, but ⟳ would no-op, so it is dead. */
export const NoEnabledCategories: Story = {
  args: {
    canRefresh: false,
    categories: categories.map((c) => ({ ...c, enabled: false })),
  },
}

/** A turn in flight: same spinner, but ⟳ stays (disabled) — there is no strip-owned run to cancel. */
export const LockedByTurn: Story = { args: { disabled: true } }

/** Locked by a turn with nothing to show: spinner replaces the ⟳ Generate button. */
export const LockedByTurnEmpty: Story = {
  args: { disabled: true, phase: 'empty-state', chips: [] },
}

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

/** Long-but-legal chips at a high count: the stack scrolls instead of pushing the composer away. */
export const OverflowingStack: Story = {
  args: {
    chips: Array.from({ length: 6 }, (_, i) => ({
      categoryId: categories[i % 3]!.id,
      text: `${'You weigh the options carefully, turning each one over before you commit to anything at all. '.repeat(3)}(${i + 1})`,
    })),
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
