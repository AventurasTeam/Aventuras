import { describe, it } from 'vitest'

import { EARTH_GREGORIAN } from '@/lib/calendar/builtins/earth-gregorian'
import {
  __resetCache,
  tupleToBaseUnits,
  worldTimeToTuple,
} from '@/lib/calendar/world-time-to-tuple'

// Cost harness, not a test — it asserts nothing. Run with `pnpm bench:calendar`
// when a change touches the tier walk in `lib/calendar/world-time-to-tuple.ts`.
//
// Both conversions used to count top-tier units up from the calendar epoch, so
// both were O(year). The numbers this prints are the reason that mattered: a
// year field is free text in the wizard's origin picker and the reader's
// world-time edit overlay, so a stray digit was a synchronous UI freeze.

const YEARS = [2024, 20_245, 202_456, 2_024_561]
const READER_WINDOW = 50

function ms(fn: () => void): string {
  const t0 = performance.now()
  fn()
  return `${(performance.now() - t0).toFixed(2)} ms`
}

describe('calendar conversion cost', () => {
  it('prints the tier-walk cost profile', () => {
    const lines: string[] = []

    lines.push('tupleToBaseUnits — cold, one call per year value')
    for (const year of YEARS) {
      __resetCache()
      const tuple = { year, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
      lines.push(`  year ${year}: ${ms(() => void tupleToBaseUnits(EARTH_GREGORIAN, tuple))}`)
    }

    lines.push(`worldTimeToTuple — cold, ${READER_WINDOW}-row reader decoration walk`)
    for (const year of YEARS) {
      __resetCache()
      const origin = { year, month: 1, day: 1, hour: 0, minute: 0, second: 0 }
      lines.push(
        `  origin year ${year}: ${ms(() => {
          for (let k = 0; k < READER_WINDOW; k++) {
            worldTimeToTuple(k * 86_400, EARTH_GREGORIAN, origin)
          }
        })}`,
      )
    }

    // Typing a year digit by digit: every keystroke is a new tuple, so a call-site
    // memo misses every time. This is the sequence the freeze was reported against.
    lines.push('tupleToBaseUnits — typing "2024561" one digit at a time')
    __resetCache()
    lines.push(
      `  total: ${ms(() => {
        for (const year of [2, 20, 202, 2024, 20_245, 202_456, 2_024_561]) {
          tupleToBaseUnits(EARTH_GREGORIAN, {
            year,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
          })
        }
      })}`,
    )

    process.stdout.write(`\n${lines.join('\n')}\n\n`)
  })
})
