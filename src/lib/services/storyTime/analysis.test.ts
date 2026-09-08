import { describe, it, expect } from 'vitest'
import type { Chapter, StoryEntry, TimeAnchor, TimeTracker } from '$lib/types'
import { analyzeTimeline, latestAssertedBoundary, FLATLINE_RUN_LENGTH } from './analysis'

function t(hours: number, minutes = 0): TimeTracker {
  return { years: 0, days: 0, hours, minutes }
}

let seq = 0
function entry(
  options: { start?: TimeTracker; end?: TimeTracker; content?: string; id?: string } = {},
): StoryEntry {
  const { start, end, content = 'some words of narration here', id = `e${++seq}` } = options
  const metadata =
    start || end
      ? { ...(start ? { timeStart: start } : {}), ...(end ? { timeEnd: end } : {}) }
      : null
  return {
    id,
    storyId: 's1',
    type: 'narration',
    content,
    parentId: null,
    position: seq,
    createdAt: 0,
    metadata,
    branchId: null,
  } as StoryEntry
}

function chained(times: TimeTracker[]): StoryEntry[] {
  return times.map((end, i) => entry({ start: i === 0 ? t(0) : times[i - 1], end }))
}

function kinds(entries: StoryEntry[], chapters?: Chapter[]) {
  return analyzeTimeline({ entries, chapters }).map((a) => a.kind)
}

describe('analyzeTimeline', () => {
  it('reports an entry with no recorded time as missing, not as a zero', () => {
    const found = analyzeTimeline({ entries: [entry({}), entry({ start: t(1), end: t(2) })] })
    expect(found.map((a) => a.kind)).toEqual(['missing-stamp'])
    expect(found[0].severity).toBe('defect')
  })

  it('reports a zero stamp as suspect and says why', () => {
    const found = analyzeTimeline({ entries: [entry({ start: t(0), end: t(0) })] })
    const zero = found.find((a) => a.kind === 'suspect-zero')
    expect(zero).toBeDefined()
    expect(zero!.severity).toBe('suspected')
    expect(zero!.detail).toMatch(/absent/i)
  })

  it('keeps missing stamps and recorded zeros as separate classes', () => {
    const found = kinds([entry({}), entry({ start: t(0), end: t(0) })])
    expect(found).toContain('missing-stamp')
    expect(found).toContain('suspect-zero')
  })

  it('reports a pair that runs backwards', () => {
    const a = entry({ start: t(0), end: t(5) })
    const b = entry({ start: t(5), end: t(3) })
    const found = analyzeTimeline({ entries: [a, b] })
    const backwards = found.find((x) => x.kind === 'backwards')
    expect(backwards).toBeDefined()
    expect(backwards!.entryIds).toEqual([a.id, b.id])
    expect(backwards!.severity).toBe('defect')
  })

  it('reports an interval as something to decide, not as a defect', () => {
    const a = entry({ start: t(0), end: t(5) })
    const b = entry({ start: t(7), end: t(8) })
    const gap = analyzeTimeline({ entries: [a, b] }).find((x) => x.kind === 'gap')
    expect(gap).toBeDefined()
    expect(gap!.severity).toBe('note')
    expect(gap!.entryIds).toEqual([a.id, b.id])
  })

  it('reports no defect for a timeline whose only feature is an interval', () => {
    const a = entry({ start: t(0), end: t(5) })
    const b = entry({ start: t(7), end: t(8) })
    const found = analyzeTimeline({ entries: [a, b] })
    expect(found.filter((x) => x.severity === 'defect')).toEqual([])
  })

  it('reports an entry that begins before the previous one ended', () => {
    const a = entry({ start: t(0), end: t(5) })
    const b = entry({ start: t(3), end: t(8) })
    const overlap = analyzeTimeline({ entries: [a, b] }).find((x) => x.kind === 'overlap')
    expect(overlap).toBeDefined()
    expect(overlap!.severity).toBe('defect')
  })

  it('reports a day passing inside a short entry', () => {
    const a = entry({ start: t(0), end: t(1) })
    const b = entry({
      start: t(1),
      end: { years: 0, days: 2, hours: 1, minutes: 0 },
      content: 'She nodded.',
    })
    const found = analyzeTimeline({ entries: [a, b] })
    const jump = found.find((x) => x.kind === 'implausible-jump')
    expect(jump).toBeDefined()
    expect(jump!.severity).toBe('suspected')
  })

  it('does not report a day passing between two short entries', () => {
    const a = entry({ start: t(0), end: t(1), content: 'She nodded.' })
    const b = entry({
      start: { years: 0, days: 2, hours: 0, minutes: 0 },
      end: { years: 0, days: 2, hours: 1, minutes: 0 },
      content: 'He waited.',
    })
    expect(kinds([a, b])).not.toContain('implausible-jump')
  })

  it('reports a long run in which no time passes, once for the run', () => {
    const entries = chained(Array.from({ length: FLATLINE_RUN_LENGTH + 2 }, () => t(3)))
    const found = analyzeTimeline({ entries }).filter((a) => a.kind === 'flatline')
    expect(found).toHaveLength(1)
    expect(found[0].entryIds.length).toBeGreaterThanOrEqual(FLATLINE_RUN_LENGTH)
  })

  it('reports a chapter whose span disagrees with the entries it covers', () => {
    const a = entry({ start: t(1), end: t(2) })
    const b = entry({ start: t(2), end: t(4) })
    const chapter = {
      id: 'c1',
      number: 1,
      startEntryId: a.id,
      endEntryId: b.id,
      startTime: t(1),
      endTime: t(9),
    } as Chapter
    const found = analyzeTimeline({ entries: [a, b], chapters: [chapter] })
    const stale = found.find((x) => x.kind === 'chapter-span-disagreement')
    expect(stale).toBeDefined()
    expect(stale!.chapterId).toBe('c1')
    expect(stale!.severity).toBe('defect')
  })

  it('reports nothing for a timeline that triggers no class', () => {
    const a = entry({ start: t(1), end: t(2) })
    const b = entry({ start: t(2), end: t(4) })
    const chapter = {
      id: 'c1',
      number: 1,
      startEntryId: a.id,
      endEntryId: b.id,
      startTime: t(1),
      endTime: t(4),
    } as Chapter
    expect(analyzeTimeline({ entries: [a, b], chapters: [chapter] })).toEqual([])
  })

  it('does not modify the entries it reads', () => {
    const entries = [entry({ start: t(0), end: t(0) }), entry({})]
    const before = JSON.stringify(entries)
    analyzeTimeline({ entries })
    expect(JSON.stringify(entries)).toBe(before)
  })
})

function anchor(entryId: string, assertedTime: TimeTracker): TimeAnchor {
  return { id: `a-${entryId}`, storyId: 's1', entryId, assertedTime, note: null, createdAt: 0 }
}

describe('latestAssertedBoundary', () => {
  it('reports nothing asserted when there are no anchors', () => {
    const report = latestAssertedBoundary([entry({ start: t(0), end: t(1) })], [])
    expect(report.entryId).toBeNull()
    expect(report.assertedTime).toBeNull()
  })

  it('names the latest anchored entry and what follows it', () => {
    const a = entry({ start: t(0), end: t(1) })
    const b = entry({ start: t(1), end: t(2) })
    const c = entry({ start: t(2), end: t(5) })
    const report = latestAssertedBoundary([a, b, c], [anchor(a.id, t(1)), anchor(b.id, t(2))])
    expect(report.entryId).toBe(b.id)
    expect(report.entriesAfter).toBe(1)
    expect(report.elapsedAfter).toEqual(t(3))
  })

  it('says whether the recorded time agrees with the assertion', () => {
    const a = entry({ start: t(0), end: t(1) })
    expect(latestAssertedBoundary([a], [anchor(a.id, t(1))]).agrees).toBe(true)
    expect(latestAssertedBoundary([a], [anchor(a.id, t(9))]).agrees).toBe(false)
  })

  it('uses the latest anchor even when two anchors contradict each other', () => {
    const a = entry({ start: t(0), end: t(1) })
    const b = entry({ start: t(1), end: t(2) })
    const report = latestAssertedBoundary([a, b], [anchor(a.id, t(8)), anchor(b.id, t(2))])
    expect(report.entryId).toBe(b.id)
    expect(report.agrees).toBe(true)
  })

  it('reports an unusable tail as unavailable rather than as a duration', () => {
    const a = entry({ start: t(0), end: t(5) })
    const missing = entry({})
    expect(latestAssertedBoundary([a, missing], [anchor(a.id, t(5))]).elapsedAfter).toBeNull()

    const backwards = entry({ start: t(5), end: t(1) })
    expect(latestAssertedBoundary([a, backwards], [anchor(a.id, t(5))]).elapsedAfter).toBeNull()
  })

  it('reports a zero tail when the anchor is on the final entry', () => {
    const a = entry({ start: t(0), end: t(5) })
    const report = latestAssertedBoundary([a], [anchor(a.id, t(5))])
    expect(report.entriesAfter).toBe(0)
    expect(report.elapsedAfter).toEqual(t(0))
  })
})
