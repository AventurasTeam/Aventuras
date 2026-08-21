import { rmSync } from 'node:fs'
import { type DatabaseSync } from 'node:sqlite'

import { gzipSync } from 'fflate'
import { describe, it } from 'vitest'

import { STORY_SETTINGS_DEFAULTS } from '@/lib/db'
import { buildCapturePayload, type CapturePayloadInput } from '@/lib/probe'
import { RANKER_DEFAULTS, runRetrieval, type RetrievalOutcome } from '@/lib/retrieval'

import { build, median, passInputs, TOP_SCALE } from './fixture'

/**
 * Prices one probe capture against the same fixture retrieval-cost.test.ts uses,
 * so probe.md → Capture cost can be re-derived rather than re-estimated. Asserts
 * nothing: it reports.
 *
 * The capture write is in-transaction with the ranker output, so every
 * millisecond here is additive to per-turn latency. The three stages are split
 * because they answer different questions: assembly is what the payload shape
 * costs, encode and gzip are what its SIZE costs, and deep mode moves only the
 * second pair.
 *
 * The row insert is excluded from every figure here, the combined one included —
 * it is one statement against a table with no index beyond its PK, and it is the
 * same statement in both modes.
 */
const SAMPLES = 7
const WARMUP = 2

const timeIt = (fn: () => unknown): number => {
  const startedAt = performance.now()
  fn()
  return performance.now() - startedAt
}

const medianOf = (fn: () => unknown): number => {
  const samples: number[] = []
  for (let i = 0; i < WARMUP + SAMPLES; i += 1) {
    const ms = timeIt(fn)
    if (i >= WARMUP) samples.push(ms)
  }
  return median(samples)
}

const kb = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)}MB` : `${Math.round(bytes / 1000)}KB`

function captureInputFor(outcome: RetrievalOutcome, mode: 'light' | 'deep'): CapturePayloadInput {
  return {
    branchId: 'br_bench',
    targetEntryId: 'ent_0000000',
    chapterId: null,
    capturedAt: Date.now(),
    embeddingModelId: 'bench-model',
    mode,
    params: RANKER_DEFAULTS,
    settings: {
      retrievalBudgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
      fullChapterInBuffer: STORY_SETTINGS_DEFAULTS.fullChapterInBuffer,
      partialChapterBuffer: STORY_SETTINGS_DEFAULTS.partialChapterBuffer,
      protectedBuffer: STORY_SETTINGS_DEFAULTS.protectedBuffer,
    },
    // One scalar, so it moves neither the payload size nor the assemble cost
    // this harness reports; a representative value keeps the shape honest.
    promptBufferTokens: 2_400,
    outcome,
  }
}

describe('probe capture cost', () => {
  for (const dim of [384, 768]) {
    it(`dim ${dim} — ${TOP_SCALE.label}`, async () => {
      let sqlite: DatabaseSync | undefined
      let dir: string | undefined
      try {
        const fixture = build(TOP_SCALE, dim)
        sqlite = fixture.sqlite
        dir = fixture.dir

        const { deps, params } = passInputs(fixture, dim)
        const outcome = await runRetrieval(deps as never, params)
        if (!outcome.ok)
          throw new Error(
            `pass failed: ${outcome.cancelled ? 'cancelled' : outcome.failure.detail}`,
          )
        const poolSize = Object.values(outcome.bundles).reduce((n, b) => n + b.funnel.poolSize, 0)

        for (const mode of ['light', 'deep'] as const) {
          const input = captureInputFor(outcome, mode)
          const encode = (): Uint8Array =>
            new TextEncoder().encode(JSON.stringify(buildCapturePayload(input)))

          const assembleMs = medianOf(() => buildCapturePayload(input))
          const payload = buildCapturePayload(input)
          const encodeMs = medianOf(() => new TextEncoder().encode(JSON.stringify(payload)))
          const json = encode()
          const gzipMs = medianOf(() => gzipSync(json))
          // Rebuilds and re-encodes per sample rather than gzipping the one
          // buffer above: the three stages measured in isolation each reuse a
          // warm input the write path never gets, so summing them understates.
          const combinedMs = medianOf(() => gzipSync(encode()))
          const gzipped = gzipSync(json)

          process.stdout.write(
            `  dim=${dim} ${mode.padEnd(5)} pool=${poolSize}  ` +
              `assemble=${assembleMs.toFixed(1)}ms  encode=${encodeMs.toFixed(1)}ms  ` +
              `gzip=${gzipMs.toFixed(1)}ms  assemble+encode+gzip=${combinedMs.toFixed(1)}ms  ` +
              `raw=${kb(json.length)}  gzipped=${kb(gzipped.length)}\n`,
          )
        }
      } finally {
        try {
          sqlite?.close()
        } finally {
          if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
        }
      }
    }, 300_000)
  }
})
