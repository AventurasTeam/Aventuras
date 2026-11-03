import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN, type CalendarFrame } from '@/lib/calendar'

import { TimeChip, type TimeChipProps } from './time-chip'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
const FRAME: CalendarFrame = { calendar: EARTH_GREGORIAN, origin: ORIGIN }
const LONG_LABEL =
  'The eleventh day of the long rains in the third year of the reign of the Ashen Queen'
const LONG_FRAME: CalendarFrame = {
  calendar: { ...EARTH_GREGORIAN, displayFormat: LONG_LABEL },
  origin: ORIGIN,
}
const NEIGHBOUR = 'Beside the chip'

function InRow(props: TimeChipProps) {
  return (
    <View className="w-[480px] flex-row items-center gap-2">
      <TimeChip {...props} />
      <Text size="xs">{NEIGHBOUR}</Text>
    </View>
  )
}

async function expectNoChip() {
  await screen.findByText(NEIGHBOUR)
  await expect(screen.queryByTestId('time-chip')).toBeNull()
}

const meta: Meta<typeof TimeChip> = {
  title: 'Compounds/Reader/TimeChip',
  component: TimeChip,
  parameters: { layout: 'centered' },
  render: InRow,
}

export default meta
type Story = StoryObj<typeof TimeChip>

export const Default: Story = {
  args: { seconds: 3_600, frame: FRAME },
  play: async () => {
    const chip = await screen.findByRole('group', {
      name: 'In-world time: January 1, 2024 AD 01:00',
    })
    await expect(chip).toHaveAttribute('data-testid', 'time-chip')
    await expect(chip).toHaveTextContent('January 1, 2024 AD 01:00')
    const label = (await screen.findByText('January 1, 2024 AD 01:00')).getBoundingClientRect()
    const box = chip.getBoundingClientRect()
    await expect(label.top + label.height / 2).toBe(box.top + box.height / 2)
    await expect(chip.querySelector('svg')).not.toBeNull()
    await expect(screen.queryByRole('button')).toBeNull()
  },
}

export const LongLabel: Story = {
  args: { seconds: 0, frame: LONG_FRAME },
  play: async () => {
    const chip = await screen.findByTestId('time-chip')
    await waitFor(() => expect(chip.getBoundingClientRect().width).toBe(260))
    await userEvent.click(await screen.findByRole('button', { name: LONG_LABEL }))
    await expect(await screen.findByRole('dialog', { name: 'Full text' })).toHaveTextContent(
      LONG_LABEL,
    )
  },
}

// touch.md: the phone floor is 44 px, and the truncated chip is a tap target.
export const LongLabelPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: { seconds: 0, frame: LONG_FRAME },
  play: async () => {
    const button = await screen.findByRole('button', { name: LONG_LABEL })
    expect(button.getBoundingClientRect().height).toBe(44)
  },
}

export const NoFrame: Story = {
  args: { seconds: 3_600, frame: null },
  play: expectNoChip,
}

export const FormatMiss: Story = {
  args: { seconds: -1, frame: FRAME },
  play: expectNoChip,
}

export const EmptyFormat: Story = {
  args: { seconds: 0, frame: { ...FRAME, calendar: { ...EARTH_GREGORIAN, displayFormat: '' } } },
  play: expectNoChip,
}
