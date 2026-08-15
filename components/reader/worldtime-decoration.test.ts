import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN, type CalendarSystem } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'

import { decorateWorldTime } from './worldtime-decoration'

const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

let position = 0
function entry(kind: StoryEntry['kind'], worldTime: number | null): StoryEntry {
  position += 1
  return {
    id: `e${position}`,
    branchId: 'b1',
    position,
    kind,
    content: 'x',
    chapterId: null,
    createdAt: 1,
    metadata: worldTime == null ? null : { sceneEntities: [], currentLocationId: null, worldTime },
  }
}

describe('decorateWorldTime', () => {
  it('labels editable kinds; leaves system and metadata-less rows undecorated', () => {
    const rows = [
      entry('opening', 0),
      entry('system', null),
      entry('ai_reply', null),
      entry('ai_reply', 60),
    ]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[rows[0].id]?.label).toBeTruthy()
    expect(out[rows[0].id]?.raw).toBe(0)
    expect(out[rows[1].id]).toBeUndefined()
    expect(out[rows[2].id]).toBeUndefined()
    expect(out[rows[3].id]?.raw).toBe(60)
  })

  it('does not flag an in-order or equal-value sequence; user_action rows are decorated', () => {
    const rows = [
      entry('opening', 0),
      entry('ai_reply', 60),
      entry('user_action', 60),
      entry('ai_reply', 120),
    ]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(Object.values(out).every((d) => d.previousLabel == null)).toBe(true)
    expect(out[rows[2].id]?.raw).toBe(60)
  })

  it('flags an out-of-order entry and names the predecessor label', () => {
    const rows = [entry('ai_reply', 120), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[rows[1].id]?.previousLabel).toBe(out[rows[0].id]?.label)
  })

  it('skips worldTime=0 flashbacks as subjects and as ancestors', () => {
    const rows = [entry('ai_reply', 120), entry('ai_reply', 0), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[rows[1].id]?.previousLabel).toBeUndefined()
    // compares against 120 (the zero is skipped), so 60 IS flagged
    expect(out[rows[2].id]?.previousLabel).toBe(out[rows[0].id]?.label)
  })

  it('never flags the head of the window', () => {
    const rows = [entry('ai_reply', 5)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[rows[0].id]?.previousLabel).toBeUndefined()
  })

  it('system entries are undecorated and do not participate as ancestors', () => {
    // worldTime > 0 (not the flashback 0 already covered above) so this
    // isolates the kind gate from the worldTime>0 ancestry guard.
    const rows = [entry('ai_reply', 120), entry('system', 60), entry('ai_reply', 90)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[rows[1].id]).toBeUndefined()
    // 90 compares against 120 (the system row is skipped), not against 60.
    expect(out[rows[2].id]?.previousLabel).toBe(out[rows[0].id]?.label)
  })

  it('a formatter miss produces no decoration', () => {
    const brokenCalendar: CalendarSystem = { ...EARTH_GREGORIAN, displayFormat: '{{ unclosed' }
    const rows = [entry('ai_reply', 120), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, brokenCalendar, ORIGIN)
    expect(out[rows[0].id]).toBeUndefined()
    expect(out[rows[1].id]).toBeUndefined()
  })

  it('treats an empty rendered label as a miss', () => {
    const blankCalendar: CalendarSystem = { ...EARTH_GREGORIAN, displayFormat: '' }
    const rows = [entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, blankCalendar, ORIGIN)
    expect(out[rows[0].id]).toBeUndefined()
  })

  it('compares against the most recent decorated entry, not a high-water mark', () => {
    const rows = [entry('ai_reply', 120), entry('ai_reply', 60), entry('ai_reply', 90)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    // 60 is flagged against 120; 90 then compares against 60 (the most
    // recent ancestor, not the 120 high-water mark) and is clean.
    expect(out[rows[1].id]?.previousLabel).toBe(out[rows[0].id]?.label)
    expect(out[rows[2].id]?.previousLabel).toBeUndefined()
  })

  it('is pure: repeat calls agree and the input is untouched', () => {
    const rows = [entry('ai_reply', 120), entry('ai_reply', 60)]
    const snapshot = JSON.parse(JSON.stringify(rows))
    const first = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    const second = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(second).toEqual(first)
    expect(rows).toEqual(snapshot)
  })
})
