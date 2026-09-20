import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { NumberInput } from './number-input'

// Stands in for a Story Settings section: owns the draft, flags values under
// `min` as out of range, and Discard restores the saved value.
function Harness({
  initial,
  integer,
  min,
  disabled,
  disabledReason,
  onChange,
}: {
  initial: number | null
  integer?: boolean
  min?: number
  disabled?: boolean
  disabledReason?: string
  onChange: (next: number | null) => void
}) {
  const [value, setValue] = useState<number | null>(initial)
  return (
    <View className="w-64 gap-2">
      <NumberInput
        testID="number"
        label="Count"
        value={value}
        integer={integer}
        disabled={disabled}
        disabledReason={disabledReason}
        invalid={min != null && value != null && value < min}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <Text testID="value">{value == null ? 'null' : String(value)}</Text>
      <Button variant="secondary" onPress={() => setValue(initial)}>
        <Text>Discard</Text>
      </Button>
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/NumberInput',
  component: Harness,
  parameters: { layout: 'centered' },
  args: { initial: 10, onChange: fn() },
}
export default meta
type Story = StoryObj<typeof Harness>

async function retype(input: HTMLElement, text: string) {
  await userEvent.clear(input)
  await userEvent.type(input, text)
}

// Exact match: `toHaveTextContent` is a substring check, so '5' would pass for '15'.
function reported() {
  return screen.getByTestId('value').textContent
}

export const TypesAnInteger: Story = {
  play: async ({ args }) => {
    const input = await screen.findByTestId('number')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    await retype(input, '42')
    expect(reported()).toBe('42')
    expect(args.onChange).toHaveBeenLastCalledWith(42)
    expect(input).not.toHaveAttribute('aria-invalid', 'true')

    await retype(input, ' 7 ')
    expect(reported()).toBe('7')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  },
}

export const EmptyReportsNull: Story = {
  play: async ({ args }) => {
    const input = await screen.findByTestId('number')
    await userEvent.clear(input)
    expect(reported()).toBe('null')
    expect(args.onChange).toHaveBeenLastCalledWith(null)
    // Empty is the owner's call to flag; the compound marks only text it cannot read.
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  },
}

export const FractionRejectedWhenInteger: Story = {
  play: async () => {
    const input = await screen.findByTestId('number')
    await retype(input, '2.5')
    expect(reported()).toBe('null')
    expect(input).toHaveValue('2.5')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  },
}

export const RejectsNonDecimalForms: Story = {
  play: async ({ args }) => {
    const input = await screen.findByTestId('number')
    for (const text of ['0x10', '1e3', '12abc', '1,5']) {
      await retype(input, text)
      expect(reported()).toBe('null')
      expect(args.onChange).toHaveBeenLastCalledWith(null)
      expect(input).toHaveValue(text)
      expect(input).toHaveAttribute('aria-invalid', 'true')
    }
    await retype(input, '-3')
    expect(reported()).toBe('-3')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  },
}

export const DigitsPastFloatRangeReportNull: Story = {
  play: async () => {
    const input = await screen.findByTestId('number')
    fireEvent.change(input, { target: { value: '9'.repeat(400) } })
    expect(reported()).toBe('null')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  },
}

export const DecimalAllowed: Story = {
  args: { initial: 0.25, integer: false },
  play: async () => {
    const input = await screen.findByTestId('number')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    await retype(input, '0.75')
    expect(reported()).toBe('0.75')
    await retype(input, '.5')
    expect(reported()).toBe('0.5')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    await retype(input, '5e-1')
    expect(reported()).toBe('null')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  },
}

export const AcceptsCommaDecimalSeparator: Story = {
  args: { initial: 0.25, integer: false },
  play: async () => {
    const input = await screen.findByTestId('number')
    await retype(input, '0,5')
    expect(reported()).toBe('0.5')
    expect(input).toHaveValue('0,5')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')

    for (const text of ['1,2,3', '1.2,3']) {
      await retype(input, text)
      expect(reported()).toBe('null')
      expect(input).toHaveAttribute('aria-invalid', 'true')
    }
  },
}

export const KeepsLeadingZeroWhileTyping: Story = {
  play: async () => {
    const input = await screen.findByTestId('number')
    await retype(input, '05')
    expect(input).toHaveValue('05')
    expect(reported()).toBe('5')
  },
}

export const KeepsTrailingDecimalPointWhileTyping: Story = {
  args: { initial: 0.25, integer: false },
  play: async () => {
    const input = await screen.findByTestId('number')
    await retype(input, '1.')
    expect(input).toHaveValue('1.')
    expect(reported()).toBe('1')
    await userEvent.type(input, '5')
    expect(input).toHaveValue('1.5')
    expect(reported()).toBe('1.5')
  },
}

export const DiscardReplacesTypedText: Story = {
  play: async () => {
    const input = await screen.findByTestId('number')
    const discard = screen.getByRole('button', { name: 'Discard' })
    await retype(input, '42')
    await userEvent.click(discard)
    expect(input).toHaveValue('10')
    expect(reported()).toBe('10')

    await retype(input, '12abc')
    await userEvent.click(discard)
    expect(input).toHaveValue('10')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  },
}

export const OwnerInvalidFlag: Story = {
  args: { initial: 1, min: 2 },
  play: async () => {
    const input = await screen.findByTestId('number')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await retype(input, '3')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  },
}

export const Disabled: Story = {
  args: { disabled: true, disabledReason: 'Generation is in flight. Cancel to edit.' },
  play: async ({ args }) => {
    const input = await screen.findByTestId('number')
    expect(input).toHaveAttribute('readonly')
    expect(input.closest('[title]')).toHaveAttribute(
      'title',
      'Generation is in flight. Cancel to edit.',
    )
    await userEvent.type(input, '5')
    expect(input).toHaveValue('10')
    expect(args.onChange).not.toHaveBeenCalled()
  },
}

export const EnabledIgnoresDisabledReason: Story = {
  args: { disabledReason: 'Generation is in flight. Cancel to edit.' },
  play: async () => {
    const input = await screen.findByTestId('number')
    expect(input.closest('[title]')).toBeNull()
    expect(input).not.toHaveAttribute('readonly')
  },
}
