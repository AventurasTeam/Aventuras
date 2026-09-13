import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { TruncatedText, type TruncatedTextProps } from './truncated-text'

const LONG = 'The Extraordinarily Long Chronicle of the Veilstone Courier and the Crown of Ash'

// ResizeObserver reports after layout, so a "no reveal" assertion waits two frames for it.
const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

const meta: Meta<typeof TruncatedText> = {
  title: 'Compounds/TruncatedText',
  component: TruncatedText,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { children: LONG, className: 'font-semibold' },
  decorators: [
    (Story) => (
      <View className="rounded-md bg-bg-base p-3">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TruncatedText>

function InRow(args: TruncatedTextProps) {
  return (
    <View style={{ width: 200 }} className="flex-row">
      <TruncatedText {...args} />
    </View>
  )
}

/** Truncated: the box is a button named with the full string, and a click shows it in a popover. */
export const Truncated: Story = {
  render: (args) => <InRow {...args} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: LONG }))
    expect(await screen.findByRole('dialog', { name: 'Full text' })).toHaveTextContent(LONG)
  },
}

/** Fits: plain text with no button, and a click reveals nothing. */
export const Fits: Story = {
  args: { children: 'Kael' },
  render: (args) => <InRow {...args} />,
  play: async () => {
    await settle()
    await userEvent.click(screen.getByText('Kael'))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  },
}

/** The popover stays up long enough to read, then closes on its own. */
export const DismissesWhenIdle: Story = {
  render: (args) => <InRow {...args} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: LONG }))
    await screen.findByRole('dialog', { name: 'Full text' })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(screen.getByRole('dialog', { name: 'Full text' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 })
  },
}

function Narrows(args: TruncatedTextProps) {
  const [narrow, setNarrow] = useState(false)
  return (
    <View className="gap-3">
      <Button onPress={() => setNarrow(true)}>
        <Text>Narrow</Text>
      </Button>
      <View style={{ width: narrow ? 200 : 900 }} className="flex-row">
        <TruncatedText {...args} />
      </View>
    </View>
  )
}

/** A box that shrinks under the same string re-measures and gains the reveal. */
export const BecomesTruncated: Story = {
  render: (args) => <Narrows {...args} />,
  play: async () => {
    await settle()
    expect(screen.queryByRole('button', { name: LONG })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Narrow' }))
    expect(await screen.findByRole('button', { name: LONG })).toBeInTheDocument()
  },
}

function Lengthens(args: TruncatedTextProps) {
  const [label, setLabel] = useState('Kael')
  return (
    <View className="gap-3" style={{ width: 200 }}>
      <Button onPress={() => setLabel(LONG)}>
        <Text>Lengthen</Text>
      </Button>
      <TruncatedText {...args}>{label}</TruncatedText>
    </View>
  )
}

/** No layout event fires when a stretched box's string grows; TruncatedText still re-measures. */
export const LengthensInPlace: Story = {
  render: (args) => <Lengthens {...args} />,
  play: async () => {
    await settle()
    expect(screen.queryByRole('button', { name: 'Kael' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Lengthen' }))
    expect(await screen.findByRole('button', { name: LONG })).toBeInTheDocument()
  },
}
