import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN, type CalendarSystem, type TierTuple } from '@/lib/calendar'

import { TierTupleInput, type TierTupleInputProps } from './tier-tuple-input'

// A calendar whose `day` tier tops out at 10 — swapping to it while a valid
// Earth `day` value (e.g. 20) is retained makes that same-named tier invalid,
// the exact scenario the touched-reset guard protects against.
const SHORT_DAY_CALENDAR: CalendarSystem = {
  id: 'test-short-day',
  name: 'Short Day',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    { name: 'day', startValue: 1, rollover: { kind: 'constant', value: 10 } },
  ],
  exampleStartValue: { year: 1, day: 1 },
  displayFormat: '{{ year }}-{{ day }}',
  eras: null,
}

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

function SwapHarness() {
  const [calendar, setCalendar] = useState<CalendarSystem>(EARTH_GREGORIAN)
  const [value, setValue] = useState<TierTuple>({
    year: 2024,
    month: 1,
    day: 20,
    hour: 0,
    minute: 0,
    second: 0,
  })
  return (
    <View className="gap-4">
      <Pressable accessibilityRole="button" onPress={() => setCalendar(SHORT_DAY_CALENDAR)}>
        <Text>Swap calendar</Text>
      </Pressable>
      {/* Keyed by calendar id, mirroring StepCalendar: a swap remounts the
          input, which is what clears its name-keyed `touched` state. */}
      <TierTupleInput key={calendar.id} calendar={calendar} value={value} onChange={setValue} />
    </View>
  )
}

// Blur `day`=20 under Earth (valid, no error), then swap to a calendar where
// day's max is 10 (making the retained 20 invalid). The stale `touched` flag
// must NOT flash an error — the keyed remount resets it; the error only returns
// on a fresh blur of the new calendar's field.
export const SwapResetsTouchedState: Story = {
  render: () => <SwapHarness />,
  play: async () => {
    const dayInput = screen.getByLabelText('Day')
    await userEvent.click(dayInput)
    await userEvent.tab()
    expect(screen.queryByText(/Enter a value between/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Swap calendar' }))

    // Retained day=20 is now out of range (max 10) but no interaction has
    // happened on the new calendar — no error should show.
    expect(screen.getByLabelText('Day')).toHaveValue('20')
    expect(screen.queryByText(/Enter a value between/)).not.toBeInTheDocument()

    // A fresh blur re-arms the error, proving validation still runs post-swap.
    await userEvent.click(screen.getByLabelText('Day'))
    await userEvent.tab()
    await waitFor(() =>
      expect(screen.getByText('Enter a value between 1 and 10.')).toBeInTheDocument(),
    )
  },
}
