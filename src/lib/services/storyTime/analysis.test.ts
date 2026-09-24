import { describe, it, expect } from 'vitest'
import type { Chapter, StoryEntry, TimeTracker } from '$lib/types'
import { analyzeTimeline, FLATLINE_RUN_LENGTH } from './analysis'

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

  it('suspects an interval between two entries, and does not call it a defect', () => {
    const a = entry({ start: t(0), end: t(5) })
    const b = entry({ start: t(7), end: t(8) })
    const gap = analyzeTimeline({ entries: [a, b] }).find((x) => x.kind === 'gap')
    expect(gap).toBeDefined()
    expect(gap!.severity).toBe('suspected')
    expect(gap!.entryIds).toEqual([a.id, b.id])
  })

  it('reports no gap between entries that meet', () => {
    const a = entry({ start: t(0), end: t(5) })
    const b = entry({ start: t(5), end: t(8) })
    expect(analyzeTimeline({ entries: [a, b] }).some((x) => x.kind === 'gap')).toBe(false)
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

  it('checks the opening entry for a jump too', () => {
    const opening = entry({
      start: t(8),
      end: { years: 0, days: 3, hours: 8, minutes: 0 },
      content: 'Three days on the road.',
    })
    expect(kinds([opening])).toContain('implausible-jump')
  })

  it('reports an entry that ends before it begins as a defect', () => {
    const a = entry({ start: t(8), end: t(10) })
    const b = entry({ start: t(12), end: t(11) })
    const found = analyzeTimeline({ entries: [a, b] })
    const reversed = found.find((x) => x.kind === 'reversed')
    expect(reversed).toMatchObject({ entryIds: [b.id], severity: 'defect' })
    expect(found.map((x) => x.kind)).not.toContain('implausible-jump')
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
