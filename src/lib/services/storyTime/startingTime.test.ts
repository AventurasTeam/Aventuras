import { describe, it, expect } from 'vitest'
import type { TimeTracker } from '$lib/types'
import { startingTimePromptValue, templateReceivesStartingTime, SUGGEST_ONE } from './startingTime'

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
    expect(templateReceivesStartingTime('TITLE: {{ title }}\nSTARTS AT: {{ startingTime }}')).toBe(
      true,
    )
    expect(templateReceivesStartingTime('TITLE: {{ title }}')).toBe(false)
    expect(templateReceivesStartingTime(null)).toBe(false)
  })
})
