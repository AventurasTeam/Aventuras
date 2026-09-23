// Select stories — Default · Variants · Sizes · States · ThemeMatrix
// (partial). ThemeMatrix is intentionally partial per the
// portal-skip rule in docs/ui/components.md → Storybook story
// conventions: the dropdown render mode portals its open content
// to document.body, escaping per-row dataSet scoping. Theme
// verification for the dropdown branch happens via the toolbar
// global theme switcher (web) or `<ThemePicker />` on the dev page
// (native). Segment and radio render modes stay inline so they ARE
// covered in ThemeMatrix below.
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { expect, screen, spyOn, userEvent, waitFor } from 'storybook/test'

import { themes } from '@/lib/themes'

import { Select, type SelectOption } from './select'
import { Text } from './text'

const meta: Meta<typeof Select> = {
  title: 'Primitives/Select',
  component: Select,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Select>

const SHORT_OPTIONS: SelectOption[] = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
]

const LONG_OPTIONS: SelectOption[] = Array.from({ length: 8 }, (_, i) => ({
  value: `opt-${i + 1}`,
  label: `Option ${i + 1}`,
}))

const RADIO_OPTIONS: SelectOption[] = [
  {
    value: 'collaborate',
    label: 'Collaborate',
    description: 'Co-author entries with the AI; suggestions surface inline.',
  },
  {
    value: 'review',
    label: 'Review',
    description: 'AI drafts; you accept, edit, or reject before commit.',
  },
  {
    value: 'narrate',
    label: 'Narrate',
    description: 'AI narrates the world; you respond as the protagonist.',
  },
]

function Stateful({
  initial,
  ...rest
}: {
  initial: string
  options: SelectOption[]
  mode?: ComponentProps<typeof Select>['mode']
  placeholder?: string
  disabled?: boolean
  className?: string
  label?: string
  renderTrigger?: ComponentProps<typeof Select>['renderTrigger']
}) {
  const [value, setValue] = useState(initial)
  return <Select {...rest} value={value} onValueChange={setValue} />
}

export const Default: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial="two" options={SHORT_OPTIONS} />
    </View>
  ),
}

export const Variants: Story = {
  render: () => (
    <View className="flex-col gap-6 p-4">
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          segment (cardinality ≤ 3 / ≤ 2 on phone)
        </Text>
        <Stateful initial="two" mode="segment" options={SHORT_OPTIONS} />
      </View>
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          radio (any option carries a description)
        </Text>
        <Stateful initial="collaborate" mode="radio" options={RADIO_OPTIONS} />
      </View>
      <View className="w-72 flex-col gap-2">
        <Text variant="muted" size="xs">
          dropdown (≥ 4 options or `mode=&quot;dropdown&quot;` explicit)
        </Text>
        <Stateful initial="opt-1" mode="dropdown" options={LONG_OPTIONS} />
      </View>
    </View>
  ),
}

export const States: Story = {
  render: () => (
    <View className="flex-col gap-4 p-4">
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          empty (no value yet)
        </Text>
        <View className="w-72">
          <Stateful initial="" mode="dropdown" options={LONG_OPTIONS} placeholder="Pick one…" />
        </View>
      </View>
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          disabled (whole control)
        </Text>
        <View className="w-72">
          <Stateful initial="opt-1" mode="dropdown" options={LONG_OPTIONS} disabled />
        </View>
      </View>
      <View className="flex-col gap-2">
        <Text variant="muted" size="xs">
          per-option disabled (segment)
        </Text>
        <Stateful
          initial="one"
          mode="segment"
          options={[
            { value: 'one', label: 'One' },
            { value: 'two', label: 'Two', disabled: true },
            { value: 'three', label: 'Three' },
          ]}
        />
      </View>
    </View>
  ),
}

// Without `label` every branch falls back to naming itself by its own current
// value, so the control an assistive-tech user hears renames itself on every
// pick. One assertion per branch: each render mode carries its own
// `aria-label`, and nothing downstream pins them.
/** A pick the parent never commits leaves the trigger on its muted placeholder, still controlled. */
export const EmptyDropdownStaysControlled: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Select
        mode="dropdown"
        label="Add agent"
        placeholder="Pick one…"
        value={undefined}
        options={SHORT_OPTIONS}
        onValueChange={() => {}}
      />
    </View>
  ),
  play: async () => {
    const warn = spyOn(console, 'warn')
    const trigger = await screen.findByRole('button', { name: 'Add agent' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Two' }))
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument())

    expect(trigger).toHaveTextContent('Pick one…')
    expect(screen.getByText('Pick one…')).toHaveClass('text-fg-muted')
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/uncontrolled to controlled/))
    warn.mockRestore()
  },
}

/** Every render mode carries its disabled reason as a tooltip over the control. */
export const DisabledReasonEveryMode: Story = {
  render: () => (
    <View className="w-72 flex-col gap-6 p-4">
      {(['segment', 'radio', 'dropdown'] as const).map((mode) => (
        <Select
          key={mode}
          mode={mode}
          label={`${mode} field`}
          options={mode === 'radio' ? RADIO_OPTIONS : SHORT_OPTIONS}
          value={undefined}
          onValueChange={() => {}}
          disabled
          disabledReason={`${mode} is busy`}
        />
      ))}
    </View>
  ),
  play: async () => {
    const controls = [
      screen.getByRole('radiogroup', { name: 'segment field' }),
      screen.getByRole('radiogroup', { name: 'radio field' }),
      screen.getByRole('button', { name: 'dropdown field' }),
    ]
    for (const [i, mode] of ['segment', 'radio', 'dropdown'].entries()) {
      expect(controls[i]!.closest('[title]')).toHaveAttribute('title', `${mode} is busy`)
    }
  },
}

export const LabelNamesEveryRenderMode: Story = {
  render: () => (
    <View className="w-72 flex-col gap-6 p-4">
      <Stateful initial="two" mode="segment" options={SHORT_OPTIONS} label="Segment field" />
      <Stateful initial="collaborate" mode="radio" options={RADIO_OPTIONS} label="Radio field" />
      <Stateful initial="opt-1" mode="dropdown" options={LONG_OPTIONS} label="Dropdown field" />
      {/* A renderTrigger owns its own (richer) accessible content, so the
          dropdown must NOT overwrite it with the flat `label`. */}
      <Stateful
        initial="opt-2"
        mode="dropdown"
        options={LONG_OPTIONS}
        label="Custom trigger field"
        renderTrigger={({ selected }) => <Text>Currently: {selected?.label}</Text>}
      />
    </View>
  ),
  play: async () => {
    expect(await screen.findByRole('radiogroup', { name: 'Segment field' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Radio field' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dropdown field' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Currently: Option 2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Custom trigger field' })).not.toBeInTheDocument()
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-3 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-col gap-3">
            <Stateful initial="two" mode="segment" options={SHORT_OPTIONS} />
            <Stateful initial="collaborate" mode="radio" options={RADIO_OPTIONS} />
            {/* Dropdown trigger only — open content portals to
                document.body and escapes the per-row dataSet scope.
                The trigger itself IS scoped, so border + hover
                contrast across themes can be validated here. The
                open-popover content theming is verified via the
                Storybook toolbar theme switcher instead. */}
            <Stateful initial="opt-3" mode="dropdown" options={LONG_OPTIONS} />
          </View>
        </View>
      ))}
    </View>
  ),
}
