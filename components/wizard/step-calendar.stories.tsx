import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, waitFor } from 'storybook/test'

import { appSettingsStore, wizardStore } from '@/lib/stores'

import { StepCalendar } from './step-calendar'

// StepCalendar reads the wizardStore + appSettingsStore singletons directly
// (no props) — each story resets both so a prior story's picks/seeding never
// leak into the next one.
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
