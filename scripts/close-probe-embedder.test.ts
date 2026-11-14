import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { execRaw, listTableNames, queryRows } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { embedLocal } from '@/lib/embedder/local/runtime'

import { installProbeBridges, probeEmbedderBridge } from './close-probe-embedder'
import {
  __setPipelineFactoryForTest,
  __setTokenizerFactoryForTest,
} from '../electron/embedder/service'

// service.ts reaches paths.ts, which imports Electron's app; the probe never asks it for a path.
vi.mock('electron', () => ({ app: {} }))

const ROOT = mkdtempSync(join(tmpdir(), 'probe-embedders-'))
const MODEL = 'Xenova/all-MiniLM-L6-v2'
const MODEL_DIR = join(ROOT, 'xenova--all-minilm-l6-v2')

// embed() re-encodes each text through the pipeline's own tokenizer to learn what was cut.
function stubPipeline(run: (texts: string[]) => Promise<number[][]>) {
  const tokenizer = (text: string) => ({ input_ids: { dims: [1, text.split(' ').length] } })
  return Object.assign(
    async (texts: string[]) => {
      const vectors = await run(texts)
      return { tolist: () => vectors, dims: [vectors.length, vectors[0]?.length ?? 0] }
    },
    { tokenizer },
  )
}

const fixedVectors = async (texts: string[]) => texts.map(() => [0.5, 0.25])

afterEach(() => {
  __setPipelineFactoryForTest(null)
  __setTokenizerFactoryForTest(null)
  vi.unstubAllGlobals()
  delete (globalThis as { window?: unknown }).window
})

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

describe('probeEmbedderBridge', () => {
  it('embeds from the model folder under the root, as main resolves it', async () => {
    const dirs: string[] = []
    __setPipelineFactoryForTest(async (modelDir) => {
      dirs.push(modelDir)
      return stubPipeline(fixedVectors)
    })

    const result = await probeEmbedderBridge(ROOT).embed({ modelId: MODEL, texts: ['a', 'b'] })

    expect(result).toEqual({
      ok: true,
      vectors: [
        [0.5, 0.25],
        [0.5, 0.25],
      ],
      dim: 2,
      truncated: [],
    })
    expect(dirs).toEqual([MODEL_DIR])
  })

  function heldPipeline() {
    let release = (): void => {}
    let started = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    __setPipelineFactoryForTest(async () =>
      stubPipeline(async (texts) => {
        started()
        await held
        return fixedVectors(texts)
      }),
    )
    return { running, release: () => release() }
  }

  it('cancels a running embed by its request id', async () => {
    const pipeline = heldPipeline()
    const bridge = probeEmbedderBridge(ROOT)

    const pending = bridge.embed({ modelId: MODEL, texts: ['a'], requestId: 'req-1' })
    await pipeline.running
    await bridge.cancelEmbed({ requestId: 'req-1' })
    pipeline.release()

    expect(await pending).toEqual({
      ok: false,
      error: { kind: 'cancelled', message: 'embed cancelled' },
    })
  })

  it('leaves an embed alone when the cancel names another request', async () => {
    const pipeline = heldPipeline()
    const bridge = probeEmbedderBridge(ROOT)

    const pending = bridge.embed({ modelId: MODEL, texts: ['a'], requestId: 'req-1' })
    await pipeline.running
    await bridge.cancelEmbed({ requestId: 'req-2' })
    pipeline.release()

    expect(await pending).toMatchObject({ ok: true, vectors: [[0.5, 0.25]] })
  })

  it('cancels an embed issued in the same tick, before the embed first yields', async () => {
    __setPipelineFactoryForTest(async () => stubPipeline(fixedVectors))
    const bridge = probeEmbedderBridge(ROOT)

    const pending = bridge.embed({ modelId: MODEL, texts: ['a'], requestId: 'req-1' })
    void bridge.cancelEmbed({ requestId: 'req-1' })

    expect(await pending).toEqual({
      ok: false,
      error: { kind: 'cancelled', message: 'embed cancelled' },
    })
  })

  it('keeps a reused request id cancellable after the first embed on it finishes', async () => {
    const runs: { release: () => void }[] = []
    __setPipelineFactoryForTest(async () =>
      stubPipeline(async (texts) => {
        await new Promise<void>((release) => runs.push({ release }))
        return fixedVectors(texts)
      }),
    )
    const bridge = probeEmbedderBridge(ROOT)

    const first = bridge.embed({ modelId: MODEL, texts: ['a'], requestId: 'req-1' })
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    const second = bridge.embed({ modelId: MODEL, texts: ['b'], requestId: 'req-1' })
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    runs[0]?.release()
    await first
    await bridge.cancelEmbed({ requestId: 'req-1' })
    runs[1]?.release()

    expect(await second).toEqual({
      ok: false,
      error: { kind: 'cancelled', message: 'embed cancelled' },
    })
  })

  it("counts tokens with the model's own tokenizer", async () => {
    const dirs: string[] = []
    __setTokenizerFactoryForTest(async (modelDir) => {
      dirs.push(modelDir)
      return (text: string) => ({ input_ids: { dims: [1, text.split(' ').length] } })
    })

    expect(
      await probeEmbedderBridge(ROOT).countTokens({ modelId: MODEL, texts: ['one two', 'three'] }),
    ).toEqual({ ok: true, counts: [2, 1] })
    expect(dirs).toEqual([MODEL_DIR])
  })

  it('smoke-tests through one embed', async () => {
    __setPipelineFactoryForTest(async () => stubPipeline(fixedVectors))

    expect(await probeEmbedderBridge(ROOT).smokeTest({ modelId: MODEL })).toEqual({
      ok: true,
      dim: 2,
    })
  })

  it('refuses a model id that escapes the root before loading anything', async () => {
    const factory = vi.fn(async () => stubPipeline(fixedVectors))
    __setPipelineFactoryForTest(factory)

    await expect(
      probeEmbedderBridge(ROOT).embed({ modelId: '../outside', texts: ['a'] }),
    ).rejects.toThrow('Invalid model id "../outside"')
    expect(factory).not.toHaveBeenCalled()
  })
})

describe('installProbeBridges', () => {
  it("gives the close's embed path the bridge, and the raw DB seam the probe's database", async () => {
    __setPipelineFactoryForTest(async () => stubPipeline(fixedVectors))
    const db = await createTestDb()
    const uninstall = installProbeBridges(probeEmbedderBridge(ROOT), db)

    expect((await embedLocal(MODEL, ['a'])).vectors.map((vector) => [...vector])).toEqual([
      [0.5, 0.25],
    ])
    await execRaw('CREATE TABLE probe_rows (n INTEGER)')
    await expect(
      globalThis.window.aventurasDb?.transaction([
        { sql: 'INSERT INTO probe_rows (n) VALUES (?)', params: [7] },
      ]),
    ).resolves.toEqual({ ok: true })
    expect(await queryRows('SELECT n FROM probe_rows', [])).toEqual([[7]])
    expect(await listTableNames()).toContain('probe_rows')
    expect(db.sqlite.prepare('SELECT n FROM probe_rows').all()).toEqual([{ n: 7 }])

    uninstall()

    await expect(queryRows('SELECT 1', [])).rejects.toThrow('Database bridge unavailable')
  })

  it("answers a get with the row itself, or nothing, as main's bridge does", async () => {
    installProbeBridges(probeEmbedderBridge(ROOT), await createTestDb())
    const bridge = globalThis.window.aventurasDb!

    expect(await bridge.query('SELECT 1 AS a, 2 AS b', [], 'get')).toEqual({ rows: [1, 2] })
    expect(await bridge.query('SELECT 1 AS a WHERE 0', [], 'get')).toEqual({ rows: undefined })
  })

  it('refuses to install over a window something else set', async () => {
    const db = await createTestDb()
    vi.stubGlobal('window', {})

    expect(() => installProbeBridges(probeEmbedderBridge(ROOT), db)).toThrow(
      'globalThis.window is already set',
    )
  })
})
