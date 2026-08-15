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
  calendar: CalendarSystem
  worldTimeOrigin: TierTuple
  /** Raw cumulative seconds; seeds the tier tuple. */
  worldTimeRaw: number
  monotonicityBreak?: { previousLabel: string }
  /** Fired with the recomputed cumulative seconds; never fired on a no-change save. */
  onSave: (next: number) => void
  /** Close the overlay. Also fires in place of `onSave` on a no-change save. */
  onCancel: () => void
}

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

  // `tupleToWorldTime` walks the top tier one unit at a time, so its cost is
  // linear in the year — seconds of blocked UI thread for a mistyped one.
  // Memoized so only a tuple change pays it, and gated behind validity so a
  // cleared (NaN) or out-of-range tier never reaches it.
  const { validity, next } = useMemo(() => {
    const result = validateOriginTuple(tuple, calendar)
    return {
      validity: result,
      next: result.ok ? tupleToWorldTime(tuple, calendar, worldTimeOrigin) : null,
    }
  }, [tuple, calendar, worldTimeOrigin])

  const belowOrigin = next != null && next < 0

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
        <View className="rounded-md border border-warning bg-bg-sunken p-2">
          <Text size="xs" className="text-warning">
            ⚠ Earlier than previous entry ({monotonicityBreak.previousLabel})
          </Text>
        </View>
      ) : null}
      <TierTupleInput calendar={calendar} value={tuple} onChange={setTuple} />
      {belowOrigin ? (
        <Text size="xs" className="text-danger">
          Time cannot be before the story start.
        </Text>
      ) : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={handleSave}
          disabled={!validity.ok || belowOrigin}
        >
          <Text>Save</Text>
        </Button>
      </View>
    </View>
  )
}

export type { WorldTimeEditFormProps }
