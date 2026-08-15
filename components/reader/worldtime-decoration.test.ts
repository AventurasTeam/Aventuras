import { describe, expect, it } from 'vitest'

import { EARTH_GREGORIAN } from '@/lib/calendar'
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
  it('labels editable kinds and leaves system/metadata-less rows untouched', () => {
    const rows = [entry('opening', 0), entry('system', null), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[0].worldTimeLabel).toBeTruthy()
    expect(out[0].worldTimeRaw).toBe(0)
    expect(out[1].worldTimeLabel).toBeUndefined()
    expect(out[2].worldTimeRaw).toBe(60)
  })

  it('does not flag an in-order or equal-value sequence', () => {
    const rows = [
      entry('opening', 0),
      entry('ai_reply', 60),
      entry('user_action', 60),
      entry('ai_reply', 120),
    ]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out.every((r) => r.worldTimeMonotonicityBreak == null)).toBe(true)
  })

  it('flags an out-of-order entry and names the predecessor label', () => {
    const rows = [entry('ai_reply', 120), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[1].worldTimeMonotonicityBreak).toEqual({ previousLabel: out[0].worldTimeLabel })
  })

  it('skips worldTime=0 flashbacks as subjects and as ancestors', () => {
    const rows = [entry('ai_reply', 120), entry('ai_reply', 0), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[1].worldTimeMonotonicityBreak).toBeUndefined()
    // compares against 120 (the zero is skipped), so 60 IS flagged
    expect(out[2].worldTimeMonotonicityBreak).toEqual({ previousLabel: out[0].worldTimeLabel })
  })

  it('never flags the head of the window', () => {
    const out = decorateWorldTime([entry('ai_reply', 5)], EARTH_GREGORIAN, ORIGIN)
    expect(out[0].worldTimeMonotonicityBreak).toBeUndefined()
  })

  it('system entries do not participate as ancestors', () => {
    const rows = [entry('ai_reply', 120), entry('system', 0), entry('ai_reply', 60)]
    const out = decorateWorldTime(rows, EARTH_GREGORIAN, ORIGIN)
    expect(out[2].worldTimeMonotonicityBreak).toEqual({ previousLabel: out[0].worldTimeLabel })
  })
})
