import { describe, expect, it } from 'vitest'

import {
  countTokens,
  rankPerType,
  RANKER_DEFAULTS,
  type Candidate,
  type DropReason,
  type RankedType,
  type RankerParams,
  type RetrievalType,
} from '@/lib/retrieval'
import { retrievalSuccess } from '@/lib/retrieval/__tests__/outcome'
import { queryAllOf } from '@/lib/retrieval/__tests__/query-all'

import { captureInput, queryStack, seededDb, settings } from './__tests__/fixtures'
import { replayType } from './__tests__/replay'
import { capturesForStoryQuery, decodeCapture } from './read'
import { writeProbeCapture } from './writer'

const unit = (...xs: number[]): Float32Array => {
  const n = Math.hypot(...xs)
  return Float32Array.from(xs, (x) => x / n)
}

// One dominant axis per row over a rotated tail of small components: distinct,
// so MMR's diversity term varies per round rather than staying constant and
// letting the replay agree for the wrong reason; non-negative, so no pairwise
// cosine can come out negative and *raise* an MMR score above the floor.
const OFF_AXIS = [0.05, 0.12, 0.2, 0.08, 0.15, 0.1, 0.18, 0.06]
const AXES = OFF_AXIS.length
const VECTORS = Array.from({ length: AXES }, (_, i) =>
  unit(...Array.from({ length: AXES }, (_, j) => (i === j ? 1 : OFF_AXIS[(i * 3 + j) % AXES]))),
)

const PROSE = [
  'The lantern guild sealed the drowned archive the night the tide came in early.',
  'Mira counted the tide marks twice before she trusted the number she had written.',
  'A courier reached the west gate at dusk carrying nothing but an empty seal case.',
  'The bridge fell on the third night of the siege and took the gatehouse with it.',
  'Halvard traded the ledger for passage and never said what the ledger had held.',
  'Salt water reached the second shelf, so the older rolls were moved to the gallery.',
  'Two apprentices swore the archive door had been bolted from the inside all morning.',
  'The guild reads the tide before it reads anything else, and it always has.',
]

// Costs more than the saturated budget on its own, so that state exercises
// candidate_too_large alongside over_budget. Prose, not a repeated character:
// the real tokenizer is what prices these rows.
const LONG_PROSE = [
  'The inventory of the drowned archive runs to four hundred rolls, of which the',
  'guild admits to sixty, and the rest are entered under a name nobody at the',
  'waterline will say aloud. Mira read the whole of it once, in a single night,',
  'and afterwards she stopped signing the tide book with her own hand. The gallery',
  'was flooded again by spring, which the guild recorded as weather.',
].join(' ')

const CHAPTER_ID = 'ch_closed'
const BOOSTED_ENTRY_IDS = new Set(['ent_h0', 'ent_h4'])

type ScoredFields =
  | 'renderedText'
  | 'sims'
  | 'chaptersOld'
  | 'pinSignal'
  | 'keywordHits'
  | 'embeddingStale'

type HappeningSpec = Pick<
  Extract<Candidate, { kind: 'happening' }>,
  ScoredFields | 'commonKnowledge' | 'occurredAtEntryId'
>

const happening = (n: number, spec: HappeningSpec): Candidate => ({
  kind: 'happening',
  id: `hp_${n}`,
  displayName: `Happening ${n}`,
  vector: VECTORS[n],
  awarenessIds: [`aw_${n}`],
  ...spec,
})

type LoreSpec = Pick<Exclude<Candidate, { kind: 'happening' }>, ScoredFields>

const lore = (n: number, spec: LoreSpec): Candidate => ({
  kind: 'lore',
  id: `lo_${n}`,
  displayName: `Lore ${n}`,
  vector: VECTORS[n],
  ...spec,
})

const HAPPENINGS: readonly Candidate[] = [
  happening(0, {
    renderedText: PROSE[0],
    sims: [0.88, 0.83, 0.79],
    chaptersOld: 0,
    pinSignal: 0,
    keywordHits: ['tide'],
    commonKnowledge: false,
    occurredAtEntryId: 'ent_h0',
    embeddingStale: false,
  }),
  happening(1, {
    renderedText: PROSE[1],
    sims: [0.81, 0.76, 0.71],
    chaptersOld: 2,
    pinSignal: 0.35,
    keywordHits: [],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
  happening(2, {
    renderedText: PROSE[2],
    sims: [0.74, 0.69, 0.66],
    chaptersOld: 4,
    pinSignal: 0,
    keywordHits: ['gate'],
    commonKnowledge: true,
    occurredAtEntryId: null,
    embeddingStale: true,
  }),
  happening(3, {
    renderedText: PROSE[3],
    sims: [0.71, 0.64, 0.61],
    chaptersOld: 3,
    pinSignal: 0.55,
    keywordHits: [],
    commonKnowledge: false,
    // Set but outside the matched chapter: the boost must come from membership,
    // not from the field being non-null.
    occurredAtEntryId: 'ent_h3',
    embeddingStale: false,
  }),
  happening(4, {
    renderedText: LONG_PROSE,
    sims: [0.68, 0.62, 0.57],
    chaptersOld: 5,
    pinSignal: 0.15,
    keywordHits: ['seal'],
    commonKnowledge: false,
    occurredAtEntryId: 'ent_h4',
    embeddingStale: false,
  }),
  happening(5, {
    renderedText: PROSE[5],
    sims: [0.64, 0.59, 0.54],
    chaptersOld: 6,
    pinSignal: 0,
    keywordHits: [],
    commonKnowledge: true,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
  happening(6, {
    renderedText: PROSE[6],
    sims: [0.61, 0.55, 0.51],
    chaptersOld: 1,
    pinSignal: 0.25,
    keywordHits: [],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: true,
  }),
  happening(7, {
    renderedText: PROSE[7],
    sims: [0.62, 0.56, 0.51],
    chaptersOld: 7,
    pinSignal: 0.05,
    keywordHits: ['ledger'],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
]

const REVIVABLE: readonly Candidate[] = [
  happening(0, {
    renderedText: PROSE[0],
    sims: [0.72, 0.68, 0.63],
    chaptersOld: 0,
    pinSignal: 0,
    keywordHits: ['tide'],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
  happening(1, {
    renderedText: PROSE[1],
    sims: [0.66, 0.61, 0.58],
    chaptersOld: 1,
    pinSignal: 0.2,
    keywordHits: [],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
  // Above tauRevive on similarity, but decayed far under the score floor: the
  // only row a bypass can seat once belowFloor has tripped.
  happening(2, {
    renderedText: PROSE[2],
    sims: [0.96, 0.91, 0.86],
    chaptersOld: 45,
    pinSignal: 0,
    keywordHits: [],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
  happening(3, {
    renderedText: PROSE[3],
    sims: [0.19, 0.15, 0.12],
    chaptersOld: 2,
    pinSignal: 0.1,
    keywordHits: [],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
  happening(4, {
    renderedText: PROSE[4],
    sims: [0.14, 0.11, 0.08],
    chaptersOld: 3,
    pinSignal: 0.3,
    keywordHits: [],
    commonKnowledge: false,
    occurredAtEntryId: null,
    embeddingStale: false,
  }),
]

// Q3 produced no vector this turn, so its slot is null on every row — a per-row
// null is unreachable, since a missing query vector misses the whole pool.
const LORE: readonly Candidate[] = [
  lore(0, {
    renderedText: PROSE[0],
    sims: [0.82, 0.76, null],
    chaptersOld: 0,
    pinSignal: 0.9,
    keywordHits: [],
    embeddingStale: false,
  }),
  lore(1, {
    renderedText: PROSE[1],
    sims: [0.74, 0.7, null],
    chaptersOld: 0,
    pinSignal: 0.4,
    keywordHits: ['ledger'],
    embeddingStale: false,
  }),
  lore(2, {
    renderedText: PROSE[2],
    sims: [0.68, 0.6, null],
    chaptersOld: 0,
    pinSignal: 0,
    keywordHits: [],
    embeddingStale: true,
  }),
  lore(3, {
    renderedText: PROSE[3],
    sims: [0.6, 0.54, null],
    chaptersOld: 0,
    pinSignal: 0.65,
    keywordHits: [],
    embeddingStale: false,
  }),
  lore(4, {
    renderedText: PROSE[4],
    sims: [0.52, 0.44, null],
    chaptersOld: 0,
    pinSignal: 0.2,
    keywordHits: ['tide'],
    embeddingStale: false,
  }),
]

type ParityState = {
  type: RetrievalType
  pool: readonly Candidate[]
  budget: number
  params: RankerParams
  /** What this state is here to exercise; asserted, so an edit cannot neuter it. */
  marks: { dropReasons: DropReason[]; revived: boolean }
}

const STATES: Record<string, ParityState> = {
  normal: {
    type: 'happenings',
    pool: HAPPENINGS,
    budget: 10_000,
    params: RANKER_DEFAULTS,
    marks: { dropReasons: ['not_dropped'], revived: false },
  },
  saturated: {
    type: 'happenings',
    pool: HAPPENINGS,
    budget: 60,
    params: RANKER_DEFAULTS,
    marks: {
      dropReasons: ['candidate_too_large', 'not_dropped', 'over_budget'],
      revived: false,
    },
  },
  bypassed: {
    type: 'happenings',
    pool: REVIVABLE,
    budget: 10_000,
    params: RANKER_DEFAULTS,
    marks: { dropReasons: ['below_threshold', 'not_dropped'], revived: true },
  },
  'pre-filtered': {
    type: 'happenings',
    pool: HAPPENINGS,
    budget: 10_000,
    params: { ...RANKER_DEFAULTS, preFilterTopN: 4 },
    marks: { dropReasons: ['not_dropped', 'pre_filtered'], revived: false },
  },
  'pin-boosted': {
    type: 'lore',
    pool: LORE,
    budget: 10_000,
    params: RANKER_DEFAULTS,
    marks: { dropReasons: ['not_dropped'], revived: false },
  },
}

const marksOf = (bundle: RankedType): ParityState['marks'] => {
  // Ranked traces are in MMR order and belowFloor is sticky, so anything seated
  // at or after the first below_threshold drop was seated by the bypass.
  const firstDrop = bundle.traces.findIndex((t) => t.dropReason === 'below_threshold')
  return {
    dropReasons: [...new Set(bundle.traces.map((t) => t.dropReason))].sort(),
    revived: firstDrop !== -1 && bundle.traces.slice(firstDrop).some((t) => t.selected),
  }
}

const rankProd = (state: ParityState): RankedType =>
  rankPerType(state.pool, state.type, state.budget, {
    params: state.params,
    chapterRanges: new Map([[CHAPTER_ID, BOOSTED_ENTRY_IDS]]),
    matchedChapterIds: new Set([CHAPTER_ID]),
    countTokens,
  })

/** Round-trips the bundle through the real write/read path, gzip and all. */
async function storedPayload(state: ParityState, prod: RankedType) {
  const { sqlite, runInTransaction } = await seededDb()
  const written = await writeProbeCapture(
    { runInTransaction },
    captureInput({
      id: 'pc_parity',
      mode: 'deep',
      params: state.params,
      settings: {
        ...settings,
        retrievalBudgets: { ...settings.retrievalBudgets, [state.type]: state.budget },
      },
      outcome: retrievalSuccess({ bundles: { [state.type]: prod }, queries: queryStack() }),
    }),
  )
  // The writer swallows its own failures, so an unasserted 'failed' would leave
  // nothing to replay and every comparison below would compare two empties.
  expect(written).toBe('written')

  const q = capturesForStoryQuery('st_1')
  const [row] = await queryAllOf(sqlite)(q.sql, q.params)
  return decodeCapture(row).payload
}

describe.each(Object.entries(STATES))('parity — %s', (_name, state) => {
  it('replays a stored capture to the same selection, funnel and traces', async () => {
    const prod = rankProd(state)
    expect(marksOf(prod)).toEqual(state.marks)

    const replayed = replayType(await storedPayload(state, prod), state.type)

    expect(replayed.selected.map((c) => c.id)).toEqual(prod.selected.map((c) => c.id))
    expect(replayed.funnel).toEqual(prod.funnel)
    expect(replayed.traces).toEqual(prod.traces)
  })
})

describe('replay recomputes rather than echoing', () => {
  it('reprices keyword hits when the captured ranker params change', async () => {
    const state = STATES.normal
    const payload = await storedPayload(state, rankProd(state))
    const retuned = {
      ...payload,
      params: { ...payload.params, ranker: { ...payload.params.ranker, kwBoost: 0.6 } },
    }
    const captured = new Map(payload.pools.happenings.map((r) => [r.target_id, r.final_score]))

    const boosted = replayType(retuned, 'happenings').traces.filter((t) => t.kwBoostValue > 0)

    expect(boosted).not.toHaveLength(0)
    // Without this, an id that missed the lookup would make the comparison below
    // pass on number-vs-undefined instead of on a repriced score.
    expect(boosted.map((t) => captured.get(t.id))).not.toContain(undefined)
    expect(boosted.map((t) => t.finalScore)).not.toEqual(boosted.map((t) => captured.get(t.id)))
  })

  it('rereads common_knowledge rather than trusting the captured recency factor', async () => {
    const state = STATES.normal
    const payload = await storedPayload(state, rankProd(state))
    const target = payload.pools.happenings.find((r) => r.common_knowledge)
    const tampered = {
      ...payload,
      pools: {
        ...payload.pools,
        happenings: payload.pools.happenings.map((r) =>
          r === target ? { ...r, common_knowledge: false } : r,
        ),
      },
    }

    const replayed = replayType(tampered, 'happenings')

    expect(target?.recency_factor).toBe(1)
    expect(replayed.traces.find((t) => t.id === target?.target_id)?.recencyFactor).not.toBe(1)
  })
})

describe('replayType', () => {
  it('refuses a light capture, which stores no vector for MMR to read', async () => {
    const state = STATES.normal
    const prod = rankProd(state)
    const { runInTransaction, sqlite } = await seededDb()
    await writeProbeCapture(
      { runInTransaction },
      captureInput({
        id: 'pc_light',
        mode: 'light',
        outcome: retrievalSuccess({ bundles: { happenings: prod }, queries: queryStack() }),
      }),
    )
    const q = capturesForStoryQuery('st_1')
    const [row] = await queryAllOf(sqlite)(q.sql, q.params)

    expect(() => replayType(decodeCapture(row).payload, 'happenings')).toThrow(/deep capture/)
  })
})
