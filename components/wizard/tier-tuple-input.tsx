import { useRef, useState } from 'react'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import type { CalendarSystem, Tier, TierTuple } from '@/lib/calendar'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { validateOriginTuple } from './tier-tuple-input-logic'

export type TierTupleInputProps = {
  calendar: CalendarSystem
  value: TierTuple
  onChange: (value: TierTuple) => void
  className?: string
}

// Tier names are calendar-authored content (e.g. Warhammer's "Millennium"),
// not app chrome — capitalizing is a display nicety, not a translation.
function tierLabel(name: string): string {
  return name.length === 0 ? name : name[0].toUpperCase() + name.slice(1)
}

function labelOptions(tier: Tier): SelectOption[] {
  return (tier.labels ?? []).map((label, i) => ({ value: String(tier.startValue + i), label }))
}

// A cleared numeric field is stored as NaN (not undefined — TierTuple is a
// plain number map) so validity checks catch it; display it as empty rather
// than the literal string "NaN", or a controlled re-render would make the
// field impossible to clear-and-retype.
function displayValue(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? '' : String(value)
}

export function TierTupleInput({ calendar, value, onChange, className }: TierTupleInputProps) {
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // `touched` is keyed by tier NAME, but names aren't unique across calendars
  // (Earth and Shire both have `day` with different day-in-month ranges). A
  // calendar swap preserves overlapping tier values (per wizard.md), so a
  // same-named tier can carry a value that was valid under the old calendar
  // and invalid under the new one — without this reset a stale `touched` flag
  // would flash the error with zero interaction on the new calendar. Reset at
  // render time (not in an effect, which fires a frame late) so the first
  // painted frame already reflects the new calendar. See "No harmless id
  // leaks" — prune name-keyed state when the identity space (calendar) changes.
  const lastCalendarId = useRef(calendar.id)
  if (lastCalendarId.current !== calendar.id) {
    lastCalendarId.current = calendar.id
    if (Object.keys(touched).length > 0) setTouched({})
  }

  const validity = validateOriginTuple(value, calendar)
  const invalidTier = validity.ok ? null : validity.tier
  const errorMessage = validity.ok
    ? undefined
    : t('wizard:calendarStep.originError', { min: validity.min, max: validity.max })

  const markTouched = (name: string) =>
    setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }))

  return (
    <View className={cn('flex-row flex-wrap items-start gap-3', className)}>
      {calendar.tiers.map((tier) => {
        const showError = touched[tier.name] && invalidTier === tier.name
        const currentValue = value[tier.name]
        const hasLabels = tier.labels != null && tier.labels.length > 0

        return (
          <View key={tier.name} className={hasLabels ? 'w-40' : 'w-24'}>
            <FormRow label={tierLabel(tier.name)} error={showError ? errorMessage : undefined}>
              {hasLabels ? (
                <Select
                  mode="dropdown"
                  options={labelOptions(tier)}
                  value={currentValue !== undefined ? String(currentValue) : undefined}
                  onValueChange={(v) => {
                    markTouched(tier.name)
                    onChange({ ...value, [tier.name]: Number(v) })
                  }}
                />
              ) : (
                <Input
                  keyboardType="numeric"
                  value={displayValue(currentValue)}
                  onChangeText={(text) => {
                    const parsed = text.trim() === '' ? Number.NaN : Number(text)
                    onChange({ ...value, [tier.name]: parsed })
                  }}
                  onBlur={() => markTouched(tier.name)}
                  aria-invalid={showError}
                  aria-label={tierLabel(tier.name)}
                />
              )}
            </FormRow>
          </View>
        )
      })}
    </View>
  )
}
