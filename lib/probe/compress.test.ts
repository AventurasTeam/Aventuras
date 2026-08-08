import { describe, expect, it } from 'vitest'

import { compressPayload, decompressPayload } from './compress'

// Capture-shaped rather than a toy object: gzip's ~18-byte header exceeds the
// gain on a short string (a 109-byte payload deflates to 111), so a tiny fixture
// would assert the opposite of what real captures do. 40 candidate rows is the
// order a single type's pool reaches.
const capturePayload = () => ({
  branch_id: 'br_1',
  pools: {
    happenings: Array.from({ length: 40 }, (_, i) => ({
      target_kind: 'happening',
      target_id: `hap_${i}`,
      display_name: 'The bridge fell',
      display_text: 'The bridge fell during the third night of the siege.',
      sim_q1: 0.5,
      sim_q2: 0.4,
      sim_q3: null,
      sim_blend: 0.45,
      recency_factor: 1,
      pin_signal: 0,
      chapters_old: 0,
      kw_boost_value: 0,
      chapter_boost_applied: false,
      bypass_triggered: false,
      final_score: 0.45,
      mmr_rank: i,
      selected: i < 5,
      drop_reason: i < 5 ? 'not_dropped' : 'over_budget',
      tokens_estimated: 14,
      embedding_stale: false,
    })),
  },
})

describe('compressPayload', () => {
  it('round-trips a payload and reports the pre-compression size', () => {
    const payload = capturePayload()

    const packed = compressPayload(payload)

    expect(packed.size).toBe(new TextEncoder().encode(JSON.stringify(payload)).length)
    expect(decompressPayload(packed.bytes)).toEqual(payload)
  })

  it('compresses a capture-shaped payload by an order of magnitude', () => {
    const packed = compressPayload(capturePayload())

    // Measured at ~0.035 on this fixture; 0.2 leaves room for fflate to differ
    // from zlib without letting a no-op "compressor" through.
    expect(packed.bytes.byteLength / packed.size).toBeLessThan(0.2)
  })

  it('preserves a null distinctly from an absent key', () => {
    // sim_q* is nullable as of Task 1, and JSON.stringify drops `undefined`
    // while keeping `null` — the capture's whole null-vs-zero distinction rides
    // on that surviving the round trip.
    const packed = compressPayload({ sim_q3: null, sim_q1: 0 })

    expect(decompressPayload(packed.bytes)).toEqual({ sim_q3: null, sim_q1: 0 })
  })

  it('throws a named error on bytes that are not gzip', () => {
    expect(() => decompressPayload(new Uint8Array([1, 2, 3]))).toThrow(/probe capture/i)
  })
})
