import { describe, expect, it } from 'vitest'

import type { Happening } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import type { PlotListSignals } from '@/lib/list-modules'

import {
  groupHappeningsByBucket,
  happeningBucket,
  happeningFilters,
  queryHappenings,
} from './happening-list'

function entry(id: string, position: number, chapterId: string | null): EntryRef {
  return { id, position, kind: 'ai_reply', chapterId, excerpt: '' }
}

const ENTRIES: EntryIndex = new Map(
  [
    entry('e1', 1, 'chap_1'),
    entry('e2', 2, 'chap_1'),
    entry('e3', 3, null),
    entry('e4', 4, null),
  ].map((e) => [e.id, e]),
)

function happening(id: string, title: string, extra: Partial<Happening> = {}): Happening {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const ROWS = [
  happening('h_e3', 'Ambush', { occurredAtEntryId: 'e3' }),
  happening('h_e1', 'Arrival', { occurredAtEntryId: 'e1' }),
  happening('h_temporal', 'Old betrayal', {
    temporal: 'years past',
    description: 'Sage sold them.',
  }),
  happening('h_e4', 'Market fire', { occurredAtEntryId: 'e4', commonKnowledge: 1 }),
  happening('h_dangling', 'Rolled away', { occurredAtEntryId: 'gone' }),
]

const WITH_CHAPTERS: PlotListSignals = { entries: ENTRIES, hasClosedChapters: true }
const NO_CHAPTERS: PlotListSignals = {
  entries: new Map([...ENTRIES].map(([id, e]) => [id, { ...e, chapterId: null }])),
  hasClosedChapters: false,
}

describe('happeningBucket', () => {
  it('buckets by the anchor entry chapter, temporal last, dangling in Current', () => {
    expect(happeningBucket(ROWS[0], ENTRIES)).toBe('current')
    expect(happeningBucket(ROWS[1], ENTRIES)).toBe('earlier')
    expect(happeningBucket(ROWS[2], ENTRIES)).toBe('out-of-narrative')
    expect(happeningBucket(ROWS[4], ENTRIES)).toBe('current')
  })
})

describe('queryHappenings', () => {
  it('sorts by entry position DESC, dangling after anchored, temporal in a last block', () => {
    expect(
      queryHappenings(ROWS, { search: '', filter: 'all' }, WITH_CHAPTERS).map((r) => r.id),
    ).toEqual(['h_e4', 'h_e3', 'h_e1', 'h_dangling', 'h_temporal'])
  })

  it('narrows per chip', () => {
    const ids = (filter: Parameters<typeof queryHappenings>[1]['filter']) =>
      queryHappenings(ROWS, { search: '', filter }, WITH_CHAPTERS).map((r) => r.id)
    expect(ids('this-chapter')).toEqual(['h_e4', 'h_e3', 'h_dangling'])
    expect(ids('common-knowledge')).toEqual(['h_e4'])
    expect(ids('out-of-narrative')).toEqual(['h_temporal'])
  })

  it('searches title, description and category', () => {
    expect(
      queryHappenings(ROWS, { search: 'sold', filter: 'all' }, WITH_CHAPTERS).map((r) => r.id),
    ).toEqual(['h_temporal'])
  })
})

describe('groupHappeningsByBucket', () => {
  it('orders Current, Earlier, Out of narrative and omits empty buckets', () => {
    const all = queryHappenings(ROWS, { search: '', filter: 'all' }, WITH_CHAPTERS)
    expect(
      groupHappeningsByBucket(all, WITH_CHAPTERS).groups.map((g) => [
        g.key,
        g.rows.map((r) => r.id),
      ]),
    ).toEqual([
      ['current', ['h_e4', 'h_e3', 'h_dangling']],
      ['earlier', ['h_e1']],
      ['out-of-narrative', ['h_temporal']],
    ])
  })

  it('collapses to Current plus Out of narrative while no chapter has closed', () => {
    const all = queryHappenings(ROWS, { search: '', filter: 'all' }, NO_CHAPTERS)
    expect(groupHappeningsByBucket(all, NO_CHAPTERS).groups.map((g) => g.key)).toEqual([
      'current',
      'out-of-narrative',
    ])
  })
})

describe('happeningFilters', () => {
  it('offers This chapter only once a chapter has closed', () => {
    expect(happeningFilters(WITH_CHAPTERS)).toContain('this-chapter')
    expect(happeningFilters(NO_CHAPTERS)).not.toContain('this-chapter')
    expect(happeningFilters(NO_CHAPTERS)).toBe(happeningFilters(NO_CHAPTERS))
  })
})
