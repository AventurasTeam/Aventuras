import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'

import { themes } from '@/lib/themes'

import { InlineEditableName } from './inline-editable-name'
import { Text } from './text'

const meta: Meta<typeof InlineEditableName> = {
  title: 'Primitives/InlineEditableName',
  component: InlineEditableName,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof InlineEditableName>

function Controlled({
  initial,
  ...rest
}: {
  initial: string
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}) {
  const [value, setValue] = useState(initial)
  return (
    <View className="gap-2" style={{ width: 360 }}>
      <InlineEditableName value={value} onChange={setValue} {...rest} />
      <Text variant="muted" size="sm">
        Value: {value === '' ? '(empty)' : value}
      </Text>
    </View>
  )
}

export const Default: Story = {
  render: () => <Controlled initial="Aria Vex" />,
}

export const Sizes: Story = {
  render: () => {
    const [a, setA] = useState('Aria Vex')
    const [b, setB] = useState('Aria Vex')
    const [c, setC] = useState('Aria Vex')
    return (
      <View className="gap-4" style={{ width: 360 }}>
        <View className="gap-1">
          <Text variant="muted" size="sm">
            sm
          </Text>
          <InlineEditableName size="sm" value={a} onChange={setA} />
        </View>
        <View className="gap-1">
          <Text variant="muted" size="sm">
            md (default)
          </Text>
          <InlineEditableName size="md" value={b} onChange={setB} />
        </View>
        <View className="gap-1">
          <Text variant="muted" size="sm">
            lg
          </Text>
          <InlineEditableName size="lg" value={c} onChange={setC} />
        </View>
      </View>
    )
  },
}

export const EmptyPlaceholder: Story = {
  render: () => <Controlled initial="" placeholder="Untitled" />,
}

export const Disabled: Story = {
  render: () => {
    const [value, setValue] = useState('Aria Vex')
    return (
      <View className="gap-2" style={{ width: 360 }}>
        <Text variant="muted" size="sm">
          Disabled — no pencil, row not tappable.
        </Text>
        <InlineEditableName value={value} onChange={setValue} disabled />
        <Text variant="muted" size="sm">
          And the empty + disabled combination falls back to the placeholder as muted text:
        </Text>
        <InlineEditableName value="" onChange={() => {}} disabled placeholder="Untitled" />
      </View>
    )
  },
}

export const LongName: Story = {
  render: () => {
    const [value, setValue] = useState(
      'The Compendium of Esoteric Cartomancy and Other Forgotten Arts of the Eastern Reach',
    )
    return (
      <View className="gap-2" style={{ width: 480 }}>
        <Text variant="muted" size="sm">
          Long names render in full — the primitive does not truncate; DetailPane&apos;s head
          handles overflow at the row level.
        </Text>
        <InlineEditableName value={value} onChange={setValue} size="lg" />
      </View>
    )
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="gap-3 rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <ThemeMatrixRow />
        </View>
      ))}
    </View>
  ),
}

function ThemeMatrixRow() {
  const [a, setA] = useState('Aria Vex')
  const [b, setB] = useState('')
  return (
    <View className="gap-2">
      <InlineEditableName value={a} onChange={setA} size="lg" />
      <InlineEditableName value={b} onChange={setB} placeholder="Untitled" />
    </View>
  )
}
