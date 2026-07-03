import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { EARTH_GREGORIAN, type CalendarSystem } from '@/lib/calendar'
import { appSettingsStore, wizardStore } from '@/lib/stores'

import { StepCalendar } from './step-calendar'

// Test-only registry so the swap stories can pick a second calendar — the M2
// built-in registry ships only earth-gregorian, so a real swap through the
// picker is otherwise unreachable. StepCalendar's `calendars` prop injects
// these into the REAL component (not a wiring copy), so handleSelect +
// preserveOriginOnSwap + the store writes are all exercised end-to-end.
const EARTH = EARTH_GREGORIAN

const SHIRE: CalendarSystem = {
  id: 'shire-reckoning',
  name: 'Shire Reckoning',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86_400,
  tiers: [
    { name: 'year', startValue: 1, rollover: { kind: 'constant', value: 1_000_000 } },
    {
      name: 'month',
      startValue: 1,
      rollover: { kind: 'constant', value: 12 },
      labels: [
        'Afteryule',
        'Solmath',
        'Rethe',
        'Astron',
        'Thrimidge',
        'Forelithe',
        'Afterlithe',
        'Wedmath',
        'Halimath',
        'Winterfilth',
        'Blotmath',
        'Foreyule',
      ],
    },
    { name: 'day', startValue: 1, rollover: { kind: 'constant', value: 30 } },
  ],
  exampleStartValue: { year: 1, month: 1, day: 1 },
  displayFormat: '{{ day }} {{ monthName }}, {{ year }}',
  eras: null,
}

const STARDATE: CalendarSystem = {
  id: 'stardate',
  name: 'Stardate',
  baseUnitName: 'count',
  secondsPerBaseUnit: 1,
  tiers: [{ name: 'count', startValue: 0, rollover: { kind: 'constant', value: 1_000_000 } }],
  exampleStartValue: { count: 41000 },
  displayFormat: '{{ count }}',
  eras: null,
}

// Superset of Stardate (shares `count`, adds `tick`) — lets a swap OFF a
// disjoint calendar land on a non-disjoint one, so the reset notice can be
// observed clearing on the following preserve swap. Named so it is NOT a
// substring superset of "Stardate" (option matchers disambiguate by name).
const DUAL_COUNT: CalendarSystem = {
  id: 'dual-count',
  name: 'Dual Count',
  baseUnitName: 'tick',
  secondsPerBaseUnit: 1,
  tiers: [
    { name: 'count', startValue: 0, rollover: { kind: 'constant', value: 1_000_000 } },
    { name: 'tick', startValue: 0, rollover: { kind: 'constant', value: 10 } },
  ],
  exampleStartValue: { count: 0, tick: 0 },
  displayFormat: '{{ count }}.{{ tick }}',
  eras: null,
}

const SWAP_CALENDARS = [EARTH, SHIRE, STARDATE, DUAL_COUNT] as const

async function swapCalendar(fromName: RegExp, toOption: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: fromName }))
  await userEvent.click(await screen.findByRole('option', { name: toOption }))
}

const currentOrigin = () => wizardStore.getWizard().state.definition.worldTimeOrigin
const currentCalendarId = () => wizardStore.getWizard().state.definition.calendarSystemId

// StepCalendar reads the wizardStore + appSettingsStore singletons directly —
// each story resets both so a prior story's picks/seeding never leak into the
// next one. The `calendars` prop (default: the built-in registry) is the only
// injected surface; production renders `<StepCalendar />` with the default.
const meta: Meta<typeof StepCalendar> = {
  title: 'Compounds/Wizard/StepCalendar',
  component: StepCalendar,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-[720px] gap-4 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof StepCalendar>

export const EarthGregorianSelected: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    expect(await screen.findByText('When does this story take place?')).toBeInTheDocument()

    // Picker seeded to Earth (Gregorian) via the app-settings default fallback.
    expect(screen.getByText('Earth (Gregorian)')).toBeInTheDocument()

    // Summary panel — tier rows + subdivisions/eras, derived from the real
    // EARTH_GREGORIAN definition (no subdivisions, no eras in M2). Each row's
    // text node is prefixed with "· " by the CalendarPicker compound itself.
    await waitFor(() => expect(screen.getByText(/constant: 12 months/)).toBeInTheDocument())
    expect(screen.getByText(/table: 28–31 days/)).toBeInTheDocument()
    expect(screen.getByText(/constant: 24 hours/)).toBeInTheDocument()
    expect(screen.getByText(/base unit/)).toBeInTheDocument()
    expect(screen.getByText('none')).toBeInTheDocument()
    expect(screen.getByText('disabled')).toBeInTheDocument()

    // Origin seeded from exampleStartValue and rendered via TierTupleInput.
    expect(screen.getByLabelText('Year')).toHaveValue('2024')
    expect(screen.getByRole('button', { name: /January/ })).toBeInTheDocument()

    // A valid origin renders a real sample instead of the pre-pick placeholder.
    expect(screen.getByText('January 1, 2024 AD 0:0')).toBeInTheDocument()
    expect(screen.queryByText('Placeholder')).not.toBeInTheDocument()

    // No calendar has been swapped yet — no reset notice.
    expect(screen.queryByText('Origin reset for the new calendar.')).not.toBeInTheDocument()

    // Earth's eras are null in M2 — the (dormant) era branch stays absent.
    expect(screen.queryByText('Era selection lands in a later milestone.')).not.toBeInTheDocument()
  },
}

// Non-disjoint swaps (subset then superset): overlapping tier values survive
// the swap, no reset notice fires. Drives the real picker Select inside the
// real StepCalendar via the injected multi-calendar registry.
export const NonDisjointSwapPreservesOrigin: Story = {
  render: () => <StepCalendar calendars={SWAP_CALENDARS} />,
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    expect(await screen.findByText('When does this story take place?')).toBeInTheDocument()
    await waitFor(() => expect(currentCalendarId()).toBe('earth-gregorian'))
    expect(screen.getByLabelText('Year')).toHaveValue('2024')

    // Earth → Shire (subset): year/month/day overlap and survive; the clock
    // tiers are dropped. No reset notice.
    await swapCalendar(/Earth/, /Shire/)

    await waitFor(() => expect(currentCalendarId()).toBe('shire-reckoning'))
    expect(currentOrigin()).toEqual({ year: 2024, month: 1, day: 1 })
    expect(screen.queryByText('Origin reset for the new calendar.')).not.toBeInTheDocument()
    // TierTupleInput reshaped to Shire's tiers — Year kept, Hour gone.
    expect(screen.getByLabelText('Year')).toHaveValue('2024')
    expect(screen.queryByLabelText('Hour')).not.toBeInTheDocument()

    // Shire → Earth (superset): year/month/day preserved, the missing clock
    // tiers refill from Earth's exampleStartValue. Still no notice.
    await swapCalendar(/Shire/, /Earth/)

    await waitFor(() => expect(currentCalendarId()).toBe('earth-gregorian'))
    expect(currentOrigin()).toEqual({ year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 })
    expect(screen.queryByText('Origin reset for the new calendar.')).not.toBeInTheDocument()
  },
}

// Disjoint swap resets the origin (+ notice); a following non-disjoint swap
// preserves overlap AND clears the notice — the state-clearing wiring the
// pure preserveOriginOnSwap tests can't reach on their own.
export const DisjointSwapResetsThenPreserveClearsNotice: Story = {
  render: () => <StepCalendar calendars={SWAP_CALENDARS} />,
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    expect(await screen.findByText('When does this story take place?')).toBeInTheDocument()
    await waitFor(() => expect(currentCalendarId()).toBe('earth-gregorian'))

    // Earth → Stardate (disjoint {count} vs {year…second}): full reset to
    // Stardate's exampleStartValue, notice shown.
    await swapCalendar(/Earth/, /Stardate/)

    await waitFor(() => expect(currentCalendarId()).toBe('stardate'))
    expect(currentOrigin()).toEqual({ count: 41000 })
    expect(await screen.findByText('Origin reset for the new calendar.')).toBeInTheDocument()
    // TierTupleInput reshaped to Stardate's single tier.
    expect(screen.getByLabelText('Count')).toHaveValue('41000')
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument()

    // Stardate → Dual Count (superset, non-disjoint): count preserved, tick
    // filled from example, and the reset notice clears.
    await swapCalendar(/Stardate/, /Dual Count/)

    await waitFor(() => expect(currentCalendarId()).toBe('dual-count'))
    expect(currentOrigin()).toEqual({ count: 41000, tick: 0 })
    await waitFor(() =>
      expect(screen.queryByText('Origin reset for the new calendar.')).not.toBeInTheDocument(),
    )
  },
}
