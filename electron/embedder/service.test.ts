import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { __setPipelineFactoryForTest, embed, evictPipeline, listInstalled } from './service'

const { USERDATA } = vi.hoisted(() => ({
  USERDATA: `${process.env.TMPDIR ?? '/tmp'}/ave-service-test-${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}`,
}))

vi.mock('electron', () => ({ app: { getPath: () => USERDATA } }))

const embeddersDir = join(USERDATA, 'embedders')

afterAll(() => {
  __setPipelineFactoryForTest(null)
  rmSync(USERDATA, { recursive: true, force: true })
})

describe('pipeline cache eviction', () => {
  it('rebuilds the pipeline after evictPipeline so a re-download is not served stale', async () => {
    let builds = 0
    __setPipelineFactoryForTest(async () => {
      builds += 1
      return async (texts: string[]) => ({
        tolist: () => texts.map(() => [1, 2, 3]),
        dims: [texts.length, 3],
      })
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
    return async () => (texts: string[]) =>
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
      })
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
    __setPipelineFactoryForTest(
      async () => (texts: string[]) =>
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
    )

    const result = await embed({ modelDir: '/models/dim-drift', texts: numberedTexts(32) })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'call', message: 'embedding dim changed mid-embed: expected 3, got 5' },
    })
    expect(calls).toEqual([16, 16])
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
