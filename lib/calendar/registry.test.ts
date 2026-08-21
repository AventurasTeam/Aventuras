import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'

import { EARTH_GREGORIAN } from './builtins/earth-gregorian'
import { DEFAULT_CALENDAR_ID, getCalendar, listCalendars, resolveCalendar } from './registry'

describe('calendar registry', () => {
  it('resolves the earth-gregorian built-in by id', () => {
    expect(getCalendar('earth-gregorian')?.id).toBe('earth-gregorian')
  })
  it('returns undefined for unknown ids (no vault merge in M2)', () => {
    expect(getCalendar('nonexistent')).toBeUndefined()
  })
  it('lists the built-ins', () => {
    expect(listCalendars().map((c) => c.id)).toContain('earth-gregorian')
  })
  it('falls back to the default calendar for an unknown id', () => {
    expect(resolveCalendar('nonexistent').id).toBe(DEFAULT_CALENDAR_ID)
  })

  // Hardcoded, not read off EARTH_GREGORIAN: the point is that the constant and
  // the builtin agree, which deriving it from either would assume.
  it('names the builtin it actually falls back to', () => {
    expect(DEFAULT_CALENDAR_ID).toBe('earth-gregorian')
    expect(resolveCalendar('nonexistent')).toBe(EARTH_GREGORIAN)
  })
})

describe('unknown-calendar reporting', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // The fallback is otherwise silent, and calendarVocabulary is required on the
  // prompt path — an unresolved id feeds the model Gregorian months and eras.
  it('reports an unknown id once per id, not once per call', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    // Fresh id per run: the dedupe set is module-scoped and outlives the test,
    // so a fixed id would be already-warned on the second execution.
    const id = `nonexistent_${Math.random().toString(36).slice(2)}`

    resolveCalendar(id)
    resolveCalendar(id)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('calendar.unknown_id', {
      id,
      fallback: DEFAULT_CALENDAR_ID,
    })
  })

  it('says nothing when the id resolves', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    resolveCalendar('earth-gregorian')
    expect(warn).not.toHaveBeenCalled()
  })
})
