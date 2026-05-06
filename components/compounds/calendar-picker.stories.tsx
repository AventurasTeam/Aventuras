import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

import { CalendarPicker, type CalendarOption, type CalendarSummaryData } from './calendar-picker'

const EARTH: CalendarOption = {
  id: 'cal_earth',
  name: 'Earth (Gregorian)',
  type: 'built-in',
  tierPath: 'year → month → day → hour → minute → second',
}
const SHIRE: CalendarOption = {
  id: 'cal_shire',
  name: 'Shire Reckoning (my variant)',
  type: 'custom',
  tierPath: 'year → month → day',
}
const STARDATE: CalendarOption = {
  id: 'cal_stardate',
  name: 'Stardate',
  type: 'built-in',
  tierPath: 'count',
}
const WH40K: CalendarOption = {
  id: 'cal_wh40k',
  name: 'Warhammer 40K Imperial',
  type: 'built-in',
  tierPath: 'millennium → fractional-year',
}
const DEEP: CalendarOption = {
  id: 'cal_deep',
  name: 'Pathologically Deep',
  type: 'custom',
  tierPath:
    'epoch → era → millennium → century → decade → year → month → week → day → hour → minute → second',
}

const ALL_OPTIONS = [EARTH, SHIRE, STARDATE, WH40K, DEEP] as const

const EARTH_SUMMARY: CalendarSummaryData = {
  tiers: [
    { name: 'year', detail: 'rule: Gregorian leap' },
    { name: 'month', detail: 'table: 28–31 days' },
    { name: 'day', detail: 'constant: 24 hours' },
    { name: 'hour', detail: 'constant: 60 minutes' },
    { name: 'minute', detail: 'constant: 60 seconds' },
    { name: 'second', detail: 'base unit' },
  ],
  subdivisions: 'weekday: Sun–Sat (7-day cycle)',
  eras: 'enabled (preset names: BCE, CE)',
  sampleRender: 'April 28, 2026',
}

const SHIRE_SUMMARY: CalendarSummaryData = {
  tiers: [
    { name: 'year', detail: 'rule: free-form' },
    { name: 'month', detail: 'table: 30 days × 12' },
    { name: 'day', detail: 'base unit' },
  ],
  subdivisions: 'weekday: Highday cycle (7-day)',
  eras: 'enabled (preset names: First Age, Second Age, Third Age)',
  sampleRender: '12 Astron, 1419',
}

const STARDATE_SUMMARY: CalendarSummaryData = {
  tiers: [{ name: 'count', detail: 'base unit (decimal)' }],
  subdivisions: 'none',
  eras: 'disabled',
  sampleRender: '12345.6',
}

const SUMMARY_BY_ID: Record<string, CalendarSummaryData> = {
  cal_earth: EARTH_SUMMARY,
  cal_shire: SHIRE_SUMMARY,
  cal_stardate: STARDATE_SUMMARY,
  cal_wh40k: {
    tiers: [
      { name: 'millennium', detail: 'rule: count' },
      { name: 'fractional-year', detail: 'base unit (decimal)' },
    ],
    subdivisions: 'none',
    eras: 'disabled',
    sampleRender: 'M3 .046',
  },
  cal_deep: {
    tiers: [
      { name: 'epoch', detail: 'rule: free-form' },
      { name: 'era', detail: 'rule: era-table' },
      { name: 'millennium', detail: 'rule: count' },
      { name: 'century', detail: 'rule: count' },
      { name: 'decade', detail: 'rule: count' },
      { name: 'year', detail: 'table: 360–365 days' },
      { name: 'month', detail: 'table: 30 days' },
      { name: 'week', detail: 'constant: 6 days' },
      { name: 'day', detail: 'constant: 24 hours' },
      { name: 'hour', detail: 'constant: 60 minutes' },
      { name: 'minute', detail: 'constant: 60 seconds' },
      { name: 'second', detail: 'base unit' },
    ],
    subdivisions: 'weekday: Sixday cycle',
    eras: 'enabled (free-form)',
    sampleRender: 'I.I.M3.C0.D2 — 12 Lunar, 0042',
  },
}

function CalendarPickerHarness({
  initialId = EARTH.id,
  layout = 'stacked',
  showVaultTail = true,
  showEditAction = true,
  disabled,
  disabledReason,
}: {
  initialId?: string
  layout?: 'stacked' | 'side-by-side'
  showVaultTail?: boolean
  showEditAction?: boolean
  disabled?: boolean
  disabledReason?: string
}) {
  const [selectedId, setSelectedId] = React.useState(initialId)
  const summary = SUMMARY_BY_ID[selectedId] ?? EARTH_SUMMARY
  return (
    <View className="p-4" style={{ width: 720 }}>
      <CalendarPicker
        options={ALL_OPTIONS}
        selectedId={selectedId}
        onSelect={setSelectedId}
        summary={summary}
        layout={layout}
        showVaultTail={showVaultTail}
        showEditAction={showEditAction}
        onManageInVault={fn()}
        onEditInVault={fn()}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    </View>
  )
}

const meta: Meta<typeof CalendarPicker> = {
  title: 'Compounds/CalendarPicker',
  component: CalendarPicker,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof CalendarPicker>

/**
 * App Settings host shape — stacked layout, default-calendar
 * framing. Vault tail visible; Edit-in-Vault summary action wired.
 */
export const AppSettings: Story = {
  render: () => (
    <View className="gap-3 p-4">
      <Heading level={3}>Default calendar</Heading>
      <Text size="sm" variant="muted">
        Default for new stories. Existing stories keep their current picks.
      </Text>
      <CalendarPickerHarness layout="stacked" />
    </View>
  ),
}

/**
 * Story Settings host shape — same chrome, lives on a Calendar tab
 * in the Settings section. Swap-warning AlertDialog (W1 / W2 / W3)
 * is a separate composition layer, intentionally outside this
 * compound's scope.
 */
export const StorySettings: Story = {
  render: () => (
    <View className="gap-3 p-4">
      <Heading level={3}>Calendar</Heading>
      <Text size="sm" variant="muted">
        Active calendar for this story. Switching may need re-picking your story-start moment — a
        confirmation modal handles the swap.
      </Text>
      <CalendarPickerHarness layout="stacked" />
    </View>
  ),
}

/**
 * Wizard host shape — side-by-side layout, no Vault tail. The
 * always-on adjacent summary is the radio-mode replacement: user
 * sees full structural detail of their current pick as they click
 * options. `worldTimeOrigin` sister-control lives below the picker
 * on the host side; out of scope for this compound.
 */
export const Wizard: Story = {
  render: () => (
    <View className="gap-3 p-4">
      <Heading level={3}>Calendar system</Heading>
      <Text size="sm" variant="muted">
        Pick the calendar that frames your story&apos;s world-time. The structure of months, days,
        weeks, and eras is locked once entries start landing — choose deliberately.
      </Text>
      <CalendarPickerHarness layout="side-by-side" showVaultTail={false} />
    </View>
  ),
}

/**
 * Edit-restrictions gate — generation in flight. Picker trigger +
 * Edit action both disabled with a tooltip; the summary stays
 * visible (read-only inspection is allowed per the principle).
 */
export const DisabledByGeneration: Story = {
  render: () => (
    <CalendarPickerHarness disabled disabledReason="Generation is in flight. Cancel to edit." />
  ),
}

/**
 * Single-tier calendar (Stardate). Summary's tier list collapses
 * to one row; subdivisions & eras read `none` / `disabled`.
 */
export const SingleTierCalendar: Story = {
  render: () => <CalendarPickerHarness initialId={STARDATE.id} />,
}

/**
 * Pathologically deep calendar — 12 tiers. The row's tier-path
 * truncates with ellipsis; the summary recovers the full structure.
 */
export const DeepCalendar: Story = {
  render: () => <CalendarPickerHarness initialId={DEEP.id} />,
}

export const TriggerOpensPopover: Story = {
  render: () => <CalendarPickerHarness />,
  play: async () => {
    const trigger = screen.getByRole('button', { name: /Earth/ })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
  },
}

export const SelectingOptionUpdatesTrigger: Story = {
  render: () => <CalendarPickerHarness />,
  play: async () => {
    const trigger = screen.getByRole('button', { name: /Earth/ })
    await userEvent.click(trigger)
    const stardateRow = await screen.findByRole('option', { name: /Stardate/ })
    await userEvent.click(stardateRow)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Stardate/ })).toBeInTheDocument(),
    )
  },
}

export const VaultTailFires: Story = {
  args: {
    options: ALL_OPTIONS,
    selectedId: EARTH.id,
    onSelect: fn(),
    summary: EARTH_SUMMARY,
    onManageInVault: fn(),
  },
  render: (args) => (
    <View className="p-4" style={{ width: 720 }}>
      <CalendarPicker {...args} />
    </View>
  ),
  play: async ({ args }) => {
    const trigger = screen.getByRole('button', { name: /Earth/ })
    await userEvent.click(trigger)
    const tail = await screen.findByRole('link', { name: /Manage calendars in Vault/ })
    await userEvent.click(tail)
    await waitFor(() => expect(args.onManageInVault).toHaveBeenCalled())
  },
}
