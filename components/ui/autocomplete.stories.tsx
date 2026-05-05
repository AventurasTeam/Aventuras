import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test'

import { themes } from '@/lib/themes/registry'
import { Autocomplete } from './autocomplete'
import { Text } from './text'

const ERA_NAMES = ['Reiwa', 'Heisei', 'Showa', 'Taisho', 'Meiji'] as const

const meta: Meta<typeof Autocomplete> = {
  title: 'Primitives/Autocomplete',
  component: Autocomplete,
  parameters: {
    layout: 'centered',
    // Autocomplete renders a popover-shaped surface anchored beneath
    // the input. Story canvas needs vertical room for the dropdown to
    // be visible without clipping.
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="w-80" style={{ minHeight: 400 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Autocomplete>

function ControlledAutocomplete(
  props: Omit<React.ComponentProps<typeof Autocomplete>, 'value' | 'onValueChange'> & {
    initialValue?: string
  },
) {
  const { initialValue = '', ...rest } = props
  const [value, setValue] = React.useState(initialValue)
  return <Autocomplete value={value} onValueChange={setValue} {...rest} />
}

export const Default: Story = {
  render: (args) => (
    <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" {...args} />
  ),
}

/**
 * No source list — degrades to free-form input. The `+ Add new` row
 * appears as soon as anything is typed.
 */
export const EmptySource: Story = {
  render: () => <ControlledAutocomplete placeholder="Type anything…" />,
}

/**
 * `casingNormalization: 'canonical'` (default) — typing "reiwa"
 * commits as "Reiwa" against the canonical source list.
 */
export const CanonicalCasing: Story = {
  render: () => (
    <View className="gap-3">
      <Text size="sm" variant="muted">
        Type &quot;reiwa&quot; (lowercase) and press Enter — commits as &quot;Reiwa&quot;.
      </Text>
      <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" />
    </View>
  ),
}

/**
 * `casingNormalization: 'as-typed'` — preserves the user's casing.
 * Use for hint-only source lists (e.g., tags).
 */
export const AsTypedCasing: Story = {
  render: () => (
    <View className="gap-3">
      <Text size="sm" variant="muted">
        Type &quot;reiwa&quot; (lowercase) and press Enter — commits as &quot;reiwa&quot;, source
        casing not enforced.
      </Text>
      <ControlledAutocomplete
        sourceList={ERA_NAMES}
        casingNormalization="as-typed"
        placeholder="Tag…"
      />
    </View>
  ),
}

/**
 * Tail-create row appears only when typed value doesn't exactly match
 * any source entry. Type something not in the list to see it.
 */
export const TailCreate: Story = {
  render: () => (
    <View className="gap-3">
      <Text size="sm" variant="muted">
        Type &quot;Genroku&quot; (not in source) — `+ Add new: &quot;Genroku&quot;` appears.
      </Text>
      <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" />
    </View>
  ),
}

export const Disabled: Story = {
  render: () => (
    <ControlledAutocomplete
      sourceList={ERA_NAMES}
      placeholder="Era name…"
      initialValue="Reiwa"
      disabled
    />
  ),
}

export const DisabledWithReason: Story = {
  render: () => (
    <ControlledAutocomplete
      sourceList={ERA_NAMES}
      placeholder="Era name…"
      initialValue="Reiwa"
      disabled
      disabledReason="Generation in progress — fields lock until complete"
    />
  ),
}

export const FocusOpensDropdown: Story = {
  render: () => <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" />,
  play: async ({ canvas }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0))
    // All five era names appear as suggestions when input is empty
    for (const era of ERA_NAMES) {
      expect(screen.getByRole('button', { name: era })).toBeInTheDocument()
    }
  },
}

export const TypingFiltersSuggestions: Story = {
  render: () => <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" />,
  play: async ({ canvas }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    await userEvent.type(input, 'sho')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Showa' })).toBeInTheDocument()
    })
    // 'Reiwa' is filtered out
    expect(screen.queryByRole('button', { name: 'Reiwa' })).not.toBeInTheDocument()
  },
}

export const TailCreateAppearsForUnknownTyped: Story = {
  render: () => <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" />,
  play: async ({ canvas }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    await userEvent.type(input, 'Genroku')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Add new: "Genroku"' })).toBeInTheDocument()
    })
  },
}

export const SuggestionPickCommitsCanonical: Story = {
  args: { onCommit: fn() },
  render: ({ onCommit }) => (
    <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" onCommit={onCommit} />
  ),
  play: async ({ canvas, args }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    await userEvent.type(input, 'reiw')
    const suggestion = await screen.findByRole('button', { name: 'Reiwa' })
    await userEvent.click(suggestion)
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith('Reiwa'))
  },
}

export const TailCreateCommitsTyped: Story = {
  args: { onCommit: fn() },
  render: ({ onCommit }) => (
    <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" onCommit={onCommit} />
  ),
  play: async ({ canvas, args }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    await userEvent.type(input, 'Genroku')
    const tail = await screen.findByRole('button', { name: '+ Add new: "Genroku"' })
    await userEvent.click(tail)
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith('Genroku'))
  },
}

/**
 * Keyboard navigation (desktop / tablet only): ArrowDown / ArrowUp
 * cycle through suggestions + tail-create row, Enter commits the
 * highlighted item, Escape closes the dropdown without committing.
 */
export const KeyboardNavigation: Story = {
  args: { onCommit: fn() },
  render: ({ onCommit }) => (
    <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" onCommit={onCommit} />
  ),
  play: async ({ canvas, args }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    await userEvent.type(input, 's')
    // 'sho' typed — Showa highlighted on first ArrowDown
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(args.onCommit).toHaveBeenCalled())
    // Committed value should be one of the matches for "s" — Showa,
    // Heisei, or Taisho. Assert it's a canonical era name.
    const calls = (args.onCommit as ReturnType<typeof fn>).mock.calls
    expect(calls[0]![0]).toMatch(/^(Showa|Heisei|Taisho)$/)
  },
}

/**
 * Enter on a keyboard-navigated highlight commits even when the
 * typed value is empty. Spec's "empty Enter is no-op" rule covers
 * the bare-press case, not arrowed-to selections.
 */
export const KeyboardCommitWithEmptyTyped: Story = {
  args: { onCommit: fn() },
  render: ({ onCommit }) => (
    <ControlledAutocomplete sourceList={ERA_NAMES} placeholder="Era name…" onCommit={onCommit} />
  ),
  play: async ({ canvas, args }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    await userEvent.click(input)
    // No typing — just navigate to the first suggestion and commit.
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith('Reiwa'))
  },
}

/**
 * ThemeMatrix renders the desktop/tablet inline path because the
 * suggestions render within the parent's `dataSet={{theme}}` scope
 * (no portal). On phone tier the Sheet portals out and the per-row
 * theme attribute doesn't reach the suggestion list — that path is
 * verified via the global Storybook theme switcher.
 */
export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
          style={{ minHeight: 320 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="w-72">
            <ControlledAutocomplete
              initialValue="rei"
              sourceList={ERA_NAMES}
              placeholder="Era name…"
            />
          </View>
        </View>
      ))}
    </View>
  ),
}

export const DisabledNoDropdown: Story = {
  render: () => (
    <ControlledAutocomplete
      sourceList={ERA_NAMES}
      placeholder="Era name…"
      initialValue="Reiwa"
      disabled
    />
  ),
  play: async ({ canvas }) => {
    const input = await canvas.findByPlaceholderText('Era name…')
    fireEvent.focus(input)
    // No suggestion buttons should appear in disabled state
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByRole('button', { name: 'Reiwa' })).not.toBeInTheDocument()
  },
}
