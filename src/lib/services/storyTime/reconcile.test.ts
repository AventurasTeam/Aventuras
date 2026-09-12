import { describe, it, expect } from 'vitest'
import type { StoryEntry, TimeTracker } from '$lib/types'
import {
  reconcileRange,
  outstandingDurations,
  rangeIntervals,
  type ReconcileResult,
} from './reconcile'
import { toMinutes } from './minutes'

function t(hours: number, minutes = 0): TimeTracker {
  return { years: 0, days: 0, hours, minutes }
}

let seq = 0
function entry(
  start: TimeTracker | null,
  end: TimeTracker | null,
  id = `e${++seq}`,
  type: StoryEntry['type'] = 'narration',
): StoryEntry {
  const metadata =
    start || end
      ? { ...(start ? { timeStart: start } : {}), ...(end ? { timeEnd: end } : {}) }
      : null
  return {
    id,
    storyId: 's1',
    type,
    content: 'text',
    parentId: null,
    position: seq,
    createdAt: 0,
    metadata,
    branchId: null,
  } as StoryEntry
}

/** A contiguous run: each entry begins where the previous one ended. */
function chained(edges: TimeTracker[], prefix = 'c'): StoryEntry[] {
  const built: StoryEntry[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    built.push(entry(edges[i], edges[i + 1], `${prefix}${i}`))
  }
  return built
}

function ok(result: ReconcileResult) {
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
  return result
}

function spans(result: ReconcileResult) {
  return ok(result).times.map((time) => [toMinutes(time.start), toMinutes(time.end)])
}

describe('reconcileRange', () => {
  it('compresses a range while keeping its proportions', () => {
    const entries = chained([t(10), t(11), t(12)])
    const result = reconcileRange({ entries, baseline: t(9), target: t(12) })
    // Durations 60 and 60 across a 180-minute span: each doubles, nothing else moves.
    expect(spans(result)).toEqual([
      [toMinutes(t(9)), toMinutes(t(10, 30))],
      [toMinutes(t(10, 30)), toMinutes(t(12))],
    ])
  })

  it('produces the same result when applied a second time', () => {
    const entries = chained([t(10), t(11), t(12)])
    const first = ok(reconcileRange({ entries, baseline: t(9), target: t(11) }))
    const repaired = first.times.map((time, i) => entry(time.start, time.end, `r${i}`))
    const second = ok(reconcileRange({ entries: repaired, baseline: t(9), target: t(11) }))
    expect(second.times.map((x) => [toMinutes(x.start), toMinutes(x.end)])).toEqual(
      first.times.map((x) => [toMinutes(x.start), toMinutes(x.end)]),
    )
  })

  it('is stable even when the assertion is far from the record', () => {
    // The round-2 review's fixture, which the old baseline-relative weighting got wrong.
    const entries = chained([t(10), t(11), t(12)])
    const first = ok(reconcileRange({ entries, baseline: t(9), target: t(11) }))
    const repaired = first.times.map((time, i) => entry(time.start, time.end, `s${i}`))
    const second = ok(reconcileRange({ entries: repaired, baseline: t(9), target: t(11) }))
    expect(spans(second)).toEqual(spans(first))
  })

  it('leaves an entry duration undistorted by a distant baseline', () => {
    // Two equal hours stay equal no matter where the range is asserted to begin.
    const entries = chained([t(10), t(11), t(12)])
    const near = ok(reconcileRange({ entries, baseline: t(10), target: t(12) }))
    const far = ok(reconcileRange({ entries, baseline: t(2), target: t(4) }))
    const shares = (r: typeof near) => r.times.map((x) => toMinutes(x.end) - toMinutes(x.start))
    expect(shares(near)).toEqual(shares(far))
  })

  it('refuses a span that runs backwards', () => {
    const result = reconcileRange({ entries: [entry(t(4), t(5))], baseline: t(9), target: t(3) })
    expect(result).toEqual({ status: 'refused', reason: 'backwards-span' })
  })

  it('allows a zero span, collapsing the range', () => {
    const entries = chained([t(10), t(11), t(12)])
    const result = reconcileRange({ entries, baseline: t(9), target: t(9) })
    expect(spans(result)).toEqual([
      [toMinutes(t(9)), toMinutes(t(9))],
      [toMinutes(t(9)), toMinutes(t(9))],
    ])
  })

  it('lands exactly on the target and stays monotonic with an awkward scale factor', () => {
    const edges = Array.from({ length: 38 }, (_, i) => t(0, i * 7))
    const result = ok(
      reconcileRange({ entries: chained(edges, 'long'), baseline: t(0), target: t(0, 101) }),
    )
    const minutes = result.times.flatMap((time) => [toMinutes(time.start), toMinutes(time.end)])
    expect(minutes[minutes.length - 1]).toBe(101)
    for (let i = 1; i < minutes.length; i++)
      expect(minutes[i]).toBeGreaterThanOrEqual(minutes[i - 1])
  })

  describe('the interval between entries', () => {
    it('keeps a skip where it happened instead of charging it to the next entry', () => {
      // Two fifteen-minute scenes a week apart. The week belongs between them.
      const week = 7 * 24 * 60
      const a = entry({ years: 0, days: 0, hours: 0, minutes: 0 }, t(0, 15), 'a')
      const b = entry(
        { years: 0, days: 7, hours: 0, minutes: 0 },
        { years: 0, days: 7, hours: 0, minutes: 15 },
        'b',
      )
      const result = ok(
        reconcileRange({
          entries: [a, b],
          baseline: t(0),
          target: { years: 0, days: 7, hours: 0, minutes: 30 },
        }),
      )
      const [first, second] = result.times
      expect(toMinutes(first.end) - toMinutes(first.start)).toBe(15)
      expect(toMinutes(second.end) - toMinutes(second.start)).toBe(15)
      expect(toMinutes(second.start) - toMinutes(first.end)).toBe(week)
    })

    it('scales the interval with everything else', () => {
      const a = entry(t(0), t(1), 'a')
      const b = entry(t(3), t(4), 'b')
      // Durations 60 + 60, interval 120: 240 total, halved into a 120-minute span.
      const result = ok(reconcileRange({ entries: [a, b], baseline: t(0), target: t(2) }))
      const [first, second] = result.times
      expect(toMinutes(first.end) - toMinutes(first.start)).toBe(30)
      expect(toMinutes(second.start) - toMinutes(first.end)).toBe(60)
      expect(toMinutes(second.end) - toMinutes(second.start)).toBe(30)
    })

    it('treats an overlapping record as no interval at all', () => {
      const a = entry(t(0), t(2), 'a')
      const b = entry(t(1), t(3), 'b')
      const result = ok(reconcileRange({ entries: [a, b], baseline: t(0), target: t(4) }))
      const [first, second] = result.times
      expect(toMinutes(second.start)).toBe(toMinutes(first.end))
    })
  })

  describe('the reported failure', () => {
    it('does not ask about a user action when the anchor is far from the record', () => {
      // A narrator entry anchored to 19:00 where the record said 01:00. The user action that
      // follows has zero recorded duration, and is nobody's question.
      const action = entry(t(1), t(1), 'action', 'user_action')
      const narration = entry(t(1), t(2), 'narration')
      const result = reconcileRange({
        entries: [action, narration],
        baseline: t(19),
        target: t(21),
      })
      expect(result.status).toBe('ok')
    })

    it('gives a user action no share of the span', () => {
      const action = entry(t(1), t(1), 'ua', 'user_action')
      const narration = entry(t(1), t(2), 'nr')
      const result = ok(
        reconcileRange({ entries: [action, narration], baseline: t(19), target: t(21) }),
      )
      const [first, second] = result.times
      expect(toMinutes(first.end) - toMinutes(first.start)).toBe(0)
      expect(toMinutes(second.end) - toMinutes(second.start)).toBe(120)
    })
  })

  describe('durations it cannot read', () => {
    it('asks only about the entry that is missing times, not its successor', () => {
      const b = entry(null, null, 'B')
      const c = entry(t(9), t(10), 'C')
      const result = reconcileRange({
        entries: [entry(t(9), t(9), 'A'), b, c],
        baseline: t(9),
        target: t(10),
      })
      if (result.status !== 'needs-durations') throw new Error('expected requests')
      expect(result.requests.map((r) => r.entryId)).toEqual(['B'])
      expect(result.requests[0].reason).toBe('missing-times')
    })

    it('asks about an entry that ends before it begins', () => {
      const result = reconcileRange({
        entries: [entry(t(5), t(3), 'A')],
        baseline: t(0),
        target: t(9),
      })
      if (result.status !== 'needs-durations') throw new Error('expected requests')
      expect(result.requests).toEqual([{ entryId: 'A', reason: 'backwards' }])
    })

    it('uses a supplied duration as that entry weight', () => {
      const entries = [entry(t(9), t(9), 'A'), entry(null, null, 'B'), entry(null, null, 'C')]
      const result = reconcileRange({
        entries,
        baseline: t(9),
        target: t(10),
        suppliedDurations: { B: 15, C: 45 },
      })
      const [a, b, c] = ok(result).times
      expect(toMinutes(a.end) - toMinutes(a.start)).toBe(0)
      expect(toMinutes(b.end) - toMinutes(b.start)).toBe(15)
      expect(toMinutes(c.end) - toMinutes(c.start)).toBe(45)
    })

    it('lets zero supplied weights fall through to the even fallback', () => {
      const entries = [entry(t(9), t(9), 'A'), entry(null, null, 'B'), entry(null, null, 'C')]
      const result = reconcileRange({
        entries,
        baseline: t(9),
        target: t(10),
        suppliedDurations: { B: 0, C: 0 },
      })
      expect(spans(result).map((s) => s[1])).toEqual([
        toMinutes(t(9, 20)),
        toMinutes(t(9, 40)),
        toMinutes(t(10)),
      ])
    })

    it('leaves an invalid supplied duration unresolved', () => {
      for (const bad of [-5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = reconcileRange({
          entries: [entry(null, null, 'B')],
          baseline: t(9),
          target: t(10),
          suppliedDurations: { B: bad },
        })
        if (result.status !== 'needs-durations') throw new Error(`expected requests for ${bad}`)
        expect(result.requests[0].invalid).toBe(true)
      }
    })

    it('does not let supplied durations change the span', () => {
      const result = reconcileRange({
        entries: [entry(null, null, 'B'), entry(null, null, 'C')],
        baseline: t(9),
        target: t(10),
        suppliedDurations: { B: 6000, C: 9000 },
      })
      expect(spans(result).at(-1)![1]).toBe(toMinutes(t(10)))
    })
  })

  describe('joins to the entries outside the range', () => {
    it('reports an overlap when the baseline precedes the previous stored ending', () => {
      const result = ok(
        reconcileRange({
          entries: [entry(t(10), t(11), 'x')],
          baseline: t(9),
          target: t(11),
          previousEnd: t(10),
        }),
      )
      expect(result.leadingJoin.differenceMinutes).toBe(60)
    })

    it('reports the join after a moved final ending', () => {
      const result = ok(
        reconcileRange({
          entries: [entry(t(10), t(11), 'y')],
          baseline: t(9),
          target: t(10),
          nextStart: t(11),
        }),
      )
      expect(result.trailingJoin?.differenceMinutes).toBe(60)
    })

    it('reports no trailing join when nothing follows the range', () => {
      const result = ok(
        reconcileRange({ entries: [entry(t(10), t(11), 'z')], baseline: t(9), target: t(11) }),
      )
      expect(result.trailingJoin).toBeNull()
    })
  })
})

describe('a user action weighs nothing, whatever the record says', () => {
  const cases: [string, StoryEntry][] = [
    ['no times at all', entry(null, null, 'ua', 'user_action')],
    ['a span it should not have', entry(t(1), t(4), 'ua', 'user_action')],
    ['times that run backwards', entry(t(4), t(1), 'ua', 'user_action')],
    ['only a beginning', entry(t(2), null, 'ua', 'user_action')],
    ['only an ending', entry(null, t(2), 'ua', 'user_action')],
  ]

  for (const [description, action] of cases) {
    it(`is never asked about when it has ${description}`, () => {
      const result = reconcileRange({
        entries: [action, entry(t(0), t(1), 'narr')],
        baseline: t(0),
        target: t(4),
      })
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return
      const [first] = result.times
      expect(toMinutes(first.end) - toMinutes(first.start)).toBe(0)
    })
  }

  it('still asks about a narration with the same corruption', () => {
    const result = reconcileRange({
      entries: [entry(t(4), t(1), 'narr')],
      baseline: t(0),
      target: t(4),
    })
    expect(result.status).toBe('needs-durations')
  })
})

describe('what the review can ask before a repair is run', () => {
  it('reports the entries whose length cannot be read', () => {
    const entries = [
      entry(t(0), t(1), 'fine'),
      entry(null, null, 'blank'),
      entry(t(4), t(1), 'backwards'),
      entry(null, null, 'action', 'user_action'),
    ]
    expect(outstandingDurations(entries)).toEqual([
      { entryId: 'blank', reason: 'missing-times' },
      { entryId: 'backwards', reason: 'backwards' },
    ])
  })

  it('clears a request once a duration is supplied for it', () => {
    const entries = [entry(null, null, 'blank')]
    expect(outstandingDurations(entries, { blank: 30 })).toEqual([])
  })

  it('reports an override that cannot be read, even on a healthy entry', () => {
    const entries = [entry(t(0), t(1), 'fine')]
    expect(outstandingDurations(entries, { fine: -5 })).toEqual([
      { entryId: 'fine', reason: 'invalid-override', invalid: true },
    ])
  })

  it('lists every adjacent pair, including the one a user action closes', () => {
    const entries = [
      entry(t(0), t(1), 'narr1'),
      entry(t(4), t(4), 'act', 'user_action'),
      entry(t(4), t(5), 'narr2'),
    ]
    expect(rangeIntervals(entries)).toEqual([
      { afterEntryId: 'narr1', beforeEntryId: 'act', recordedMinutes: 180 },
      { afterEntryId: 'act', beforeEntryId: 'narr2', recordedMinutes: 0 },
    ])
  })
})

describe('an override sets the weight, not the resulting length', () => {
  it('takes precedence over a perfectly readable record', () => {
    // Two one-hour entries; overriding the first to three hours makes it weigh 3:1.
    const entries = [entry(t(0), t(1), 'a'), entry(t(1), t(2), 'b')]
    const result = ok(
      reconcileRange({ entries, baseline: t(0), target: t(4), suppliedDurations: { a: 180 } }),
    )
    const [first, second] = result.times
    expect(toMinutes(first.end) - toMinutes(first.start)).toBe(180)
    expect(toMinutes(second.end) - toMinutes(second.start)).toBe(60)
  })

  it('does not pin the entry to the figure supplied', () => {
    // The same 3h override against a two-hour span comes out as 90 minutes, not 180.
    const entries = [entry(t(0), t(1), 'a'), entry(t(1), t(2), 'b')]
    const result = ok(
      reconcileRange({ entries, baseline: t(0), target: t(2), suppliedDurations: { a: 180 } }),
    )
    expect(toMinutes(result.times[0].end) - toMinutes(result.times[0].start)).toBe(90)
  })
})

describe('an interval the reader adds', () => {
  it('is listed even before it has a length', () => {
    const entries = chained([t(0), t(1), t(2)], 'add')
    const listed = rangeIntervals(entries, {})
    expect(listed.every((i) => i.recordedMinutes === 0)).toBe(true)

    const withAdded = rangeIntervals(entries, { [entries[0].id]: 0 })
    expect(withAdded[0].recordedMinutes).toBe(0)
  })

  it('stands in for the recorded length rather than adding to it', () => {
    const a = entry(t(0), t(1))
    const b = entry(t(2), t(3))
    const listed = rangeIntervals([a, b], { [a.id]: 30 })
    expect(listed[0].recordedMinutes).toBe(30)
  })

  it('takes a share of the span like any other weight', () => {
    const entries = chained([t(0), t(1), t(2)], 'share')
    const result = reconcileRange({
      entries,
      baseline: t(0),
      target: t(4),
      intervalWeights: { [entries[0].id]: 60 },
    })
    expect(result.status).toBe('ok')
    const ok = result as Extract<ReconcileResult, { status: 'ok' }>

    // Three equal weights of an hour each: the entries take one third of four hours apiece,
    // and the interval between them takes the remaining third rather than being closed.
    expect(toMinutes(ok.times[0].end) - toMinutes(ok.times[0].start)).toBe(80)
    expect(toMinutes(ok.times[1].start) - toMinutes(ok.times[0].end)).toBe(80)
    expect(toMinutes(ok.times[1].end) - toMinutes(ok.times[1].start)).toBe(80)
  })

  it('closes the interval when it is stated as weighing nothing', () => {
    const entries = chained([t(0), t(1), t(2)], 'void')
    const result = reconcileRange({
      entries,
      baseline: t(0),
      target: t(4),
      intervalWeights: { [entries[0].id]: 0 },
    })
    const ok = result as Extract<ReconcileResult, { status: 'ok' }>
    expect(toMinutes(ok.times[1].start) - toMinutes(ok.times[0].end)).toBe(0)
  })
})
