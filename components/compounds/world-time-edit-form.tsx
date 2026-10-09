import { useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { TierTupleInput } from '@/components/wizard/tier-tuple-input'
import { validateOriginTuple } from '@/components/wizard/tier-tuple-input-logic'
import type { EditDraft, EditFormHandle } from '@/hooks/use-edit-overlay-guard'
import {
  tupleToWorldTime,
  worldTimeToTuple,
  type CalendarFrame,
  type CalendarSystem,
  type TierTuple,
} from '@/lib/calendar'
import { t } from '@/lib/i18n'

/** Presence renders the warning; the label names the predecessor entry. */
export type MonotonicityBreak = { previousLabel: string }

type WorldTimeEditFormProps = {
  /** Stable reference required: the tuple→seconds memo keys on identity. */
  frame: CalendarFrame
  /**
   * Raw cumulative seconds. Seeds the tier tuple on mount only — a later change
   * does not reseed, so hosts must mount the form fresh per open.
   */
  worldTimeRaw: number
  monotonicityBreak?: MonotonicityBreak
  saving?: boolean
  saveError?: string
  /** Fired with the recomputed cumulative seconds; never fired on a no-change save. */
  onSave: (next: number) => void
  /** Close the overlay. Also fires in place of `onSave` on a no-change save. */
  onCancel: () => void
  /**
   * Dirty: the tuple differs from the opening one. Invalid: why Save is blocked. Fires on mount
   * and on every change.
   */
  onDraftChange?: (draft: EditDraft) => void
  ref?: Ref<EditFormHandle>
}

// The conversion walks the top tier, and only units past the seed are uncached
// work: ~11ms per 2000 years. Uncapped, a mistyped `20240101` blocks the UI
// thread for minutes.
const MAX_TOP_TIER_SPAN = 2000

function tuplesEqual(a: TierTuple, b: TierTuple, calendar: CalendarSystem): boolean {
  return calendar.tiers.every((tier) => a[tier.name] === b[tier.name])
}

export function WorldTimeEditForm({
  frame,
  worldTimeRaw,
  monotonicityBreak,
  saving = false,
  saveError,
  onSave,
  onCancel,
  onDraftChange,
  ref,
}: WorldTimeEditFormProps) {
  const { calendar, origin } = frame
  const seedTuple = useMemo(
    () => worldTimeToTuple(worldTimeRaw, calendar, origin),
    [worldTimeRaw, calendar, origin],
  )
  const [tuple, setTuple] = useState<TierTuple>(seedTuple)
  // Tuple-level, not seconds: a coarse calendar's tuple can't hold a sub-base-unit
  // remainder, so an untouched save compared in seconds would truncate worldTime.
  const dirty = !tuplesEqual(tuple, seedTuple, calendar)

  // Two independent gates run before the conversion: validity keeps a cleared
  // (NaN) or out-of-range tier out of a function that does not bounds-check,
  // and the span cap keeps the walk itself inside a frame. A tier error names
  // the offending field, so it stays out of the inline range alert.
  const { next, tierError, rangeError } = useMemo(() => {
    const validity = validateOriginTuple(tuple, calendar)
    if (!validity.ok) {
      return {
        next: null,
        tierError: t('reader:worldTimeEdit.invalidTier', {
          tier: validity.tier,
          min: validity.min,
          max: validity.max,
        }),
        rangeError: null,
      }
    }

    // Measured from the seed, not the origin: the mount conversion already
    // cached every top-tier unit below the seed, so those are Map hits and an
    // entry legitimately far past the origin stays editable. One-sided on
    // purpose — a value below the seed is entirely cached, hence cheap.
    const topTier = calendar.tiers[0].name
    if (tuple[topTier] - seedTuple[topTier] >= MAX_TOP_TIER_SPAN) {
      return { next: null, tierError: null, rangeError: t('reader:worldTimeEdit.tooFar') }
    }

    const seconds = tupleToWorldTime(tuple, calendar, origin)
    return {
      next: seconds,
      tierError: null,
      rangeError: seconds < 0 ? t('reader:worldTimeEdit.belowOrigin') : null,
    }
  }, [tuple, calendar, origin, seedTuple])

  const blockReason = tierError ?? rangeError ?? undefined
  useEffect(() => {
    onDraftChange?.({ dirty, invalidReason: blockReason })
  }, [dirty, blockReason, onDraftChange])

  const handleSave = () => {
    // Redundant behind the disabled Save; kept because `next` needs the narrowing.
    if (blockReason != null || next == null) return
    if (!dirty) {
      onCancel()
      return
    }
    onSave(next)
  }
  useImperativeHandle(ref, () => ({ save: handleSave }))

  return (
    <View className="gap-3">
      {monotonicityBreak != null ? (
        <View
          accessibilityRole="alert"
          className="rounded-md border border-warning bg-bg-sunken p-2"
        >
          <Text size="xs" className="text-warning">
            {`⚠ ${t('reader:worldTimeEdit.monotonicityBreak', {
              previousLabel: monotonicityBreak.previousLabel,
            })}`}
          </Text>
        </View>
      ) : null}
      <TierTupleInput calendar={calendar} value={tuple} onChange={setTuple} disabled={saving} />
      {rangeError != null ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Text size="xs" className="text-danger">
            {rangeError}
          </Text>
        </View>
      ) : null}
      {saveError != null ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Text size="xs" className="text-danger">
            {saveError}
          </Text>
        </View>
      ) : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onCancel} disabled={saving}>
          <Text>{t('cancel')}</Text>
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={handleSave}
          disabled={blockReason != null}
          loading={saving}
          disabledReason={blockReason}
        >
          <Text>{t('save')}</Text>
        </Button>
      </View>
    </View>
  )
}

export type { WorldTimeEditFormProps }
