import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { RANKER_DEFAULTS } from './constants'
import { rankAll, rankPerType } from './ranker'
import type { Candidate, RetrievalType } from './types'

const v = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs)
  return Float32Array.from(xs, (x) => x / n)
}

// One token per 4 characters — deterministic, so budget assertions are exact
// and don't move when the encoding table does.
const countTokens = (t: string): number => Math.ceil(t.length / 4)

function candidate(over: Partial<Candidate> & Pick<Candidate, 'id'>): Candidate {
  return {
    kind: 'happening',
    displayName: over.id,
    renderedText: 'x'.repeat(40), // 10 tokens
    sims: [0.5, 0.5, 0.5],
    vector: v(1, 0, 0),
    chaptersOld: 0,
    pinSignal: 0,
    commonKnowledge: false,
    keywordHits: [],
    occurredAtEntryId: null,
    awarenessIds: [],
    embeddingStale: false,
    ...over,
  } as Candidate
}

const emptyPools = (): Record<RetrievalType, Candidate[]> => ({
  entities: [],
  lore: [],
  happenings: [],
  threads: [],
  chapters: [],
})

const base = {
  params: RANKER_DEFAULTS,
  presence: [true, true, true] as const,
  chapterRanges: new Map<string, ReadonlySet<string>>(),
  countTokens,
}

describe('rankPerType — scoring', () => {
  it('blends the three query sims by the configured weights', () => {
    const r = rankPerType([candidate({ id: 'a', sims: [1, 0, 0] })], 'happenings', 1000, base)
    expect(r.traces[0].simBlend).toBeCloseTo(0.35, 6)
  })

  it('re-normalizes weights across the present queries when one is missing', () => {
    // Q3 absent: 0.35/0.35 renormalize to 0.5/0.5, so sims [1, 0, x] blend to 0.5.
    const r = rankPerType([candidate({ id: 'a', sims: [1, 0, 0.9] })], 'happenings', 1000, {
      ...base,
      presence: [true, true, false],
    })
    expect(r.traces[0].simBlend).toBeCloseTo(0.5, 6)
  })

  it('decays by chapter age at the type lambda', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: 10 })],
      'happenings',
      1000,
      base,
    )
    expect(r.traces[0].recencyFactor).toBeCloseTo(Math.exp(-0.7), 6)
  })

  it('flat-tops decay when pin_signal is 1', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: 40, pinSignal: 1 })],
      'happenings',
      1000,
      base,
    )
    expect(r.traces[0].recencyFactor).toBe(1)
    expect(r.traces[0].finalScore).toBeCloseTo(0.6, 6)
  })

  it('adds the keyword boost on a hit and nothing without one', () => {
    const hit = rankPerType(
      [candidate({ id: 'a', keywordHits: ['veilstone'] })],
      'lore',
      1000,
      base,
    )
    const miss = rankPerType([candidate({ id: 'a' })], 'lore', 1000, base)
    expect(hit.traces[0].kwBoostValue).toBe(0.1)
    expect(miss.traces[0].kwBoostValue).toBe(0)
    expect(hit.traces[0].finalScore - miss.traces[0].finalScore).toBeCloseTo(0.1, 6)
  })

  it('revives a deeply decayed row whose sim clears tau_revive', () => {
    // chaptersOld 60 at lambda 0.07 crushes recency to ~0.015; the bypass
    // floors the score at sim - tau_revive = 0.95 - 0.85 = 0.10.
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.95, 0.95, 0.95], chaptersOld: 60 })],
      'happenings',
      1000,
      base,
    )
    expect(r.traces[0].bypassTriggered).toBe(true)
    expect(r.traces[0].finalScore).toBeCloseTo(0.1, 6)
  })

  it('does not trigger the bypass below tau_revive', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.8, 0.8, 0.8], chaptersOld: 60 })],
      'happenings',
      1000,
      base,
    )
    expect(r.traces[0].bypassTriggered).toBe(false)
  })

  it('scores common-knowledge happenings without recency or pin', () => {
    const r = rankPerType(
      [
        candidate({
          id: 'a',
          sims: [0.6, 0.6, 0.6],
          chaptersOld: 40,
          pinSignal: 0.9,
          commonKnowledge: true,
          keywordHits: ['bell'],
        }),
      ],
      'happenings',
      1000,
      base,
    )
    expect(r.traces[0].recencyFactor).toBe(1)
    expect(r.traces[0].pinSignal).toBe(0)
    expect(r.traces[0].finalScore).toBeCloseTo(0.7, 6)
  })
})

describe('rankPerType — MMR and budget fill', () => {
  it('drops a near-duplicate via MMR before it reaches the budget', () => {
    const pool = [
      candidate({ id: 'first', sims: [0.9, 0.9, 0.9], vector: v(1, 0, 0) }),
      candidate({ id: 'dupe', sims: [0.88, 0.88, 0.88], vector: v(1, 0, 0) }),
      candidate({ id: 'other', sims: [0.7, 0.7, 0.7], vector: v(0, 1, 0) }),
    ]
    // Budget seats two candidates (10 tokens + 20 overhead each = 30).
    const r = rankPerType(pool, 'happenings', 60, base)
    expect(r.selected.map((c) => c.id)).toEqual(['first', 'other'])
    expect(r.traces.find((t) => t.id === 'dupe')?.dropReason).toBe('over_budget')
  })

  it('stops at the noise floor and leaves the budget underfilled', () => {
    const pool = [
      candidate({ id: 'good', sims: [0.9, 0.9, 0.9] }),
      candidate({ id: 'noise', sims: [0.05, 0.05, 0.05], vector: v(0, 1, 0) }),
    ]
    const r = rankPerType(pool, 'happenings', 10_000, base)
    expect(r.selected.map((c) => c.id)).toEqual(['good'])
    expect(r.traces.find((t) => t.id === 'noise')?.dropReason).toBe('below_threshold')
    expect(r.funnel.tokensUsed).toBeLessThan(r.funnel.typeBudget)
  })

  it('skips an oversized candidate and seats a smaller one behind it', () => {
    const pool = [
      candidate({ id: 'huge', sims: [0.9, 0.9, 0.9], renderedText: 'x'.repeat(4000) }),
      candidate({ id: 'small', sims: [0.8, 0.8, 0.8], vector: v(0, 1, 0) }),
    ]
    const r = rankPerType(pool, 'happenings', 100, base)
    expect(r.selected.map((c) => c.id)).toEqual(['small'])
    expect(r.traces.find((t) => t.id === 'huge')?.dropReason).toBe('candidate_too_large')
  })

  it('marks over_budget (not candidate_too_large) when only the remainder is short', () => {
    const pool = [
      candidate({ id: 'a', sims: [0.9, 0.9, 0.9] }),
      candidate({ id: 'b', sims: [0.8, 0.8, 0.8], vector: v(0, 1, 0) }),
    ]
    const r = rankPerType(pool, 'happenings', 35, base) // seats one 30-token row
    expect(r.selected.map((c) => c.id)).toEqual(['a'])
    expect(r.traces.find((t) => t.id === 'b')?.dropReason).toBe('over_budget')
  })

  it('pre-filters to the top N and traces the excess with a null mmrRank', () => {
    const pool = Array.from({ length: 205 }, (_, i) =>
      candidate({ id: `c${i}`, sims: [i / 205, i / 205, i / 205], vector: v(1, i % 7, 0) }),
    )
    const r = rankPerType(pool, 'happenings', 60, base)
    expect(r.funnel.poolSize).toBe(205)
    expect(r.funnel.preFilteredSize).toBe(200)
    const dropped = r.traces.filter((t) => t.dropReason === 'pre_filtered')
    expect(dropped).toHaveLength(5)
    expect(dropped.every((t) => t.mmrRank === null)).toBe(true)
    // The five it drops are the five lowest-scoring, not just any five.
    expect(dropped.map((t) => t.id).sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  })

  it('emits one trace per pool row, selected or not', () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      candidate({ id: `c${i}`, sims: [0.5, 0.5, 0.5], vector: v(1, i, 0) }),
    )
    const r = rankPerType(pool, 'happenings', 60, base)
    expect(r.traces).toHaveLength(12)
    expect(new Set(r.traces.map((t) => t.id)).size).toBe(12)
  })
})

describe('rankAll', () => {
  it('applies the chapter-match boost only to happenings inside an injected chapter range', () => {
    const pools = emptyPools()
    pools.chapters = [
      candidate({
        id: 'ch1',
        kind: 'chapter',
        sims: [0.9, 0.9, 0.9],
        renderedText: 'x'.repeat(20),
      }),
    ]
    pools.happenings = [
      candidate({
        id: 'inside',
        sims: [0.5, 0.5, 0.5],
        occurredAtEntryId: 'e1',
        vector: v(1, 0, 0),
      }),
      candidate({
        id: 'outside',
        sims: [0.5, 0.5, 0.5],
        occurredAtEntryId: 'e9',
        vector: v(0, 1, 0),
      }),
    ]
    const r = rankAll({
      ...base,
      pools,
      budgets: { entities: 0, lore: 0, happenings: 1000, threads: 0, chapters: 1000 },
      chapterRanges: new Map([['ch1', new Set(['e1'])]]),
    })
    const t = (id: string) => r.happenings.traces.find((x) => x.id === id)
    expect(t('inside')?.chapterBoostApplied).toBe(true)
    expect(t('outside')?.chapterBoostApplied).toBe(false)
    expect(t('inside')!.finalScore).toBeCloseTo(t('outside')!.finalScore * 1.3, 6)
  })

  it('does not boost when the matching chapter lost its own budget race', () => {
    const pools = emptyPools()
    pools.chapters = [
      candidate({
        id: 'ch1',
        kind: 'chapter',
        sims: [0.9, 0.9, 0.9],
        renderedText: 'x'.repeat(4000),
      }),
    ]
    pools.happenings = [candidate({ id: 'inside', occurredAtEntryId: 'e1' })]
    const r = rankAll({
      ...base,
      pools,
      budgets: { entities: 0, lore: 0, happenings: 1000, threads: 0, chapters: 50 },
      chapterRanges: new Map([['ch1', new Set(['e1'])]]),
    })
    expect(r.chapters.selected).toHaveLength(0)
    expect(r.happenings.traces[0].chapterBoostApplied).toBe(false)
  })

  it('returns a bundle for every type even when a pool is empty', () => {
    const r = rankAll({
      ...base,
      pools: emptyPools(),
      budgets: { entities: 100, lore: 100, happenings: 100, threads: 100, chapters: 100 },
    })
    for (const type of ['entities', 'lore', 'happenings', 'threads', 'chapters'] as const) {
      expect(r[type].selected).toEqual([])
      expect(r[type].funnel.poolSize).toBe(0)
    }
  })
})

// The whole transitive surface the simulator loads, not just the entry file —
// a DB import one hop down pulls the same graph in.
const PURE_FILES = ['ranker.ts', 'mmr.ts', 'vector.ts', 'constants.ts']

describe('C4 — ranker purity', () => {
  it.each(PURE_FILES)('%s imports nothing from lib/stores or lib/db', (file) => {
    const src = readFileSync(`lib/retrieval/${file}`, 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/stores'/)
    expect(src).not.toMatch(/from '@\/lib\/db'/)
    expect(src).not.toMatch(/queryAll|runInTransaction|drizzle/)
  })
})
