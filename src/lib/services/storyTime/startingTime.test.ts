import { describe, it, expect } from 'vitest'
import type { TimeTracker } from '$lib/types'
import {
  greetingStart,
  returnedStart,
  scenarioOpeningStart,
  startingTimePromptValue,
  templateReceivesStartingTime,
  SUGGEST_ONE,
} from './startingTime'

function t(hours: number, minutes = 0): TimeTracker {
  return { years: 0, days: 0, hours, minutes }
}

describe('startingTimePromptValue', () => {
  it('sends a given start in the story-time form, and asks for one otherwise', () => {
    expect(startingTimePromptValue(t(19, 30))).toBe('Y1 D1 19:30')
    expect(startingTimePromptValue(null)).toBe(SUGGEST_ONE)
    expect(startingTimePromptValue(undefined)).toBe(SUGGEST_ONE)
  })
})

describe('templateReceivesStartingTime', () => {
  it('tells a template that renders the start from one that does not', () => {
    expect(
      templateReceivesStartingTime(
        'TITLE: {{ title }}\nTIME: opening ends at {{ storyStartingTime }}',
      ),
    ).toBe(true)
    expect(templateReceivesStartingTime('TIME: opening ends at {{ startingTime }}')).toBe(false)
    expect(templateReceivesStartingTime('TITLE: {{ title }}')).toBe(false)
    expect(templateReceivesStartingTime(null)).toBe(false)
  })
})

describe('returnedStart', () => {
  it('takes the time the model returned, normalized', () => {
    expect(returnedStart('Y1 D400 10:00', t(8))).toEqual({
      text: 'Y2 D35 10:00',
      source: 'returned',
    })
  })

  it('falls back to the guidance when the model returned nothing readable', () => {
    expect(returnedStart(undefined, t(19, 30))).toEqual({ text: 'Y1 D1 19:30', source: 'guidance' })
    expect(returnedStart('sometime at dusk', t(19, 30))).toEqual({
      text: 'Y1 D1 19:30',
      source: 'guidance',
    })
  })

  it('leaves the start empty when neither is there', () => {
    expect(returnedStart('', null)).toEqual({ text: '', source: null })
  })
})

describe('greetingStart', () => {
  it('gives the first greeting the scenario’s start', () => {
    expect(greetingStart(0, t(19))).toBe('Y1 D1 19:00')
  })

  it('leaves an alternate greeting without one', () => {
    expect(greetingStart(2, t(19))).toBe('')
  })

  it('leaves every greeting empty when the scenario states none', () => {
    expect(greetingStart(0, null)).toBe('')
    expect(greetingStart(1, null)).toBe('')
  })
})

describe('scenarioOpeningStart', () => {
  it('takes the scenario’s start when it has a first message for it to belong to', () => {
    expect(
      scenarioOpeningStart({ firstMessage: 'Rain on the docks.', startingTime: t(23) }),
    ).toEqual(t(23))
  })

  it('drops the start of a scenario with no first message', () => {
    expect(scenarioOpeningStart({ firstMessage: '', startingTime: t(23) })).toBeNull()
    expect(scenarioOpeningStart({ startingTime: t(23) })).toBeNull()
  })

  it('is empty when the scenario states no start', () => {
    expect(scenarioOpeningStart({ firstMessage: 'Rain on the docks.' })).toBeNull()
  })
})
