import { gzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import type { ProbeCapturePayload } from '@/lib/db'
import { RANKER_DEFAULTS } from '@/lib/retrieval'

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
const capturePayload = (): ProbeCapturePayload => ({
  branch_id: 'br_1',
  target_entry_id: 'entry_1',
  chapter_id: 'chap_1',
  captured_at: 1_700_000_000_000,
  capture_mode: 'deep',
  embedding_model_id: 'text-embedding-3-small',
  tokenizer: { encoding: 'cl100k_base', version: '1' },
  params: {
    ranker: RANKER_DEFAULTS,
    retrievalBudgets: { entities: 800, lore: 400, happenings: 600, threads: 300, chapters: 200 },
    fullChapterInBuffer: true,
    partialChapterBuffer: 500,
    protectedBuffer: 200,
  },
  queries: [
    { text: 'What does the party do next?', token_count: 6, source: 'action' },
    { text: 'Summarize recent events.', token_count: 4, source: 'digest' },
    {
      text: 'The bridge fell during the third night of the siege.',
      token_count: 11,
      source: 'prose',
      sentence_scores: [0.9, 0.6, 0.4],
    },
  ],
  pools: {
    happenings: Array.from({ length: 40 }, (_, i) => ({
      target_kind: 'happening',
      target_id: `hap_${i}`,
      // Non-ASCII on purpose: `size` must be UTF-8 BYTES, and an all-ASCII
      // fixture cannot tell `TextEncoder().encode(s).length` from `s.length`.
      // Paired with a null sim_q3 on the same row so null-preservation rides
      // on this fixture rather than a separate toy object.
      display_name: i === 0 ? 'Most přes Vltavu' : `Happening ${i}`,
      display_text: i < 5 ? 'The bridge fell during the third night of the siege.' : null,
      sim_q1: 0.5,
      sim_q2: 0.4,
      sim_q3: i === 0 ? null : 0.3,
      sim_blend: 0.45,
      recency_factor: 1,
      pin_signal: 0,
      chapters_old: 0,
      kw_boost_value: 0,
      chapter_boost_applied: false,
      bypass_triggered: false,
      final_score: 0.45,
      mmr_rank: i < 5 ? i : null,
      selected: i < 5,
      drop_reason: i < 5 ? 'not_dropped' : 'over_budget',
      tokens_estimated: i < 5 ? 14 : null,
      embedding_stale: false,
    })),
  },
  funnels: {
    happenings: {
      pool_size: 40,
      pre_filtered_size: 35,
      selected_count: 5,
      tokens_used: 70,
      type_budget: 600,
    },
  },
  structural_floor: [{ target_kind: 'chapter', target_id: 'chap_1', tokens: 120 }],
  stale_counts: { happenings: 0 },
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

    // Measured at ~0.073 on this fixture; 0.2 leaves room for fflate to differ
    // from zlib without letting a no-op "compressor" through.
    expect(packed.bytes.byteLength / packed.uncompressedSize).toBeLessThan(0.2)
  })

  it('preserves a null distinctly from an absent key', () => {
    // sim_q* is nullable, and JSON.stringify drops `undefined` while keeping
    // `null` — the capture's whole null-vs-zero distinction rides on that
    // surviving the round trip. The pre-filtered row (i === 0) carries a real
    // sim_q3: null, so this reads it back off the main fixture rather than a
    // hand-rolled shape.
    const payload = capturePayload()

    const decoded = decompressPayload(compressPayload(payload).bytes) as ProbeCapturePayload
    const preFiltered = decoded.pools.happenings[0]

    expect(preFiltered.sim_q3).toBeNull()
    expect('common_knowledge' in preFiltered).toBe(false)
  })

  it('throws a named error when the payload cannot be JSON-encoded', () => {
    // BigInt is not hypothetical: retrieval source rows can arrive as bigints.
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
