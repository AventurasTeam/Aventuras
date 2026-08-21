import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { CAPTURE_VERSION, type ProbeCapturePayload } from '@/lib/db'
import { RANKER_DEFAULTS, TOKENIZER_IDENTITY } from '@/lib/retrieval'

import {
  CaptureDecodeError,
  CaptureEncodeError,
  compressPayload,
  decompressPayload,
} from './compress'

// Capture-shaped rather than a toy object: gzip's ~18-byte header exceeds the
// gain on a short string (a 109-byte payload deflates to 111), so a tiny fixture
// would assert the opposite of what real captures do. 40 candidate rows is the
// order a single type's pool reaches.
const emptyFunnel = (typeBudget: number) => ({
  pool_size: 0,
  pre_filtered_size: 0,
  selected_count: 0,
  tokens_used: 0,
  type_budget: typeBudget,
})

const capturePayload = (): ProbeCapturePayload => ({
  capture_version: CAPTURE_VERSION,
  branch_id: 'br_1',
  target_entry_id: 'entry_1',
  chapter_id: 'chap_1',
  captured_at: 1_700_000_000_000,
  capture_mode: 'light',
  embedding_model_id: 'text-embedding-3-small',
  tokenizer: TOKENIZER_IDENTITY,
  params: {
    ranker: RANKER_DEFAULTS,
    retrievalBudgets: { entities: 800, lore: 400, happenings: 600, threads: 300, chapters: 200 },
    fullChapterInBuffer: true,
    partialChapterBuffer: 500,
    protectedBuffer: 200,
  },
  queries: [
    { text: 'What does the party do next?', token_count: 6, source: 'user_action' },
    { text: 'Summarize recent events.', token_count: 4, source: 'structural_digest' },
    {
      text: 'The bridge fell during the third night of the siege.',
      token_count: 11,
      source: 'prose_extract',
      sentence_scores: [0.9, 0.6, 0.4],
    },
  ],
  // Three bands mirror rankPerType (lib/retrieval/ranker.ts:196-211): a
  // pre-filtered row never reaches MMR, so only it gets null text/tokens.
  pools: {
    entities: [],
    lore: [],
    happenings: Array.from({ length: 40 }, (_, i) => {
      const isSelected = i < 5
      const isPreFiltered = i >= 20

      return {
        target_kind: 'happening',
        target_id: `hap_${i}`,
        // Non-ASCII on every row: `size` must be UTF-8 BYTES, and the gap
        // against a UTF-16-length substitute must be wide enough to fail
        // under mutation.
        display_name: `Most přes Vltavu ${i}`,
        display_text: isPreFiltered ? null : 'The bridge fell during the third night of the siege.',
        sim_q1: 0.5,
        sim_q2: 0.4,
        // Row 0 is the top selected row (not_dropped, mmr_rank 0) and
        // carries a real sim_q3: null — the ranker's own "this query
        // produced no vector" case.
        sim_q3: i === 0 ? null : 0.3,
        sim_blend: 0.45,
        recency_factor: 1,
        pin_signal: 0,
        chapters_old: 0,
        // Happenings always carry this key, true or false; i === 0 gives the
        // true branch runtime coverage.
        common_knowledge: i === 0,
        kw_boost_value: 0,
        chapter_boost_applied: false,
        bypass_triggered: false,
        final_score: 0.45,
        mmr_score: isPreFiltered ? null : 0.3375,
        mmr_rank: isPreFiltered ? null : i,
        selected: isSelected,
        drop_reason: isSelected ? 'not_dropped' : isPreFiltered ? 'pre_filtered' : 'over_budget',
        tokens_estimated: isPreFiltered ? null : 14,
        embedding_stale: false,
      }
    }),
    threads: [],
    chapters: [],
  },
  funnels: {
    entities: emptyFunnel(800),
    lore: emptyFunnel(400),
    happenings: {
      pool_size: 40,
      pre_filtered_size: 20,
      selected_count: 5,
      tokens_used: 70,
      type_budget: 600,
    },
    threads: emptyFunnel(300),
    chapters: emptyFunnel(200),
  },
  structural_floor: [{ target_kind: 'chapter', target_id: 'chap_1', tokens: 120 }],
  prompt_buffer_tokens: 1840,
  stale_counts: { entities: 0, lore: 0, happenings: 0, threads: 0, chapters: 0 },
  failure_reason: null,
})

describe('compressPayload', () => {
  it('round-trips a payload and reports the pre-compression size', () => {
    const payload = capturePayload()

    const packed = compressPayload(payload)

    expect(packed.uncompressedSize).toBe(new TextEncoder().encode(JSON.stringify(payload)).length)
    expect(decompressPayload(packed.bytes)).toEqual(payload)
  })

  it('compresses a capture-shaped payload by an order of magnitude', () => {
    const packed = compressPayload(capturePayload())

    // Measured at ~0.07 on this fixture; 0.2 leaves room for fflate to differ
    // from zlib without letting a no-op "compressor" through. capture_mode
    // stays 'light' here on purpose: a deep capture's per-row vectors push
    // the ratio to ~0.38, which this bound does not describe.
    expect(packed.bytes.byteLength / packed.uncompressedSize).toBeLessThan(0.2)
  })

  it('round-trips a vector array element-wise', () => {
    const vector = [0.12345, -0.6789, 1, 0, -1]
    const payload: ProbeCapturePayload = {
      ...capturePayload(),
      capture_mode: 'deep',
      pools: {
        ...capturePayload().pools,
        happenings: [{ ...capturePayload().pools.happenings[0], vector }],
      },
    }

    const decoded = decompressPayload(compressPayload(payload).bytes) as ProbeCapturePayload

    expect(decoded.pools.happenings[0].vector).toEqual(vector)
  })

  it('preserves a null distinctly from an absent key', () => {
    // sim_q* is nullable, and JSON.stringify drops `undefined` while keeping
    // `null` — the capture's whole null-vs-zero distinction rides on that
    // surviving the round trip. The top selected row (i === 0) carries a
    // real sim_q3: null.
    const payload = capturePayload()

    const decoded = decompressPayload(compressPayload(payload).bytes) as ProbeCapturePayload
    const topSelected = decoded.pools.happenings[0]
    const preFiltered = decoded.pools.happenings[39]

    expect(topSelected.sim_q3).toBeNull()
    expect(topSelected.common_knowledge).toBe(true)
    // A genuinely pre-filtered row (never reached MMR) carries null across
    // all three fields at once — the combination costTokens never produces.
    expect(preFiltered.drop_reason).toBe('pre_filtered')
    expect(preFiltered.display_text).toBeNull()
    expect(preFiltered.tokens_estimated).toBeNull()
    expect(preFiltered.mmr_rank).toBeNull()
    // No producer emits sentence_scores for the action query, so the key
    // itself — not just its value — must survive as absent.
    expect('sentence_scores' in decoded.queries[0]).toBe(false)
  })

  it('throws a named error when the payload cannot be JSON-encoded', () => {
    // BigInt is not hypothetical: retrieval source rows can arrive as bigints.
    // ProbeCapturePayload forbids one at the type level, so the runtime guard
    // this proves needs an out-of-band cast to construct one at all.
    const payload = { ...capturePayload(), chapter_id: 10n } as unknown as ProbeCapturePayload

    expect(() => compressPayload(payload)).toThrow(CaptureEncodeError)
  })

  it('throws a named error on bytes that are not gzip', () => {
    expect(() => decompressPayload(new Uint8Array([1, 2, 3]))).toThrow(CaptureDecodeError)
  })

  it('throws a named error on valid gzip carrying invalid JSON', () => {
    // The other error test fails at gunzip, so without this one the JSON.parse
    // catch is unreachable.
    const truncated = gzipSync(new TextEncoder().encode('{"a": '))

    expect(() => decompressPayload(truncated)).toThrow(CaptureDecodeError)
  })
})
