import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import type { CalendarSystem } from './calendar-schema'
import { describeCalendarVocabulary } from './vocabulary'

describe('describeCalendarVocabulary', () => {
  it('describes EARTH_GREGORIAN calendar vocabulary correctly', () => {
    const vocab = describeCalendarVocabulary(EARTH_GREGORIAN)

    expect(vocab.baseUnitName).toBe('second')
    expect(vocab.secondsPerBaseUnit).toBe(1)
    expect(vocab.eraDefaultName).toBeNull()
    expect(vocab.eraPresetNames).toEqual([])

    expect(vocab.tiers).toHaveLength(6)
    expect(vocab.tiers[0]).toEqual({ name: 'year', labels: [] })
    expect(vocab.tiers[1]).toEqual({
      name: 'month',
      labels: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ],
    })
  })

  it('describes a custom calendar with eras', () => {
    const customCalendar: CalendarSystem = {
      id: 'custom-fantasy',
      name: 'Fantasy Realm',
      baseUnitName: 'tick',
      secondsPerBaseUnit: 2,
      tiers: [
        {
          name: 'cycle',
          startValue: 1,
          rollover: { kind: 'constant', value: 100 },
          labels: ['Alpha', 'Beta'],
        },
      ],
      exampleStartValue: { cycle: 1 },
      displayFormat: '{{ cycle }}',
      eras: {
        flipMode: 'display-label',
        resetsOnFlip: ['cycle'],
        defaultStartName: 'Age of Magic',
        presetNames: ['Age of Magic', 'Age of Iron'],
      },
    }

    const vocab = describeCalendarVocabulary(customCalendar)

    expect(vocab.baseUnitName).toBe('tick')
    expect(vocab.secondsPerBaseUnit).toBe(2)
    expect(vocab.eraDefaultName).toBe('Age of Magic')
    expect(vocab.eraPresetNames).toEqual(['Age of Magic', 'Age of Iron'])
    expect(vocab.tiers).toEqual([{ name: 'cycle', labels: ['Alpha', 'Beta'] }])
  })
})
