// MultiSelect stories — Basic · Partial · None · Disabled · DisabledWhileOpen
// · PerOptionDisabled · NarrowContainer · ThemeMatrix (partial) · ListDisabled.
// ThemeMatrix is partial per the
// portal-skip rule in docs/ui/components.md → Storybook story conventions:
// the open overlay portals to document.body, escaping per-row dataSet
// scoping. Theme verification for the open branch uses the toolbar global
// theme switcher (web) or <ThemePicker /> on the dev page (native).
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { themes } from '@/lib/themes'

import { MultiSelect, MultiSelectList } from './multi-select'
import { type MultiSelectOption } from './multi-select-state'
import { Text } from './text'

const meta: Meta<typeof MultiSelect> = {
  title: 'Primitives/MultiSelect',
  component: MultiSelect,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof MultiSelect>

const OPTIONS: MultiSelectOption[] = [
  { value: 'classifier' },
  { value: 'retrieval' },
  { value: 'provider' },
  { value: 'embedder' },
  { value: 'pipeline' },
  { value: 'lore_mgmt', label: 'lore mgmt' },
  { value: 'translation' },
  { value: 'chapter_close', label: 'chapter close' },
]

function Stateful({
  initial,
  options = OPTIONS,
  prefix = 'Subsystem',
  disabled,
}: {
  initial: string[]
  options?: MultiSelectOption[]
  prefix?: string
  disabled?: boolean
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <MultiSelect
      prefix={prefix}
      options={options}
      selected={selected}
      onChange={setSelected}
      disabled={disabled}
    />
  )
}

export const Basic: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={OPTIONS.map((o) => o.value)} />
    </View>
  ),
}

export const Partial: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={['classifier', 'retrieval', 'provider', 'embedder']} />
    </View>
  ),
}

export const None: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={[]} />
    </View>
  ),
}

export const Disabled: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful initial={['classifier']} disabled />
    </View>
  ),
}

// The trigger refuses to OPEN while disabled, so the only way to reach an open overlay
// under a live `disabled` is to flip the prop after opening — a save starting under an
// already-open filter. Driven through a harness because the setter must be called from
// outside the modal, which aria-hides every control around it.
let setStoryDisabled: ((next: boolean) => void) | null = null

function DisableAfterOpen() {
  const [disabled, setDisabled] = useState(false)
  useEffect(() => {
    setStoryDisabled = setDisabled
    return () => {
      setStoryDisabled = null
    }
  }, [])
  return <Stateful initial={['classifier']} disabled={disabled} />
}

export const DisabledWhileOpen: Story = {
  render: () => (
    <View className="w-72 p-4">
      <DisableAfterOpen />
    </View>
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /^Subsystem:/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select all' })).toBeVisible())

    setStoryDisabled?.(true)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    // RN-Web renders the row as a div, which jest-dom never reports as disabled.
    const row = screen.getByRole('checkbox', { name: 'retrieval' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAttribute('tabindex', '-1')
  },
}

export const PerOptionDisabled: Story = {
  render: () => (
    <View className="w-72 p-4">
      <Stateful
        initial={['classifier', 'retrieval']}
        options={[
          { value: 'classifier' },
          { value: 'retrieval' },
          { value: 'provider', disabled: true, label: 'provider (gated)' },
          { value: 'embedder' },
        ]}
      />
    </View>
  ),
}

export const NarrowContainer: Story = {
  render: () => (
    <View className="w-40 p-4">
      <Stateful initial={['classifier', 'retrieval']} prefix="Source" />
    </View>
  ),
}

export const ThemeMatrix: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Trigger-state matrix (closed). Open the overlay via the toolbar theme switcher to verify open-state tones.',
      },
    },
  },
  render: () => (
    <View className="flex-row flex-wrap gap-6 p-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col items-start gap-2 rounded-md border border-border bg-bg-base p-4"
        >
          <Text size="xs" variant="muted">
            {t.name}
          </Text>
          <Stateful initial={['classifier', 'retrieval']} />
        </View>
      ))}
    </View>
  ),
}

function StatefulList({ disabled }: { disabled?: boolean }) {
  const [selected, setSelected] = useState<string[]>(['classifier'])
  return (
    <>
      <Text>{`selected:${selected.length}`}</Text>
      <MultiSelectList
        options={OPTIONS}
        selected={selected}
        onChange={setSelected}
        disabled={disabled}
      />
    </>
  )
}

// The bulk actions sit outside the row list, so gating only onToggle left Select all and
// Clear all live while a save was in flight — enough to submit one scene and show the
// failure over another. Asserted as disabled rather than as clicks that change nothing:
// a control announced as enabled is still a trap for keyboard and screen-reader users
// even when its handler is inert, and user-event refuses to click a truly gated one.
export const ListDisabled: Story = {
  render: () => (
    <View className="w-72 p-4">
      <StatefulList disabled />
    </View>
  ),
  play: async () => {
    expect(screen.getByText('selected:1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    // The rows stay gated too, which was already true and must remain so. Asserted on
    // the ARIA attributes rather than toBeDisabled: RN-Web renders the row as a div,
    // which jest-dom never reports as disabled however it is marked up.
    const row = screen.getByRole('checkbox', { name: 'retrieval' })
    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(row).toHaveAttribute('tabindex', '-1')
  },
}
