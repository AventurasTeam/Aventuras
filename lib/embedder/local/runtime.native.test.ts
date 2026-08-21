import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Separate from runtime.test.ts: eslint resolves `./runtime` and `./runtime.native`
// to one module, so import/no-duplicates silently merges this into the web import.
import { BOUNDED_SIGNAL_EXPIRED } from '@/lib/abort'
import { logger } from '@/lib/diagnostics'

import { embedLocal } from './runtime.native'
import { EmbedderCallError, EmbedderCancelledError } from '../types'

const harness = vi.hoisted(() => ({
  runCalls: 0,
  onRun: undefined as (() => void) | undefined,
  // Keyed by text, not call index: reversing the loop's order must not still read as
  // correct. Unit vectors, so mean-pooling one token and normalizing returns them unchanged.
  directions: { a: [1, 0], b: [0, 1], c: [0, -1], w: [1, 0, 0] } as Record<string, number[]>,
  // Per-text width, so a mid-embed dim disagreement is expressible at all.
  widths: { w: 3 } as Record<string, number>,
}))

vi.mock('expo-file-system', () => {
  class Directory {}
  class File {
    readonly uri: string
    constructor(_parent: unknown, name: string) {
      this.uri = `file:///embedders/fake/${name}`
    }
    text(): Promise<string> {
      return Promise.resolve('{}')
    }
  }
  return { Directory, File, Paths: { document: 'file:///documents' } }
})

vi.mock('onnxruntime-react-native', () => ({
  InferenceSession: {
    create: () =>
      Promise.resolve({
        inputNames: ['input_ids', 'attention_mask'],
        outputNames: ['last_hidden_state'],
        run: (feeds: Record<string, { data: BigInt64Array }>) => {
          harness.runCalls++
          harness.onRun?.()
          // Hidden state is a function of this call's feeds, never of the call count.
          const text = String.fromCodePoint(Number(feeds.input_ids?.data[0] ?? 0))
          const width = harness.widths[text] ?? 2
          const direction = harness.directions[text] ?? Array.from({ length: width }, () => 0)
          return Promise.resolve({
            last_hidden_state: { dims: [1, 1, width], data: Float32Array.from(direction) },
          })
        },
      }),
  },
  Tensor: class {
    constructor(
      readonly type: string,
      readonly data: BigInt64Array,
      readonly dims: readonly number[],
    ) {}
  },
}))

vi.mock('@huggingface/transformers', () => ({
  // A transformers.js tokenizer instance is callable, so the constructor returns it.
  PreTrainedTokenizer: function PreTrainedTokenizer() {
    // One token per text, its id the text's code point; single-char texts keep that legible.
    return (text: string) => ({
      input_ids: { data: BigInt64Array.from([BigInt(text.codePointAt(0) ?? 0)]), dims: [1, 1] },
      attention_mask: { data: BigInt64Array.from([1n]), dims: [1, 1] },
    })
  },
}))

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection, got a resolved value')
    },
    (error: unknown) => error,
  )
}

beforeEach(() => {
  harness.runCalls = 0
  harness.onRun = undefined
})

// Inline restore skips on a failed assertion and leaves logger spied for the rest of the file.
afterEach(() => vi.restoreAllMocks())

describe('embedLocal (native)', () => {
  it('runs one inference per text and keeps their order', async () => {
    const result = await embedLocal('model-ordered', ['a', 'b', 'c'])

    expect(harness.runCalls).toBe(3)
    expect(result.dim).toBe(2)
    expect(result.vectors.map((vector) => Array.from(vector))).toEqual([
      [1, 0],
      [0, 1],
      [0, -1],
    ])
  })

  it('stops before the next text once the signal aborts', async () => {
    const controller = new AbortController()
    harness.onRun = () => controller.abort()

    const error = await rejectionOf(
      embedLocal('model-mid-abort', ['a', 'b', 'c'], controller.signal),
    )

    expect(error).toBeInstanceOf(EmbedderCancelledError)
    expect((error as Error).message).toBe('embed cancelled')
    expect(harness.runCalls).toBe(1)
  })

  // The loop's check runs before each text, so a one-text embed has no boundary left
  // for a cancel to land on: without the post-loop re-check it resolves as success.
  it('reports a cancel that lands during the only text', async () => {
    const controller = new AbortController()
    harness.onRun = () => controller.abort()

    const error = await rejectionOf(embedLocal('model-single-abort', ['a'], controller.signal))

    expect(error).toBeInstanceOf(EmbedderCancelledError)
    expect((error as Error).message).toBe('embed cancelled')
    expect(harness.runCalls).toBe(1)
  })

  it('runs no inference at all when the signal is already aborted', async () => {
    const error = await rejectionOf(embedLocal('model-pre-abort', ['a'], AbortSignal.abort()))

    expect(error).toBeInstanceOf(EmbedderCancelledError)
    expect((error as Error).message).toBe('embed cancelled')
    expect(harness.runCalls).toBe(0)
  })

  // A later disagreeing width would otherwise satisfy the facade's dim check while
  // describing none of the vectors ahead of it.
  it('fixes the width at the first vector and refuses a later disagreement', async () => {
    const error = await rejectionOf(embedLocal('model-mixed-dims', ['a', 'w']))

    expect(error).toBeInstanceOf(EmbedderCallError)
    expect((error as Error).message).toBe('embedding dim changed mid-embed: expected 2, got 3')
  })

  it('keeps the first width when every vector agrees', async () => {
    // Positive control: the guard above must not reject a well-formed embed.
    await expect(embedLocal('model-agreed', ['a', 'b'])).resolves.toMatchObject({ dim: 2 })
  })

  // Parity with the web runtime: expiry and cancel classify apart, not both as a cancel.
  it('reports a bounded-signal expiry as a timeout, not a cancel', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const controller = new AbortController()
    controller.abort(BOUNDED_SIGNAL_EXPIRED)

    const error = await rejectionOf(embedLocal('model-expired', ['a'], controller.signal))

    expect((error as Error).message).toBe('embed timed out')
    expect(errorLog).toHaveBeenCalledWith('embedder.local_runtime_failed', {
      kind: 'call',
      error: 'embed timed out',
    })
  })

  it('reports a user stop at debug, never as an embedder fault', async () => {
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const debugLog = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    const controller = new AbortController()
    controller.abort()

    const error = await rejectionOf(embedLocal('model-stopped', ['a'], controller.signal))

    expect((error as Error).message).toBe('embed cancelled')
    expect(debugLog).toHaveBeenCalledWith('embedder.local_embed_cancelled', {
      error: 'embed cancelled',
    })
    // A stop reaching the error channel renders a Switch embedder affordance unasked-for.
    expect(errorLog).not.toHaveBeenCalled()
  })
})
