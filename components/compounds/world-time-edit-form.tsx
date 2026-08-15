import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { TierTupleInput } from '@/components/wizard/tier-tuple-input'
import { validateOriginTuple } from '@/components/wizard/tier-tuple-input-logic'
import {
  tupleToWorldTime,
  worldTimeToTuple,
  type CalendarSystem,
  type TierTuple,
} from '@/lib/calendar'

type WorldTimeEditFormProps = {
  /** Stable reference required: the tuple→seconds memo keys on identity. */
  calendar: CalendarSystem
  /** Stable reference required: the tuple→seconds memo keys on identity. */
  worldTimeOrigin: TierTuple
  /**
   * Raw cumulative seconds. Seeds the tier tuple on mount only — a later change
   * does not reseed, so hosts must mount the form fresh per open.
   */
  worldTimeRaw: number
  monotonicityBreak?: { previousLabel: string }
  /** Fired with the recomputed cumulative seconds; never fired on a no-change save. */
  onSave: (next: number) => void
  /** Close the overlay. Also fires in place of `onSave` on a no-change save. */
  onCancel: () => void
}

const BELOW_ORIGIN_MESSAGE = 'Time cannot be before the story start.'
const TOO_FAR_MESSAGE = 'That time is too far from the current value.'

// A conversion walks the top tier one unit at a time from where the seed left
// off — measured ~11ms per 2000 Gregorian years, ~20ms per 4000. Capped near a
// frame: uncapped, a mistyped `20240101` blocks the UI thread for minutes.
const MAX_TOP_TIER_SPAN = 2000

function tuplesEqual(a: TierTuple, b: TierTuple, calendar: CalendarSystem): boolean {
  return calendar.tiers.every((tier) => a[tier.name] === b[tier.name])
}

export function WorldTimeEditForm({
  calendar,
  worldTimeOrigin,
  worldTimeRaw,
  monotonicityBreak,
  onSave,
  onCancel,
}: WorldTimeEditFormProps) {
  const seedTuple = useMemo(
    () => worldTimeToTuple(worldTimeRaw, calendar, worldTimeOrigin),
    [worldTimeRaw, calendar, worldTimeOrigin],
  )
  const [tuple, setTuple] = useState<TierTuple>(seedTuple)

  // Two independent gates run before the conversion: validity keeps a cleared
  // (NaN) or out-of-range tier out of a function that does not bounds-check,
  // and the span cap keeps the walk itself inside a frame.
  const { validity, next, tooFar } = useMemo(() => {
    const result = validateOriginTuple(tuple, calendar)
    if (!result.ok) return { validity: result, next: null, tooFar: false }

    // Span is measured from the seed rather than the origin: the seed's own
    // conversion already ran at mount, so it is the cached point the next walk
    // starts from, and an entry legitimately far past the origin stays editable.
    const topTier = calendar.tiers[0].name
    if (tuple[topTier] - seedTuple[topTier] > MAX_TOP_TIER_SPAN) {
      return { validity: result, next: null, tooFar: true }
    }
    return {
      validity: result,
      next: tupleToWorldTime(tuple, calendar, worldTimeOrigin),
      tooFar: false,
    }
  }, [tuple, calendar, worldTimeOrigin, seedTuple])

  const belowOrigin = next != null && next < 0
  const blockReason = !validity.ok
    ? `Enter a valid ${validity.tier} between ${validity.min} and ${validity.max}.`
    : tooFar
      ? TOO_FAR_MESSAGE
      : belowOrigin
        ? BELOW_ORIGIN_MESSAGE
        : undefined

  const handleSave = () => {
    if (next == null || belowOrigin) return
    // Tuple-level equality, not seconds-level: on a coarse-grain calendar the
    // tuple cannot express a sub-base-unit remainder, so an untouched save
    // compared in seconds would silently truncate the stored worldTime.
    if (tuplesEqual(tuple, seedTuple, calendar)) {
      onCancel()
      return
    }
    onSave(next)
  }

  return (
    <View className="gap-3">
      {monotonicityBreak != null ? (
        <View
          accessibilityRole="alert"
          className="rounded-md border border-warning bg-bg-sunken p-2"
        >
          <Text size="xs" className="text-warning">
            ⚠ Earlier than previous entry ({monotonicityBreak.previousLabel})
          </Text>
        </View>
      ) : null}
      <TierTupleInput calendar={calendar} value={tuple} onChange={setTuple} />
      {tooFar || belowOrigin ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Text size="xs" className="text-danger">
            {tooFar ? TOO_FAR_MESSAGE : BELOW_ORIGIN_MESSAGE}
          </Text>
        </View>
      ) : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={handleSave}
          disabled={blockReason != null}
          disabledReason={blockReason}
        >
          <Text>Save</Text>
        </Button>
      </View>
    </View>
  )
}

export type { WorldTimeEditFormProps }
