import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { FormRow } from './form-row'

const meta: Meta<typeof FormRow> = {
  title: 'Compounds/FormRow',
  component: FormRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof FormRow>

function ControlledInput(props: React.ComponentProps<typeof Input>) {
  const [value, setValue] = React.useState('')
  return <Input value={value} onChangeText={setValue} {...props} />
}

/**
 * Wide container (≥640 px) — 2-col layout. Label is 11 px monospace
 * uppercase in the left column; hint sits below the input.
 */
export const WideTwoColumn: Story = {
  render: () => (
    <View style={{ width: 720 }} className="rounded-md bg-bg-base p-4">
      <FormRow label="Display name" hint="Shown on entries you author.">
        <ControlledInput placeholder="Type a name…" />
      </FormRow>
    </View>
  ),
}

/**
 * Narrow container (<640 px) — stacked layout. Label is sentence-
 * case sans, hint sits between label and input.
 */
export const NarrowStacked: Story = {
  render: () => (
    <View style={{ width: 360 }} className="rounded-md bg-bg-base p-4">
      <FormRow label="Display name" hint="Shown on entries you author.">
        <ControlledInput placeholder="Type a name…" />
      </FormRow>
    </View>
  ),
}

/**
 * Required mark. Visual only — does not gate the control.
 */
export const Required: Story = {
  render: () => (
    <View style={{ width: 360 }} className="rounded-md bg-bg-base p-4">
      <FormRow label="Story title" required hint="Visible on the Story List.">
        <ControlledInput placeholder="Title…" />
      </FormRow>
    </View>
  ),
}

/**
 * Error replaces hint. The control owns its own `aria-invalid` —
 * FormRow does not reach in.
 */
export const WithError: Story = {
  render: () => (
    <View style={{ width: 360 }} className="rounded-md bg-bg-base p-4">
      <FormRow
        label="Story title"
        required
        error="Title cannot be empty"
        hint="Visible on the Story List."
      >
        <ControlledInput placeholder="Title…" aria-invalid />
      </FormRow>
    </View>
  ),
}

/**
 * Forced-stacked override for surfaces where the auto width
 * heuristic doesn't fit — tablet-portrait detail panes are the
 * canonical case.
 */
export const ForcedStacked: Story = {
  render: () => (
    <View style={{ width: 720 }} className="rounded-md bg-bg-base p-4">
      <FormRow label="Display name" stacked hint="Forced stacked even at 720 px.">
        <ControlledInput placeholder="Type a name…" />
      </FormRow>
    </View>
  ),
}

/**
 * Multiple rows. Spec calls for ~16 px between rows; story uses
 * `gap-4` on the parent to demonstrate.
 */
export const MultipleRows: Story = {
  render: () => (
    <View style={{ width: 720 }} className="gap-4 rounded-md bg-bg-base p-4">
      <FormRow label="Display name" hint="Shown on entries you author.">
        <ControlledInput placeholder="Name…" />
      </FormRow>
      <FormRow label="Tagline" required hint="One line, max ~80 chars.">
        <ControlledInput placeholder="A short blurb…" />
      </FormRow>
      <FormRow label="Email" error="Enter a valid email address">
        <ControlledInput placeholder="you@example.com" aria-invalid />
      </FormRow>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-3 rounded-md bg-bg-base p-4"
          style={{ width: 720 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <FormRow label="Display name" required hint="Shown on entries you author.">
            <ControlledInput placeholder="Name…" />
          </FormRow>
          <FormRow label="Email" error="Enter a valid email address">
            <ControlledInput placeholder="you@example.com" aria-invalid />
          </FormRow>
        </View>
      ))}
    </View>
  ),
}

/**
 * Label appears verbatim in both layouts — same identity, different
 * chrome. Lets the test confirm the row renders without inspecting
 * the visual mode.
 */
export const LabelRendersInBothLayouts: Story = {
  render: () => (
    <View style={{ width: 360 }} className="rounded-md bg-bg-base p-4">
      <FormRow label="Field label" hint="Helper text">
        <ControlledInput placeholder="…" />
      </FormRow>
    </View>
  ),
  play: async () => {
    expect(screen.getByText('Field label')).toBeInTheDocument()
    expect(screen.getByText('Helper text')).toBeInTheDocument()
  },
}

export const ErrorReplacesHint: Story = {
  render: () => (
    <View style={{ width: 360 }} className="rounded-md bg-bg-base p-4">
      <FormRow label="Email" hint="Helper text" error="Required">
        <ControlledInput placeholder="…" />
      </FormRow>
    </View>
  ),
  play: async () => {
    // Error wins over hint — the helper text must not be in the DOM.
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.queryByText('Helper text')).not.toBeInTheDocument()
  },
}
