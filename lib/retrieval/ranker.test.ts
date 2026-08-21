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

// What one default pool row costs: its 10 text tokens plus the type's macro
// overhead. Derived, not written out, so the budget-fill cases below stay about
// budget-fill semantics instead of re-encoding whatever the memory-blocks macro
// happens to cost this month.
const HAPPENING_COST = 10 + RANKER_DEFAULTS.typeOverhead.happenings

const base = {
  params: RANKER_DEFAULTS,
  chapterRanges: new Map<string, ReadonlySet<string>>(),
  countTokens,
}

describe('rankPerType — scoring', () => {
  it('blends the three query sims by the configured weights', () => {
    const r = rankPerType([candidate({ id: 'a', sims: [1, 0, 0] })], 'happenings', 1000, base)
    expect(r.traces[0].simBlend).toBeCloseTo(0.35, 6)
  })

  it('re-normalizes weights across the present queries when one is missing', () => {
    // Q3 absent: 0.35/0.35 renormalize to 0.5/0.5, so sims [1, 0, null] blend to 0.5.
    const r = rankPerType([candidate({ id: 'a', sims: [1, 0, null] })], 'happenings', 1000, base)
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

  // Lore has lambda 0, so its pin signal — priority/100 — has no decay exponent
  // to act through and reaches the score only via pinBoost.
  it('lets lore priority lift the score, and leaves priority 0 untouched', () => {
    const unpinned = rankPerType([candidate({ id: 'a', pinSignal: 0 })], 'lore', 1000, base)
    const pinned = rankPerType([candidate({ id: 'a', pinSignal: 1 })], 'lore', 1000, base)
    // Literal, not derived from RANKER_DEFAULTS.pinBoost.lore: an expectation
    // computed from the constant under test passes at every value including 0.
    expect(unpinned.traces[0].finalScore).toBeCloseTo(0.5, 6)
    expect(pinned.traces[0].finalScore).toBeCloseTo(0.625, 6)
    expect(pinned.traces[0].recencyFactor).toBe(1)
  })

  // The property that chose a multiplier over an additive boost: max priority
  // must not carry an irrelevant row over the floor, because that is what
  // injection_mode='always' is for.
  it('does not let max lore priority seat a row that is not relevant', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.02, 0.02, 0.02], pinSignal: 1 })],
      'lore',
      1000,
      base,
    )
    expect(r.selected).toHaveLength(0)
    expect(r.traces[0].dropReason).toBe('below_threshold')
  })

  // decay_resistance already acts through the exponent for happenings; a
  // non-zero pinBoost there would count the same pin twice.
  it('gives happenings no pinBoost channel, so the pin acts through decay alone', () => {
    expect(RANKER_DEFAULTS.pinBoost.happenings).toBe(0)
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: 0, pinSignal: 1 })],
      'happenings',
      1000,
      base,
    )
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

  it('adds the keyword boost after decay, not before', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: 10, keywordHits: ['x'] })],
      'happenings',
      1000,
      base,
    )
    expect(r.traces[0].finalScore).toBeCloseTo(0.6 * Math.exp(-0.7) + 0.1, 6)
  })

  it('clamps an out-of-range pin signal and age instead of inverting decay', () => {
    const overPinned = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: 40, pinSignal: 2 })],
      'happenings',
      1000,
      base,
    )
    expect(overPinned.traces[0].pinSignal).toBe(1)
    expect(overPinned.traces[0].recencyFactor).toBe(1)
    expect(overPinned.traces[0].finalScore).toBeCloseTo(0.6, 6)

    const underPinned = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: 40, pinSignal: -1 })],
      'happenings',
      1000,
      base,
    )
    expect(underPinned.traces[0].pinSignal).toBe(0)
    expect(underPinned.traces[0].recencyFactor).toBeCloseTo(Math.exp(-2.8), 6)

    const negativeAge = rankPerType(
      [candidate({ id: 'a', sims: [0.6, 0.6, 0.6], chaptersOld: -20 })],
      'happenings',
      1000,
      base,
    )
    expect(negativeAge.traces[0].recencyFactor).toBe(1)
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
    // The score alone revives nothing: bypass output is capped at
    // 1 - tau_revive = 0.15, under the 0.2 first-pick floor. Seating is what
    // "revives" means, so assert it rather than the score that precedes it.
    expect(r.selected.map((c) => c.id)).toEqual(['a'])
    expect(r.traces[0].dropReason).toBe('not_dropped')
  })

  // Even a perfect sim_blend cannot clear the floor on score alone, so this is
  // the case that proves the exemption rather than a lucky threshold margin.
  it('seats a bypassed row at the bypass ceiling, where the score cannot reach', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [1, 1, 1], chaptersOld: 60, renderedText: 'x'.repeat(120) })],
      'happenings',
      10_000,
      base,
    )
    expect(r.traces[0].finalScore).toBeCloseTo(0.15, 6)
    expect(r.selected.map((c) => c.id)).toEqual(['a'])
  })

  it('does not extend the exemption to rows that never bypassed', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [0.1, 0.1, 0.1], chaptersOld: 60 })],
      'happenings',
      10_000,
      base,
    )
    expect(r.traces[0].bypassTriggered).toBe(false)
    expect(r.traces[0].dropReason).toBe('below_threshold')
    expect(r.selected).toEqual([])
  })

  // retrieval.md → High-similarity bypass: "Revival doesn't bypass the budget."
  it('still holds a bypassed row to the type budget', () => {
    const r = rankPerType(
      [candidate({ id: 'a', sims: [1, 1, 1], chaptersOld: 60, renderedText: 'x'.repeat(4000) })],
      'happenings',
      20,
      base,
    )
    expect(r.traces[0].bypassTriggered).toBe(true)
    expect(r.traces[0].dropReason).toBe('candidate_too_large')
    expect(r.selected).toEqual([])
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
    // A budget one token short of a third row, so the near-duplicate MMR pushed
    // to the back is the one that misses out.
    const r = rankPerType(pool, 'happenings', HAPPENING_COST * 3 - 1, base)
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
    const r = rankPerType(pool, 'happenings', HAPPENING_COST * 2 - 1, base) // seats one row
    expect(r.selected.map((c) => c.id)).toEqual(['a'])
    expect(r.traces.find((t) => t.id === 'b')?.dropReason).toBe('over_budget')
  })

  it('stamps the MMR position on every ranked trace', () => {
    const pool = [
      candidate({ id: 'first', sims: [0.9, 0.9, 0.9], vector: v(1, 0, 0) }),
      candidate({ id: 'dupe', sims: [0.88, 0.88, 0.88], vector: v(1, 0, 0) }),
      candidate({ id: 'other', sims: [0.7, 0.7, 0.7], vector: v(0, 1, 0) }),
    ]
    const r = rankPerType(pool, 'happenings', 60, base)
    const rank = (id: string) => r.traces.find((t) => t.id === id)?.mmrRank
    expect([rank('first'), rank('other'), rank('dupe')]).toEqual([0, 1, 2])
  })

  it('funnel counts the seated rows and the MMR input size', () => {
    const pool = [
      candidate({ id: 'a', sims: [0.9, 0.9, 0.9] }),
      candidate({ id: 'b', sims: [0.8, 0.8, 0.8], vector: v(0, 1, 0) }),
    ]
    const r = rankPerType(pool, 'happenings', HAPPENING_COST * 2 - 1, base)
    expect(r.funnel.selectedCount).toBe(1)
    expect(r.funnel.preFilteredSize).toBe(2)
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
    // null is the marker light-mode simulation branches on, so the absence has
    // to be asserted as hard as the presence: these rows never reached MMR.
    expect(dropped.every((t) => t.mmrScore === null)).toBe(true)
    expect(
      r.traces.filter((t) => t.dropReason !== 'pre_filtered').every((t) => t.mmrScore !== null),
    ).toBe(true)
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

  it('boosts the revived score, not the decayed one, when both fire on a row', () => {
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
        id: 'callback',
        sims: [0.95, 0.95, 0.95],
        chaptersOld: 60,
        occurredAtEntryId: 'e1',
      }),
    ]
    const r = rankAll({
      ...base,
      pools,
      budgets: { entities: 0, lore: 0, happenings: 1000, threads: 0, chapters: 1000 },
      chapterRanges: new Map([['ch1', new Set(['e1'])]]),
    })
    const t = r.happenings.traces[0]
    expect(t.bypassTriggered).toBe(true)
    expect(t.chapterBoostApplied).toBe(true)
    // (0.95 - 0.85) * 1.3. Boosting before the bypass floors instead gives ~0.10,
    // since 0.0142 * 1.3 loses to the floor.
    expect(t.finalScore).toBeCloseTo(0.13, 6)
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

describe('tokenization is deferred past the pre-filter', () => {
  it('tokenizes only the kept rows and leaves pre-filtered ones null', () => {
    const pool = Array.from({ length: 5 }, (_, i) => {
      const sim = 0.9 - i * 0.1
      return candidate({
        id: `lo_${i}`,
        kind: 'lore',
        sims: [sim, sim, sim],
        vector: v(sim, 1 - sim),
      })
    })
    let calls = 0

    const out = rankPerType(pool, 'lore', 10_000, {
      ...base,
      params: { ...RANKER_DEFAULTS, preFilterTopN: 2 },
      countTokens: () => {
        calls += 1
        return 7
      },
    })

    expect(calls).toBe(2)
    const kept = out.traces.filter((t) => t.dropReason !== 'pre_filtered')
    const dropped = out.traces.filter((t) => t.dropReason === 'pre_filtered')
    expect(kept).toHaveLength(2)
    expect(dropped).toHaveLength(3)
    expect(kept.every((t) => t.tokensEstimated === 7 + RANKER_DEFAULTS.typeOverhead.lore)).toBe(
      true,
    )
    expect(dropped.every((t) => t.tokensEstimated === null)).toBe(true)
  })

  it('takes a captured token count in preference to recomputing', () => {
    const pool = [candidate({ id: 'lo_a', kind: 'lore', sims: [0.9, 0.9, 0.9] })]

    const out = rankPerType(pool, 'lore', 10_000, {
      ...base,
      countTokens: () => {
        throw new Error('tokenizer must not be consulted when tokens are captured')
      },
      // 0, not a non-zero stand-in: a `captured || countTokens(...)` mutant
      // would fall through to the throwing tokenizer on exactly this value.
      capturedTokens: new Map([['lo_a', 0]]),
    })

    expect(out.traces[0].tokensEstimated).toBe(0)
  })

  it('lets a captured count that exceeds the budget drop the row, not just report it', () => {
    const pool = [candidate({ id: 'lo_a', kind: 'lore', sims: [0.9, 0.9, 0.9] })]

    const out = rankPerType(pool, 'lore', 10_000, {
      ...base,
      capturedTokens: new Map([['lo_a', 10_001]]),
    })

    expect(out.traces[0].dropReason).toBe('candidate_too_large')
  })
})

describe('blend with absent query vectors', () => {
  it('renormalizes over present slots and distinguishes a null slot from a zero one', () => {
    const out = rankPerType(
      [
        candidate({ id: 'absent', sims: [0.8, null, null] }),
        candidate({ id: 'zero', sims: [0.8, 0, 0], vector: v(0, 1, 0) }),
      ],
      'happenings',
      10_000,
      base,
    )

    const byId = new Map(out.traces.map((t) => [t.id, t]))
    // Only Q1 is present, so the blend renormalizes to sim_q1 itself.
    expect(byId.get('absent')?.simBlend).toBeCloseTo(0.8, 10)
    // All three present: 0.8*0.35 renormalized over the full weight total.
    expect(byId.get('zero')?.simBlend).toBeCloseTo((0.8 * 0.35) / (0.35 + 0.35 + 0.3), 10)
    expect(byId.get('absent')?.simQ2).toBeNull()
    expect(byId.get('zero')?.simQ2).toBe(0)
  })
})

/** What the M3.5 simulator calls; the guarded surface is their value closure. */
const PURE_ENTRIES = ['ranker.ts', 'queries.ts']

// `import type` is erased at build, so only value imports pull the graph in.
const valueSource = (file: string): string =>
  readFileSync(`lib/retrieval/${file}`, 'utf8').replace(/^import type .*$/gm, '')

/**
 * Walks relative value imports from the entry points. Derived rather than
 * listed: a hand-maintained list goes stale silently the moment someone adds an
 * import, which is exactly how `name-index.ts` ended up inside the closure and
 * outside the guard.
 */
function pureClosure(): string[] {
  const seen = new Set<string>()
  const queue = [...PURE_ENTRIES]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const [, specifier] of valueSource(file).matchAll(/from '\.\/([\w-]+)'/g)) {
      queue.push(`${specifier}.ts`)
    }
  }
  return [...seen].sort()
}

describe('C4 — ranker purity', () => {
  const closure = pureClosure()

  // A walker that silently resolved nothing would make every case below pass
  // vacuously, so pin the files the closure is known to reach.
  it('reaches the modules the ranker and query stack actually pull in', () => {
    expect(closure).toEqual(
      expect.arrayContaining(['ranker.ts', 'mmr.ts', 'vector.ts', 'queries.ts', 'name-index.ts']),
    )
  })

  it.each(pureClosure())('%s imports nothing from lib/stores or lib/db', (file) => {
    // Path prefix, not exact specifier — a deep import like
    // '@/lib/db/runtime/exec' pulls in the same graph.
    expect(valueSource(file)).not.toMatch(/@\/lib\/(db|stores)/)
  })

  // The replay contract is determinism, which a DB import is only one way to
  // break. These are the others, and none is import-shaped: the previous
  // `queryAll|runInTransaction|drizzle` scan caught none of them, while
  // rejecting `name-index.ts` for naming its injected query parameter.
  it.each(pureClosure())('%s reads no ambient nondeterminism', (file) => {
    expect(valueSource(file)).not.toMatch(/\bDate\.|new Date\(|Math\.random|performance\./)
    expect(valueSource(file)).not.toMatch(/\bIntl\.|toLocale[A-Z]/)
  })
})

describe('replay-facing trace fields', () => {
  it('traces the clamped chaptersOld the decay exponent read', () => {
    const out = rankPerType(
      [candidate({ id: 'hap_1', chaptersOld: -3 })],
      'happenings',
      10_000,
      base,
    )

    // Clamped — a raw -3 would have flipped decay into growth, and a replay
    // recomputing from -3 would not reproduce this row's recency_factor.
    expect(out.traces[0].chaptersOld).toBe(0)
  })

  it('traces commonKnowledge, which pin_signal 0 cannot be distinguished from', () => {
    const out = rankPerType(
      [
        candidate({ id: 'hap_common', chaptersOld: 2, commonKnowledge: true }),
        candidate({ id: 'hap_plain', chaptersOld: 2, commonKnowledge: false }),
      ],
      'happenings',
      10_000,
      base,
    )

    const byId = new Map(out.traces.map((t) => [t.id, t]))
    expect(byId.get('hap_common')?.commonKnowledge).toBe(true)
    expect(byId.get('hap_plain')?.commonKnowledge).toBe(false)
    // Both carry pin_signal 0, which is exactly why the flag has to be captured.
    expect(byId.get('hap_common')?.pinSignal).toBe(0)
    expect(byId.get('hap_plain')?.pinSignal).toBe(0)
    expect(byId.get('hap_common')?.recencyFactor).toBe(1)
    expect(byId.get('hap_plain')?.recencyFactor).toBeLessThan(1)
    expect(byId.get('hap_plain')?.chaptersOld).toBe(2)
  })

  it('omits commonKnowledge entirely on a kind that has no such field', () => {
    const out = rankPerType([candidate({ id: 'ent_1', kind: 'entity' })], 'entities', 10_000, base)
    expect('commonKnowledge' in out.traces[0]).toBe(false)
  })

  it('traces renderedText for kept rows only, and exposes the whole pool', () => {
    const pool = [
      candidate({ id: 'hap_b', vector: v(0, 1, 0), sims: [0.4, 0.4, 0.4] }),
      candidate({
        id: 'hap_a',
        sims: [0.9, 0.9, 0.9],
        renderedText: 'The bridge fell during the third night of the siege.',
      }),
    ]

    const out = rankPerType(pool, 'happenings', 10_000, {
      ...base,
      params: { ...RANKER_DEFAULTS, preFilterTopN: 1 },
    })

    const kept = out.traces.filter((t) => t.dropReason !== 'pre_filtered')
    const dropped = out.traces.filter((t) => t.dropReason === 'pre_filtered')
    expect(kept[0].renderedText).toBe('The bridge fell during the third night of the siege.')
    expect(dropped[0].renderedText).toBeNull()
    expect(out.pool.map((c) => c.id)).toEqual(['hap_b', 'hap_a'])
  })
})
