import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor } from 'storybook/test'

import { Stepper } from './stepper'

const DECREMENT_LABEL = 'Decrease suggestion count'
const INCREMENT_LABEL = 'Increase suggestion count'

const meta: Meta<typeof Stepper> = {
  title: 'Primitives/Stepper',
  component: Stepper,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    value: { control: 'number' },
    min: { control: 'number' },
    max: { control: 'number' },
    disabled: { control: 'boolean' },
  },
}

export default meta
type Story = StoryObj<typeof Stepper>

const noop = () => {}

export const Default: Story = {
  args: {
    value: 3,
    min: 1,
    max: 6,
    onChange: noop,
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
}

export const AtMin: Story = {
  args: {
    value: 1,
    min: 1,
    max: 6,
    onChange: noop,
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
}

export const AtMax: Story = {
  args: {
    value: 6,
    min: 1,
    max: 6,
    onChange: noop,
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
}

export const Disabled: Story = {
  args: {
    value: 3,
    min: 1,
    max: 6,
    disabled: true,
    onChange: noop,
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
}

type DemoProps = {
  initial: number
  min: number
  max: number
}

function Demo({ initial, min, max }: DemoProps) {
  const [value, setValue] = useState(initial)
  return (
    <Stepper
      value={value}
      min={min}
      max={max}
      onChange={setValue}
      decrementLabel={DECREMENT_LABEL}
      incrementLabel={INCREMENT_LABEL}
    />
  )
}

export const IncrementRaisesValue: Story = {
  render: () => <Demo initial={3} min={1} max={6} />,
  play: async ({ canvas }) => {
    expect(canvas.getByText('3')).toBeInTheDocument()
    const increment = canvas.getByRole('button', { name: INCREMENT_LABEL })
    await userEvent.click(increment)
    await waitFor(() => expect(canvas.getByText('4')).toBeInTheDocument())
    expect(canvas.queryByText('3')).not.toBeInTheDocument()
  },
}

export const DecrementLowersValue: Story = {
  render: () => <Demo initial={3} min={1} max={6} />,
  play: async ({ canvas }) => {
    const decrement = canvas.getByRole('button', { name: DECREMENT_LABEL })
    await userEvent.click(decrement)
    await waitFor(() => expect(canvas.getByText('2')).toBeInTheDocument())
    expect(canvas.queryByText('3')).not.toBeInTheDocument()
  },
}

export const AtMinBlocksDecrement: Story = {
  args: {
    value: 1,
    min: 1,
    max: 6,
    onChange: fn(),
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
  play: async ({ canvas, args }) => {
    const decrement = await canvas.findByRole('button', { name: DECREMENT_LABEL })
    expect(decrement).toBeDisabled()
    fireEvent.click(decrement)
    expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const AtMaxBlocksIncrement: Story = {
  args: {
    value: 6,
    min: 1,
    max: 6,
    onChange: fn(),
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
  play: async ({ canvas, args }) => {
    const increment = await canvas.findByRole('button', { name: INCREMENT_LABEL })
    expect(increment).toBeDisabled()
    fireEvent.click(increment)
    expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const DisabledBlocksBothControls: Story = {
  args: {
    value: 3,
    min: 1,
    max: 6,
    disabled: true,
    onChange: fn(),
    decrementLabel: DECREMENT_LABEL,
    incrementLabel: INCREMENT_LABEL,
  },
  play: async ({ canvas, args }) => {
    const decrement = await canvas.findByRole('button', { name: DECREMENT_LABEL })
    const increment = await canvas.findByRole('button', { name: INCREMENT_LABEL })
    expect(decrement).toBeDisabled()
    expect(increment).toBeDisabled()
    fireEvent.click(decrement)
    fireEvent.click(increment)
    expect(args.onChange).not.toHaveBeenCalled()
  },
}

// A stored value can arrive already outside `[min, max]` — a range narrowed
// after the value was saved, or a config imported from elsewhere. The
// disabled gate only compares against the bound facing the pressed control
// (decrement checks `min`, increment checks `max`), so a value past the far
// bound still leaves that control enabled, and clamp is what pulls it back
// in on the first press rather than letting it drift by ±1 indefinitely.
export const ClampsWhenStartingAboveMax: Story = {
  render: () => <Demo initial={9} min={1} max={6} />,
  play: async ({ canvas }) => {
    expect(canvas.getByText('9')).toBeInTheDocument()
    const decrement = canvas.getByRole('button', { name: DECREMENT_LABEL })
    await userEvent.click(decrement)
    await waitFor(() => expect(canvas.getByText('6')).toBeInTheDocument())
    expect(canvas.queryByText('8')).not.toBeInTheDocument()
  },
}

export const ClampsWhenStartingBelowMin: Story = {
  render: () => <Demo initial={-2} min={1} max={6} />,
  play: async ({ canvas }) => {
    expect(canvas.getByText('-2')).toBeInTheDocument()
    const increment = canvas.getByRole('button', { name: INCREMENT_LABEL })
    await userEvent.click(increment)
    await waitFor(() => expect(canvas.getByText('1')).toBeInTheDocument())
    expect(canvas.queryByText('-1')).not.toBeInTheDocument()
  },
}
