import { Info } from 'lucide-react-native'
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import {
  CalendarPicker,
  type CalendarOption,
  type CalendarSummaryData,
} from '@/components/compounds/calendar-picker'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import {
  DEFAULT_CALENDAR_ID,
  listCalendars,
  type CalendarSystem,
  type EraDeclaration,
  type TierTuple,
} from '@/lib/calendar'
import { t } from '@/lib/i18n'
import { appSettingsStore, wizardStore } from '@/lib/stores'

import {
  buildCalendarSummary,
  buildTierPath,
  computeSampleRender,
  preserveOriginOnSwap,
  type CalendarStepSummary,
  type ErasSummary,
  type SubdivisionsSummary,
  type TierDetail,
} from './step-calendar-logic'
import { TierTupleInput } from './tier-tuple-input'

// Tier names are calendar-authored content, not app chrome — a naive plural
// is a display nicety here, same call tier-tuple-input.tsx makes for casing.
function pluralize(name: string): string {
  return name.endsWith('s') ? name : `${name}s`
}

function detailText(detail: TierDetail): string {
  switch (detail.kind) {
    case 'constant':
      return t('wizard:calendarStep.summary.detail.constant', {
        value: detail.value,
        unit: pluralize(detail.unitTierName),
      })
    case 'table':
      return t('wizard:calendarStep.summary.detail.table', {
        min: detail.min,
        max: detail.max,
        unit: pluralize(detail.unitTierName),
      })
    case 'rule':
      return t('wizard:calendarStep.summary.detail.rule', { against: detail.against })
    case 'base-unit':
      return t('wizard:calendarStep.summary.detail.baseUnit')
  }
}

function subdivisionsText(subdivisions: SubdivisionsSummary): string {
  if (subdivisions.kind === 'none') return t('wizard:calendarStep.summary.subdivisions.none')
  return t('wizard:calendarStep.summary.subdivisions.weekday', {
    name: subdivisions.subdivisionName,
    first: subdivisions.first,
    last: subdivisions.last,
    length: subdivisions.length,
    unit: subdivisions.hostTierName,
  })
}

function erasText(eras: ErasSummary): string {
  if (eras.kind === 'disabled') return t('wizard:calendarStep.summary.eras.disabled')
  if (eras.kind === 'freeform') return t('wizard:calendarStep.summary.eras.freeform')
  return t('wizard:calendarStep.summary.eras.preset', { names: eras.names.join(', ') })
}

function toSummaryData(
  built: CalendarStepSummary,
  sampleRender: string | null,
): CalendarSummaryData {
  return {
    tiers: built.tiers.map((tier) => ({ name: tier.name, detail: detailText(tier.detail) })),
    subdivisions: subdivisionsText(built.subdivisions),
    eras: erasText(built.eras),
    ...(sampleRender != null
      ? { sampleRender }
      : { sampleLabel: t('wizard:calendarStep.summary.placeholderLabel') }),
  }
}

// Thin branch point only — the full era-picker widget (era dropdown, flip
// preview) is scoped to M8.3. Dormant in M2: earth-gregorian, the only
// built-in calendar, always has eras: null.
function EraStub({ eras: _eras }: { eras: EraDeclaration }) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-fg-primary">
        {t('wizard:calendarStep.era.label')}
      </Text>
      <Text size="sm" variant="muted">
        {t('wizard:calendarStep.era.comingSoon')}
      </Text>
    </View>
  )
}

function OriginResetNotice() {
  return (
    <View
      role="status"
      aria-live="polite"
      className="flex-row items-start gap-2 rounded-r-md border-l-4 border-l-border-strong bg-bg-sunken px-3 py-2.5"
    >
      <Icon as={Info} size="sm" className="mt-0.5 shrink-0 text-fg-muted" />
      <Text size="sm" className="flex-1 text-fg-primary">
        {t('wizard:calendarStep.originResetNotice')}
      </Text>
    </View>
  )
}

type StepCalendarProps = {
  /**
   * Calendar registry to choose from. Defaults to the app's built-in
   * registry. Injectable so tests can drive a multi-calendar swap.
   */
  calendars?: readonly CalendarSystem[]
}

export function StepCalendar({ calendars = listCalendars() }: StepCalendarProps = {}) {
  const calendarSystemId = wizardStore.useWizard((s) => s.state.definition.calendarSystemId)
  const storedOrigin = wizardStore.useWizard((s) => s.state.definition.worldTimeOrigin)
  const [showResetNotice, setShowResetNotice] = useState(false)

  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars])

  const appDefaultId = appSettingsStore.getAppSettings().defaultCalendarId ?? DEFAULT_CALENDAR_ID
  const appDefaultCalendar = byId.get(appDefaultId) ?? byId.get(DEFAULT_CALENDAR_ID) ?? calendars[0]

  const isSeeded = Object.keys(storedOrigin).length > 0
  const selectedCalendar: CalendarSystem = isSeeded
    ? (byId.get(calendarSystemId) ?? appDefaultCalendar)
    : appDefaultCalendar
  const origin: TierTuple = isSeeded ? storedOrigin : selectedCalendar.exampleStartValue

  useEffect(() => {
    if (isSeeded) return
    wizardStore.patchDefinition({
      calendarSystemId: selectedCalendar.id,
      worldTimeOrigin: { ...selectedCalendar.exampleStartValue },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeeded])

  const options: CalendarOption[] = useMemo(
    () =>
      calendars.map((c) => ({
        id: c.id,
        name: c.name,
        type: 'built-in' as const,
        tierPath: buildTierPath(c),
      })),
    [calendars],
  )

  const summary = useMemo(() => {
    const built = buildCalendarSummary(selectedCalendar)
    const sampleRender = computeSampleRender(selectedCalendar, origin)
    return toSummaryData(built, sampleRender)
  }, [selectedCalendar, origin])

  const handleSelect = (id: string) => {
    if (id === selectedCalendar.id) return
    const target = byId.get(id)
    if (!target) return
    const result = preserveOriginOnSwap(origin, target)
    wizardStore.patchDefinition({ calendarSystemId: target.id, worldTimeOrigin: result.origin })
    setShowResetNotice(result.reset)
  }

  const handleOriginChange = (next: TierTuple) => {
    wizardStore.patchDefinition({ worldTimeOrigin: next })
  }

  return (
    <View className="gap-6">
      <Heading level={1}>{t('wizard:calendarStep.heading')}</Heading>
      <Text variant="muted">{t('wizard:calendarStep.intro')}</Text>

      <View className="gap-2">
        <Heading level={2}>{t('wizard:calendarStep.system.label')}</Heading>
        <Text size="sm" variant="muted">
          {t('wizard:calendarStep.system.copy')}
        </Text>
        <CalendarPicker
          options={options}
          selectedId={selectedCalendar.id}
          onSelect={handleSelect}
          summary={summary}
          showVaultTail={false}
          showEditAction={false}
          layout="side-by-side"
        />
        {showResetNotice ? <OriginResetNotice /> : null}
      </View>

      <View className="gap-2">
        <Heading level={2}>{t('wizard:calendarStep.origin.label')}</Heading>
        <Text size="sm" variant="muted">
          {t('wizard:calendarStep.origin.copy')}
        </Text>
        {/* Key by calendar id so a swap remounts the input, clearing its
            name-keyed `touched` state (tier names collide across calendars). */}
        <TierTupleInput
          key={selectedCalendar.id}
          calendar={selectedCalendar}
          value={origin}
          onChange={handleOriginChange}
        />
      </View>

      {selectedCalendar.eras !== null ? <EraStub eras={selectedCalendar.eras} /> : null}
    </View>
  )
}

export type { StepCalendarProps }
