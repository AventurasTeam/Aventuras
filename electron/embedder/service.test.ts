import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __setPipelineFactoryForTest,
  __setTokenizerFactoryForTest,
  countTokens,
  embed,
  evictPipeline,
  listInstalled,
} from './service'

const { USERDATA } = vi.hoisted(() => ({
  USERDATA: `${process.env.TMPDIR ?? '/tmp'}/ave-service-test-${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}`,
}))

vi.mock('electron', () => ({ app: { getPath: () => USERDATA } }))

const embeddersDir = join(USERDATA, 'embedders')

// The real pipeline object carries the tokenizer embed() re-encodes through to
// learn what was cut, so a stub that is only a function no longer stands in for it.
function stubPipeline(
  run: (texts: string[]) => Promise<{ tolist: () => number[][]; dims: number[] }>,
  tokenizer: { count: (text: string) => number; limit?: number } = { count: () => 1 },
) {
  const encode = (text: string) => ({ input_ids: { dims: [1, tokenizer.count(text)] } })
  return Object.assign(run, {
    tokenizer: Object.assign(
      encode,
      tokenizer.limit === undefined ? {} : { model_max_length: tokenizer.limit },
    ),
  })
}

afterAll(() => {
  __setPipelineFactoryForTest(null)
  rmSync(USERDATA, { recursive: true, force: true })
})

describe('pipeline cache eviction', () => {
  it('rebuilds the pipeline after evictPipeline so a re-download is not served stale', async () => {
    let builds = 0
    __setPipelineFactoryForTest(async () => {
      builds += 1
      return stubPipeline(async (texts: string[]) => ({
        tolist: () => texts.map(() => [1, 2, 3]),
        dims: [texts.length, 3],
      }))
    })

    const dir = '/models/x'
    await embed({ modelDir: dir, texts: ['a'] })
    await embed({ modelDir: dir, texts: ['b'] })
    expect(builds).toBe(1)

    evictPipeline(dir)
    await embed({ modelDir: dir, texts: ['c'] })
    expect(builds).toBe(2)

    __setPipelineFactoryForTest(null)
  })
})

describe('chunked embed', () => {
  const numberedTexts = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i}`)

  type FakeTensor = { tolist: () => number[][]; dims: number[] }

  // setImmediate, not a microtask: onnxruntime-node@1.21 (dist/backend.js:44-55)
  // calls the native session inside one, and only that timing shows a cancel's true
  // cost. Vectors carry their text's index so a mis-sliced chunk shows as content.
  function recordingFactory(calls: number[], onCall?: () => void) {
    return async () =>
      stubPipeline(
        (texts: string[]) =>
          new Promise<FakeTensor>((resolve, reject) => {
            setImmediate(() => {
              calls.push(texts.length)
              // onnxruntime-node rejects from inside the same setImmediate, so a
              // throwing onCall models a failed run, not an escaped callback.
              try {
                onCall?.()
                resolve({
                  tolist: () => texts.map((text) => [Number(text.slice(1))]),
                  dims: [texts.length, 1],
                })
              } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)))
              }
            })
          }),
      )
  }

  it('feeds the pipeline 16 texts per call and concatenates in order', async () => {
    const calls: number[] = []
    __setPipelineFactoryForTest(recordingFactory(calls))

    const result = await embed({ modelDir: '/models/chunked', texts: numberedTexts(40) })

    expect(calls).toEqual([16, 16, 8])
    expect(result).toEqual({
      ok: true,
      vectors: Array.from({ length: 40 }, (_, i) => [i]),
      dim: 1,
      truncated: [],
    })
  })

  // Main is blocked in native code for the whole run, so a cancel can only arrive
  // as a macrotask between chunks — which is what makes the loop's yield observable.
  it('burns only the running chunk when a cancel arrives as a macrotask', async () => {
    const controller = new AbortController()
    const calls: number[] = []
    __setPipelineFactoryForTest(
      recordingFactory(calls, () => {
        if (calls.length === 1) setImmediate(() => controller.abort())
      }),
    )

    const result = await embed({
      modelDir: '/models/mid-abort',
      texts: numberedTexts(80),
      signal: controller.signal,
    })

    expect(result).toEqual({ ok: false, error: { kind: 'cancelled', message: 'embed cancelled' } })
    expect(calls).toEqual([16])
  })

  // lib/retrieval/sync.ts promises no partial-success path: a half-synced index
  // mis-ranks silently, so the discard is pinned rather than left to block scope.
  it('discards every earlier chunk when one throws', async () => {
    const calls: number[] = []
    __setPipelineFactoryForTest(
      recordingFactory(calls, () => {
        if (calls.length === 3) throw new Error('onnx run failed')
      }),
    )

    const result = await embed({ modelDir: '/models/mid-throw', texts: numberedTexts(80) })

    expect(result).toEqual({ ok: false, error: { kind: 'call', message: 'onnx run failed' } })
    expect(calls).toEqual([16, 16, 16])
  })

  // A real graph has one output width, but per-chunk assignment makes a dim change
  // representable — last-chunk-wins would pass the facade's dim check regardless.
  it('fails rather than letting a later chunk redefine the dim', async () => {
    const calls: number[] = []
    __setPipelineFactoryForTest(async () =>
      stubPipeline(
        (texts: string[]) =>
          new Promise<FakeTensor>((resolve) => {
            setImmediate(() => {
              calls.push(texts.length)
              const dim = calls.length === 1 ? 3 : 5
              resolve({
                tolist: () => texts.map(() => Array.from({ length: dim }, () => 0)),
                dims: [texts.length, dim],
              })
            })
          }),
      ),
    )

    const result = await embed({ modelDir: '/models/dim-drift', texts: numberedTexts(32) })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'call', message: 'embedding dim changed mid-embed: expected 3, got 5' },
    })
    expect(calls).toEqual([16, 16])
  })

  // The loop's check runs before each chunk, so a one-chunk embed has no boundary
  // left for a cancel to land on: without the post-loop re-check it reports success.
  it('reports a cancel that lands during the only chunk', async () => {
    const controller = new AbortController()
    const calls: number[] = []
    __setPipelineFactoryForTest(
      recordingFactory(calls, () => {
        setImmediate(() => controller.abort())
      }),
    )

    const result = await embed({
      modelDir: '/models/single-chunk-abort',
      texts: numberedTexts(8),
      signal: controller.signal,
    })

    expect(result).toEqual({ ok: false, error: { kind: 'cancelled', message: 'embed cancelled' } })
    expect(calls).toEqual([8])
  })

  it('runs no pipeline call at all when the signal is already aborted', async () => {
    const calls: number[] = []
    __setPipelineFactoryForTest(recordingFactory(calls))

    const result = await embed({
      modelDir: '/models/pre-abort',
      texts: numberedTexts(4),
      signal: AbortSignal.abort(),
    })

    expect(result).toEqual({ ok: false, error: { kind: 'cancelled', message: 'embed cancelled' } })
    expect(calls).toEqual([])
  })
})

describe('listInstalled resilience', () => {
  beforeEach(() => {
    rmSync(embeddersDir, { recursive: true, force: true })
    mkdirSync(embeddersDir, { recursive: true })
  })

  it('skips a folder with a corrupt meta.json and still lists a valid sibling', () => {
    const valid = join(embeddersDir, 'valid--model')
    mkdirSync(valid)
    writeFileSync(join(valid, 'model.onnx'), 'weights')
    writeFileSync(join(valid, 'meta.json'), JSON.stringify({ id: 'valid/model', installedAt: 123 }))

    const corrupt = join(embeddersDir, 'corrupt--model')
    mkdirSync(corrupt)
    writeFileSync(join(corrupt, 'model.onnx'), 'weights')
    writeFileSync(join(corrupt, 'meta.json'), '{ not valid json')

    const installed = listInstalled()
    expect(installed).toHaveLength(1)
    const [entry] = installed
    expect(entry).toMatchObject({ id: 'valid/model', installedAt: 123 })
    expect(entry?.sizeBytes).toBeGreaterThan(0)
  })
})

// Truncation is what makes an over-long field vanish from the index without a
// trace, so the only defence is the embed reporting which texts it cut.
describe('truncation reporting', () => {
  const run = async (texts: string[]) => ({
    tolist: () => texts.map(() => [1]),
    dims: [texts.length, 1],
  })
  const byLength = (limit: number) => ({ count: (text: string) => text.length, limit })

  afterEach(() => {
    __setPipelineFactoryForTest(null)
  })

  it('names the index of every text that overran the window', async () => {
    __setPipelineFactoryForTest(async () => stubPipeline(run, byLength(4)))

    const result = await embed({
      modelDir: '/models/trunc',
      texts: ['ab', 'abcdefgh', 'abc', 'abcde'],
    })

    expect(result).toMatchObject({ ok: true, truncated: [1, 3] })
  })

  it('reports none when every text fits inside the window', async () => {
    __setPipelineFactoryForTest(async () => stubPipeline(run, byLength(64)))

    const result = await embed({ modelDir: '/models/fits', texts: ['ab', 'abc'] })

    expect(result).toMatchObject({ ok: true, truncated: [] })
  })

  // A tokenizer with no model_max_length does not truncate either, so silence here
  // is the truth rather than a missing check.
  it('reports none when the tokenizer declares no window', async () => {
    __setPipelineFactoryForTest(async () =>
      stubPipeline(run, { count: (text: string) => text.length }),
    )

    const result = await embed({ modelDir: '/models/nolimit', texts: ['a'.repeat(5000)] })

    expect(result).toMatchObject({ ok: true, truncated: [] })
  })

  // Indices are into the whole request, not into the chunk that carried the text —
  // a chunk-local index would name the wrong row for anything past the first 16.
  it('reports indices across chunk boundaries', async () => {
    __setPipelineFactoryForTest(async () => stubPipeline(run, byLength(4)))
    const texts = Array.from({ length: 40 }, (_, i) => (i === 17 || i === 33 ? 'abcdefgh' : 'ab'))

    const result = await embed({ modelDir: '/models/chunk-trunc', texts })

    expect(result).toMatchObject({ ok: true, truncated: [17, 33] })
  })
})

// The window is inclusive: transformers.js truncates TO model_max_length, so a text
// landing exactly on it loses nothing and must not be reported.
describe('truncation boundary', () => {
  afterEach(() => {
    __setPipelineFactoryForTest(null)
  })

  it('does not report a text sitting exactly on the window', async () => {
    __setPipelineFactoryForTest(async () =>
      stubPipeline(
        async (texts: string[]) => ({
          tolist: () => texts.map(() => [1]),
          dims: [texts.length, 1],
        }),
        { count: (text: string) => text.length, limit: 4 },
      ),
    )

    const result = await embed({ modelDir: '/models/edge', texts: ['abcd', 'abcde'] })

    expect(result).toMatchObject({ ok: true, truncated: [1] })
  })
})

// The whole point of a separate tokenizer cache: a live token count in the composer
// must not build an inference session, which is the ~300MB half of a model.
describe('countTokens', () => {
  const encoder = (count: (text: string) => number) =>
    Object.assign((text: string) => ({ input_ids: { dims: [1, count(text)] } }), {})

  afterEach(() => {
    __setTokenizerFactoryForTest(null)
    __setPipelineFactoryForTest(null)
  })

  it('returns one exact count per text', async () => {
    __setTokenizerFactoryForTest(async () => encoder((text) => text.length))

    const result = await countTokens({ modelDir: '/models/count', texts: ['ab', 'abcde'] })

    expect(result).toEqual({ ok: true, counts: [2, 5] })
  })

  it('builds no inference pipeline', async () => {
    let pipelineBuilds = 0
    __setPipelineFactoryForTest(async () => {
      pipelineBuilds += 1
      throw new Error('a token count must not reach the model')
    })
    __setTokenizerFactoryForTest(async () => encoder((text) => text.length))

    await countTokens({ modelDir: '/models/no-session', texts: ['abc'] })

    expect(pipelineBuilds).toBe(0)
  })

  it('loads the tokenizer once across calls', async () => {
    let builds = 0
    __setTokenizerFactoryForTest(async () => {
      builds += 1
      return encoder((text) => text.length)
    })

    await countTokens({ modelDir: '/models/cached', texts: ['a'] })
    await countTokens({ modelDir: '/models/cached', texts: ['bb'] })

    expect(builds).toBe(1)
  })

  it('surfaces a failed tokenizer load as an init envelope', async () => {
    __setTokenizerFactoryForTest(async () => {
      throw new Error('tokenizer.json missing')
    })

    const result = await countTokens({ modelDir: '/models/broken', texts: ['a'] })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'init', message: 'tokenizer.json missing' },
    })
  })

  it('answers an empty request without loading anything', async () => {
    let builds = 0
    __setTokenizerFactoryForTest(async () => {
      builds += 1
      return encoder(() => 1)
    })

    expect(await countTokens({ modelDir: '/models/empty', texts: [] })).toEqual({
      ok: true,
      counts: [],
    })
    expect(builds).toBe(0)
  })
})
