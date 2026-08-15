import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { type ReactElement } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { EARTH_GREGORIAN, type CalendarSystem } from '@/lib/calendar'

import { WorldTimeEditForm } from './world-time-edit-form'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

// `lib/calendar` keeps its day-grain fixtures behind the module's public API,
// so this mirrors one: Gregorian year/month/day over a day-sized base unit,
// where a tuple simply cannot carry a sub-day remainder. The `id` must stay
// distinct from EARTH_GREGORIAN's — the per-year cost cache is module-level and
// keyed by calendar id, so sharing one would poison every other story.
const DAY_GRAIN_CALENDAR: CalendarSystem = {
  ...EARTH_GREGORIAN,
  id: 'story-day-grain',
  baseUnitName: 'day',
  secondsPerBaseUnit: 86400,
  tiers: EARTH_GREGORIAN.tiers.slice(0, 3),
  exampleStartValue: { year: 2024, month: 1, day: 1 },
  displayFormat: '{{ monthName }} {{ day }}, {{ year }}',
}
const DAY_GRAIN_ORIGIN = { year: 2024, month: 1, day: 1 }
// One day plus one hour. The tuple rounds to day 2, worth 86400s, so the hour
// survives only if the no-change check compares tuples rather than seconds.
const DAY_PLUS_HOUR = 90_000

const meta: Meta<typeof WorldTimeEditForm> = {
  title: 'Compounds/WorldTimeEditForm',
  component: WorldTimeEditForm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type StoryT = StoryObj<typeof WorldTimeEditForm>

// Harness constraint, not a product boundary: NativeWind classes don't compute
// in the vitest storybook browser, so FormRow measures this inline width against
// its window-derived first guess. Below 640px the two disagree and the
// correcting re-render swaps JSX branches, remounting every field mid-play.
const wrapDecorator = (Story: () => ReactElement) => (
  <View style={{ width: 720 }}>
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

export const Default: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async () => {
    await expect(screen.getByLabelText('Minute')).toHaveValue('1')
    await expect(screen.getByLabelText('Second')).toHaveValue('30')
  },
}

export const WithMonotonicityBanner: StoryT = {
  ...wrap,
  args: { ...baseArgs, monotonicityBreak: { previousLabel: 'Jan 1, 2024 · 00:02' } },
  play: async () => {
    await expect(
      screen.getByText(/Earlier than previous entry \(Jan 1, 2024 · 00:02\)/),
    ).toBeVisible()
  },
}

export const SaveComputesSeconds: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const second = screen.getByLabelText('Second')
    await userEvent.clear(second)
    await userEvent.type(second, '0')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).toHaveBeenCalledWith(60)
    await expect(args.onCancel).not.toHaveBeenCalled()
  },
}

// Opening and saving without touching a field must not write a delta.
export const NoChangeSaveSuppressed: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
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
    const second = screen.getByLabelText('Second')
    await userEvent.clear(second)
    await userEvent.type(second, '45')
    await userEvent.clear(second)
    await userEvent.type(second, '30')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

// On a calendar coarser than a second the tuple truncates, so a no-change save
// judged on seconds would rewrite worldTime to 86400 and silently drop the
// stored hour. Tuple equality is what keeps the remainder.
export const CoarseCalendarKeepsRemainder: StoryT = {
  ...wrap,
  args: {
    ...baseArgs,
    calendar: DAY_GRAIN_CALENDAR,
    worldTimeOrigin: DAY_GRAIN_ORIGIN,
    worldTimeRaw: DAY_PLUS_HOUR,
  },
  play: async ({ args }) => {
    await expect(screen.getByLabelText('Day')).toHaveValue('2')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(args.onCancel).toHaveBeenCalled()
  },
}

// worldTime 0 sits exactly on the origin, which is a legal time — the guard
// rejects times before the story start, not the start itself.
export const AtOriginIsAllowed: StoryT = {
  ...wrap,
  args: { ...baseArgs, worldTimeRaw: 0 },
  play: async () => {
    await expect(screen.getByLabelText('Second')).toHaveValue('0')
    await expect(
      screen.queryByText('Time cannot be before the story start.'),
    ).not.toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  },
}

// Cancel discards. The two buttons sit side by side and differ only in handler,
// so a miswiring that commits the edit would otherwise look identical.
export const CancelDiscardsEdit: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const second = screen.getByLabelText('Second')
    await userEvent.clear(second)
    await userEvent.type(second, '0')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(args.onCancel).toHaveBeenCalled()
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

// The conversion's cost is linear in the top tier, so an unbounded year turns a
// typo into a multi-minute freeze of the whole renderer. The cap has to block
// before the walk, which is also why this story runs fast.
export const AbsurdYearBlocked: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const year = screen.getByLabelText('Year')
    await userEvent.clear(year)
    await userEvent.type(year, '20240101')
    await expect(year).toHaveValue('20240101')

    await expect(screen.getByText('That time is too far from the current value.')).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

export const BelowOriginBlocked: StoryT = {
  ...wrap,
  args: { ...baseArgs },
  play: async ({ args }) => {
    const year = screen.getByLabelText('Year')
    await userEvent.clear(year)
    await userEvent.type(year, '2023')

    await expect(screen.getByText('Time cannot be before the story start.')).toBeVisible()
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
    const year = screen.getByLabelText('Year')
    await userEvent.clear(year)
    await expect(year).toHaveValue('')

    await expect(
      screen.queryByText('Time cannot be before the story start.'),
    ).not.toBeInTheDocument()
    await expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}
