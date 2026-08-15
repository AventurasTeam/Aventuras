import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { type ReactElement } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'

import { WorldTimeEditForm } from './world-time-edit-form'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
// Origin partway through a month, so a single backspace on `day` reaches a time
// before the story start without any intermediate tuple being invalid.
const MID_MONTH_ORIGIN = { year: 2024, month: 6, day: 15, hour: 0, minute: 0, second: 0 }

const meta: Meta<typeof WorldTimeEditForm> = {
  title: 'Compounds/WorldTimeEditForm',
  component: WorldTimeEditForm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type StoryT = StoryObj<typeof WorldTimeEditForm>

const wrapDecorator = (Story: () => ReactElement) => (
  <View style={{ width: 560 }}>
    <Story />
  </View>
)
const wrap = { decorators: [wrapDecorator] } satisfies Partial<StoryT>

const baseArgs = {
  calendar: EARTH_GREGORIAN,
  worldTimeOrigin: ORIGIN,
  // 90s past the origin → minute 1, second 30.
  worldTimeRaw: 90,
  onSave: fn(),
  onCancel: fn(),
}

// Every story but the first has its tree remounted a tick into `play`, which
// detaches any node captured before then — keystrokes land on the dead node and
// the remount resets the form's seeded state. Poll until the query returns the
// same element twice; the deliberate first-pass failure forces one interval to
// elapse, so the remount is always behind us.
async function settledField(label: string): Promise<HTMLElement> {
  let previous: HTMLElement | null = null
  await waitFor(() => {
    const current = screen.getByLabelText(label)
    const settled = current === previous && current.isConnected
    previous = current
    expect(settled).toBe(true)
  })
  return previous!
}

export const Default: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async () => {
    await expect(await settledField('Minute')).toHaveValue('1')
    await expect(screen.getByLabelText('Second')).toHaveValue('30')
  },
}

export const WithMonotonicityBanner: StoryT = {
  ...wrap,
  args: { ...baseArgs, monotonicityBreak: { previousLabel: 'Jan 1, 2024 · 00:02' } },
  play: async () => {
    await expect(
      await screen.findByText(/Earlier than previous entry \(Jan 1, 2024 · 00:02\)/),
    ).toBeVisible()
  },
}

// Every edit here appends or deletes one digit, so no intermediate tuple is
// invalid and Save never round-trips through `disabled` — react-native-web
// leaves a stale `pointer-events: none` on a re-enabled Pressable, which
// userEvent then refuses to click.
export const SaveComputesSeconds: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const minute = await settledField('Minute')
    await userEvent.type(minute, '2')
    await expect(minute).toHaveValue('12')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith(750)
    await expect(args.onCancel).not.toHaveBeenCalled()
  },
}

// Opening and saving without touching a field must not write a delta.
export const NoChangeSaveSuppressed: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    await settledField('Minute')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

// A round-trip edit landing back on the seed tuple is still a no-change save:
// suppression has to weigh every tier, not just the first one it looks at.
export const EditedBackToSeedIsSuppressed: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const minute = await settledField('Minute')
    await userEvent.type(minute, '2')
    await expect(minute).toHaveValue('12')
    await userEvent.type(minute, '{Backspace}')
    await expect(minute).toHaveValue('1')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

export const BelowOriginBlocked: StoryT = {
  ...wrap,
  args: { ...baseArgs, worldTimeOrigin: MID_MONTH_ORIGIN },
  play: async ({ args }) => {
    const day = await settledField('Day')
    await expect(day).toHaveValue('15')
    await userEvent.type(day, '{Backspace}')
    await expect(day).toHaveValue('1')

    await expect(await screen.findByText('Time cannot be before the story start.')).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

// A cleared tier reaches `tupleToWorldTime` as NaN, and that function does not
// bounds-check — it would return a plausible-looking finite number computed
// from the remaining tiers, here a large negative one. Validity has to gate the
// conversion outright, so the empty field stays TierTupleInput's error to
// report and no spurious below-origin warning appears.
export const ClearedFieldBlocksSave: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const year = await settledField('Year')
    await userEvent.clear(year)
    await expect(year).toHaveValue('')

    await expect(
      screen.queryByText('Time cannot be before the story start.'),
    ).not.toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}
