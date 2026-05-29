import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { SaveBar } from './save-bar'

const meta: Meta<typeof SaveBar> = {
  title: 'Compounds/SaveBar',
  component: SaveBar,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md border border-border bg-bg-base" style={{ width: 720 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SaveBar>

/**
 * Single dirty field — pluralization renders singular ("1 unsaved
 * change").
 */
export const SingleDirtyField: Story = {
  args: {
    dirtyFields: ['description'],
    onSave: fn(),
    onDiscard: fn(),
  },
}

/**
 * Multiple dirty fields — pluralized count + comma-separated field
 * list. The user-recognizable labels (`description`, `visual.hair`,
 * `traits`) are what callers pass; SaveBar doesn't translate.
 */
export const MultipleDirtyFields: Story = {
  args: {
    dirtyFields: ['description', 'visual.hair', 'traits'],
    onSave: fn(),
    onDiscard: fn(),
  },
}

/**
 * Many dirty fields — long list truncates at the row's right edge
 * via `numberOfLines={1}`. The first few fields stay visible; the
 * rest are clipped. Acceptable per the spec — actions remain
 * reachable on the right.
 */
export const ManyDirtyFields: Story = {
  args: {
    dirtyFields: [
      'description',
      'visual.hair',
      'traits',
      'goals',
      'relationships.spouse',
      'inventory.weapons',
      'inventory.armor',
      'tags',
    ],
    onSave: fn(),
    onDiscard: fn(),
  },
}

/**
 * Optional informational notice — `⚠` icon with hover tooltip.
 * Used by surface-specific propagation warnings (calendar swap,
 * model deletion, etc.) without breaking the single-row contract.
 */
export const WithNotice: Story = {
  args: {
    dirtyFields: ['name', 'era_set'],
    notice: 'Saving propagates the new era set to 3 stories using this calendar.',
    onSave: fn(),
    onDiscard: fn(),
  },
}

/**
 * `dirtyCount` decoupled from `dirtyFields.length` — for the rare
 * case where a single field accumulates multiple distinct edits
 * that should count individually.
 */
export const DirtyCountOverride: Story = {
  args: {
    dirtyFields: ['era_set'],
    dirtyCount: 5,
    onSave: fn(),
    onDiscard: fn(),
  },
}

/**
 * Saving in flight — both buttons disabled, keyboard shortcut
 * suppressed. Caller flips this off after the persistence call
 * resolves; SaveBar usually unmounts at that point.
 */
export const Saving: Story = {
  args: {
    dirtyFields: ['description', 'traits'],
    saving: true,
    onSave: fn(),
    onDiscard: fn(),
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-3">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="overflow-hidden rounded-md border border-border bg-bg-base"
        >
          <View className="px-3 pb-2 pt-3">
            <Text variant="muted" size="xs">
              {t.name}
            </Text>
          </View>
          <SaveBar
            dirtyFields={['description', 'visual.hair', 'traits']}
            onSave={fn()}
            onDiscard={fn()}
          />
        </View>
      ))}
    </View>
  ),
}

export const SaveButtonFires: Story = {
  args: {
    dirtyFields: ['description'],
    onSave: fn(),
    onDiscard: fn(),
  },
  play: async ({ args }) => {
    const save = screen.getByRole('button', { name: /Save/ })
    await userEvent.click(save)
    await waitFor(() => expect(args.onSave).toHaveBeenCalled())
  },
}

export const DiscardButtonFires: Story = {
  args: {
    dirtyFields: ['description'],
    onSave: fn(),
    onDiscard: fn(),
  },
  play: async ({ args }) => {
    const discard = screen.getByRole('button', { name: 'Discard' })
    await userEvent.click(discard)
    await waitFor(() => expect(args.onDiscard).toHaveBeenCalled())
  },
}

export const SavingDisablesActions: Story = {
  args: {
    dirtyFields: ['description'],
    saving: true,
    onSave: fn(),
    onDiscard: fn(),
  },
  play: async ({ args }) => {
    const discard = screen.getByRole('button', { name: 'Discard' })
    const save = screen.getByRole('button', { name: /Save/ })
    expect(discard).toBeDisabled()
    expect(save).toBeDisabled()
    // Don't try to click a disabled button — userEvent refuses
    // (pointer-events: none on RN-Web's disabled Pressable). The
    // disabled assertion alone confirms the action can't fire.
    expect(args.onSave).not.toHaveBeenCalled()
    expect(args.onDiscard).not.toHaveBeenCalled()
  },
}

export const KeyboardShortcutFiresSave: Story = {
  args: {
    dirtyFields: ['description'],
    onSave: fn(),
    onDiscard: fn(),
  },
  play: async ({ args }) => {
    // Cmd+S / Ctrl+S — both fire the same listener; userEvent's
    // `keyboard` API simulates a keydown on the active element.
    await userEvent.keyboard('{Meta>}s{/Meta}')
    await waitFor(() => expect(args.onSave).toHaveBeenCalled())
  },
}

export const PluralizationOneField: Story = {
  args: {
    dirtyFields: ['description'],
    onSave: fn(),
    onDiscard: fn(),
  },
  play: async () => {
    expect(screen.getByText(/1 unsaved change\b/)).toBeInTheDocument()
  },
}

export const PluralizationManyFields: Story = {
  args: {
    dirtyFields: ['description', 'visual.hair'],
    onSave: fn(),
    onDiscard: fn(),
  },
  play: async () => {
    expect(screen.getByText(/2 unsaved changes\b/)).toBeInTheDocument()
  },
}
