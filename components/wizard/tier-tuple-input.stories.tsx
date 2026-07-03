import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'

import { TierTupleInput, type TierTupleInputProps } from './tier-tuple-input'

const meta: Meta<typeof TierTupleInput> = {
  title: 'Compounds/Wizard/TierTupleInput',
  component: TierTupleInput,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-[560px] rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TierTupleInput>

// TierTupleInput is a controlled component (no store dependency) — each
// story wraps it in a small stateful harness so onChange has somewhere to go.
function Harness(props: Omit<TierTupleInputProps, 'onChange'>) {
  const [value, setValue] = useState(props.value)
  return <TierTupleInput {...props} value={value} onChange={setValue} />
}

export const EarthGregorianValid: Story = {
  render: () => <Harness calendar={EARTH_GREGORIAN} value={EARTH_GREGORIAN.exampleStartValue} />,
  play: async () => {
    expect(screen.getByText('Year')).toBeInTheDocument()
    expect(screen.getByText('Month')).toBeInTheDocument()
    expect(screen.getByText('Day')).toBeInTheDocument()
    expect(screen.getByText('Hour')).toBeInTheDocument()
    expect(screen.getByText('Minute')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()

    // Month is a labeled tier — dropdown shows the label, not the raw index.
    expect(screen.getByRole('button', { name: /January/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Year')).toHaveValue('2024')

    // No error surfaces before any interaction.
    expect(screen.queryByText(/Enter a value between/)).not.toBeInTheDocument()
  },
}

export const InvalidFeb30ShowsInlineErrorOnBlur: Story = {
  render: () => (
    <Harness
      calendar={EARTH_GREGORIAN}
      value={{ year: 2024, month: 2, day: 30, hour: 0, minute: 0, second: 0 }}
    />
  ),
  play: async () => {
    const dayInput = screen.getByLabelText('Day')
    expect(dayInput).toHaveValue('30')

    // No error until the field is blurred.
    expect(screen.queryByText(/Enter a value between/)).not.toBeInTheDocument()

    await userEvent.click(dayInput)
    await userEvent.tab()

    await waitFor(() =>
      expect(screen.getByText('Enter a value between 1 and 29.')).toBeInTheDocument(),
    )
    expect(dayInput).toHaveAttribute('aria-invalid', 'true')
  },
}

export const Feb29LeapYearIsValid: Story = {
  render: () => (
    <Harness
      calendar={EARTH_GREGORIAN}
      value={{ year: 2024, month: 2, day: 29, hour: 0, minute: 0, second: 0 }}
    />
  ),
  play: async () => {
    const dayInput = screen.getByLabelText('Day')
    await userEvent.click(dayInput)
    await userEvent.tab()
    expect(screen.queryByText(/Enter a value between/)).not.toBeInTheDocument()
  },
}

// Regression: a cleared numeric field is stored as NaN so validation can
// catch an empty tier, but the box must render empty — not the literal
// string "NaN" — or the user could never clear-and-retype a value.
export const ClearingAFieldShowsEmptyNotNaN: Story = {
  render: () => <Harness calendar={EARTH_GREGORIAN} value={EARTH_GREGORIAN.exampleStartValue} />,
  play: async () => {
    const dayInput = screen.getByLabelText('Day')
    await userEvent.click(dayInput)
    await userEvent.clear(dayInput)
    expect(dayInput).toHaveValue('')

    await userEvent.type(dayInput, '15')
    expect(dayInput).toHaveValue('15')
  },
}
