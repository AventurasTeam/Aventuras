import * as React from 'react'
import { ScrollView, View } from 'react-native'

import {
  CalendarPicker,
  type CalendarOption,
  type CalendarSummaryData,
} from '@/components/compounds/calendar-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

const OPTIONS: readonly CalendarOption[] = [
  {
    id: 'cal_earth',
    name: 'Earth (Gregorian)',
    type: 'built-in',
    tierPath: 'year → month → day → hour → minute → second',
  },
  {
    id: 'cal_shire',
    name: 'Shire Reckoning (my variant)',
    type: 'custom',
    tierPath: 'year → month → day',
  },
  { id: 'cal_stardate', name: 'Stardate', type: 'built-in', tierPath: 'count' },
  {
    id: 'cal_wh40k',
    name: 'Warhammer 40K Imperial',
    type: 'built-in',
    tierPath: 'millennium → fractional-year',
  },
  {
    id: 'cal_deep',
    name: 'Pathologically Deep',
    type: 'custom',
    tierPath:
      'epoch → era → millennium → century → decade → year → month → week → day → hour → minute → second',
  },
]

const SUMMARY_BY_ID: Record<string, CalendarSummaryData> = {
  cal_earth: {
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
  },
  cal_shire: {
    tiers: [
      { name: 'year', detail: 'rule: free-form' },
      { name: 'month', detail: 'table: 30 days × 12' },
      { name: 'day', detail: 'base unit' },
    ],
    subdivisions: 'weekday: Highday cycle (7-day)',
    eras: 'enabled (preset names: First Age, Second Age, Third Age)',
    sampleRender: '12 Astron, 1419',
  },
  cal_stardate: {
    tiers: [{ name: 'count', detail: 'base unit (decimal)' }],
    subdivisions: 'none',
    eras: 'disabled',
    sampleRender: '12345.6',
  },
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

export default function CalendarPickerDevRoute() {
  const [appSettingsId, setAppSettingsId] = React.useState('cal_earth')
  const [storyId, setStoryId] = React.useState('cal_shire')
  const [wizardId, setWizardId] = React.useState('cal_earth')
  const [eventLog, setEventLog] = React.useState<string[]>([])
  const [genInFlight, setGenInFlight] = React.useState(false)

  const log = React.useCallback((msg: string) => {
    setEventLog((prev) => [`${new Date().toLocaleTimeString()} · ${msg}`, ...prev].slice(0, 8))
  }, [])

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-10 p-4">
        <View className="gap-3">
          <Heading level={2}>App Settings — default calendar (stacked)</Heading>
          <Text size="sm" variant="muted">
            Default for new stories. Existing stories keep their current picks.
          </Text>
          <CalendarPicker
            options={OPTIONS}
            selectedId={appSettingsId}
            onSelect={(id) => {
              setAppSettingsId(id)
              log(`app-settings: selected ${id}`)
            }}
            summary={SUMMARY_BY_ID[appSettingsId] ?? SUMMARY_BY_ID.cal_earth}
            layout="stacked"
            onManageInVault={() => log('app-settings: manage-in-vault')}
            onEditInVault={() => log('app-settings: edit-in-vault')}
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Story Settings — Calendar tab (stacked)</Heading>
          <Text size="sm" variant="muted">
            Swap-warning AlertDialog (W1 / W2 / W3) is intentionally NOT inside this compound; the
            modal is a separate composition layer the host wraps around the swap path.
          </Text>
          <CalendarPicker
            options={OPTIONS}
            selectedId={storyId}
            onSelect={(id) => {
              setStoryId(id)
              log(`story-settings: selected ${id}`)
            }}
            summary={SUMMARY_BY_ID[storyId] ?? SUMMARY_BY_ID.cal_earth}
            layout="stacked"
            onManageInVault={() => log('story-settings: manage-in-vault')}
            onEditInVault={() => log('story-settings: edit-in-vault')}
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Wizard — Step 2 (side-by-side, no Vault tail)</Heading>
          <Text size="sm" variant="muted">
            Definitional weight via wrapper styling. Always-on adjacent summary is the radio-mode
            replacement.
          </Text>
          <CalendarPicker
            options={OPTIONS}
            selectedId={wizardId}
            onSelect={(id) => {
              setWizardId(id)
              log(`wizard: selected ${id}`)
            }}
            summary={SUMMARY_BY_ID[wizardId] ?? SUMMARY_BY_ID.cal_earth}
            layout="side-by-side"
            showVaultTail={false}
          />
        </View>

        <View className="gap-3">
          <Heading level={2}>Edit-restrictions gate</Heading>
          <View className="flex-row items-center gap-3">
            <Button
              variant={genInFlight ? 'primary' : 'secondary'}
              size="sm"
              onPress={() => setGenInFlight((g) => !g)}
            >
              <Text>{genInFlight ? 'Generation IN flight' : 'Start mock generation'}</Text>
            </Button>
            <Text size="xs" variant="muted">
              Toggle to gate the picker + Edit action with a tooltip.
            </Text>
          </View>
          <CalendarPicker
            options={OPTIONS}
            selectedId={appSettingsId}
            onSelect={setAppSettingsId}
            summary={SUMMARY_BY_ID[appSettingsId] ?? SUMMARY_BY_ID.cal_earth}
            disabled={genInFlight}
            disabledReason="Generation is in flight. Cancel to edit."
            onManageInVault={() => log('gated: manage-in-vault')}
            onEditInVault={() => log('gated: edit-in-vault')}
          />
        </View>

        {eventLog.length > 0 ? (
          <View className="gap-2">
            <Heading level={3}>Event log</Heading>
            <View className="rounded-md border border-border bg-bg-sunken p-3">
              {eventLog.map((line) => (
                <Text key={line} size="xs" variant="muted" className="font-mono">
                  {line}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}
