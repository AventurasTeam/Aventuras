import { type DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compositeText, type EmbeddedFieldRow, type SqlOp } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'

import { createDrainController, type DrainDeps } from './drain'
import type { EmbedderConfig } from './types'

const mocks = vi.hoisted(() => ({ embedLocal: vi.fn() }))
vi.mock('./local/runtime', () => ({ embedLocal: mocks.embedLocal }))

const MINILM = 'Xenova/all-MiniLM-L6-v2'
const cfg: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 384 }

function row(id: string): EmbeddedFieldRow {
  return { kind: 'entity', id, branchId: 'b1', fields: [`Name ${id}`, `Desc ${id}`] }
}

function makeController(over: Partial<DrainDeps> = {}) {
  const runInTransaction = vi.fn(async (_ops: SqlOp[]) => {})
  const embedRows = vi.fn(
    async (_config: EmbedderConfig, _rows: EmbeddedFieldRow[]) => [] as SqlOp[],
  )
  const onDrained = vi.fn()
  const setTimer = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = vi.fn((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const deps: DrainDeps = {
    hasActiveRun: () => false,
    branchIdsFor: () => ['b1'],
    loadStaleRows: async () => [],
    resolveConfig: () => ({ ok: true, config: cfg }),
    embedRows,
    runInTransaction: runInTransaction as unknown as DrainDeps['runInTransaction'],
    onDrained,
    setTimer,
    clearTimer,
    ...over,
  }
  const ctrl = createDrainController(deps)
  return { ctrl, runInTransaction, embedRows, onDrained, setTimer, clearTimer }
}

describe('drain controller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('drains stale rows after noteIdle when no run is active', async () => {
    const rows = [row('e1'), row('e2')]
    const { ctrl, embedRows, runInTransaction, onDrained } = makeController({
      loadStaleRows: async () => rows,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)

    expect(embedRows).toHaveBeenCalledOnce()
    expect(embedRows).toHaveBeenCalledWith(cfg, rows)
    expect(runInTransaction).toHaveBeenCalledOnce()
    expect(onDrained).toHaveBeenCalledWith('s1', 0)
  })

  it('skips while a run is active and retries after the next noteIdle', async () => {
    let active = true
    const { ctrl, embedRows } = makeController({
      hasActiveRun: () => active,
      loadStaleRows: async () => [row('e1')],
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)
    expect(embedRows).not.toHaveBeenCalled()

    active = false
    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)
    expect(embedRows).toHaveBeenCalledOnce()
  })

  it('backs off 5s -> 30s -> 120s while the embedder fails, resets on success', async () => {
    let fail = true
    const embedRows = vi.fn(async () => {
      if (fail) throw new Error('embedder down')
      return [] as SqlOp[]
    })
    const setTimer = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms))
    const { ctrl } = makeController({
      loadStaleRows: async () => [row('e1')],
      embedRows,
      setTimer,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(120_000)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(setTimer.mock.calls.map((c) => c[1])).toEqual([
      0, 5_000, 30_000, 120_000, 120_000, 120_000,
    ])

    // A full-success drain resets the backoff ladder.
    fail = false
    await vi.advanceTimersByTimeAsync(120_000)
    fail = true
    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)

    expect(setTimer.mock.calls.slice(-2).map((c) => c[1])).toEqual([0, 5_000])
  })

  it('never throws to the caller when embed fails (logs and re-schedules)', async () => {
    const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {})
    const setTimer = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms))
    const embedRows = vi.fn(async () => {
      throw new Error('boom')
    })
    const { ctrl } = makeController({
      loadStaleRows: async () => [row('e1')],
      embedRows,
      setTimer,
    })

    ctrl.noteIdle('s1')
    await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow()

    expect(embedRows).toHaveBeenCalled()
    expect(debugSpy).toHaveBeenCalledWith('embedder.drain_failed', expect.objectContaining({}))
    // Re-scheduled at the first backoff step after the failure.
    expect(setTimer.mock.calls.at(-1)?.[1]).toBe(5_000)
  })

  it('kick() drains immediately and resets backoff', async () => {
    let fail = true
    const setTimer = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms))
    const embedRows = vi.fn(async () => {
      if (fail) throw new Error('down')
      return [] as SqlOp[]
    })
    const { ctrl } = makeController({
      loadStaleRows: async () => [row('e1')],
      embedRows,
      setTimer,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    const callsBeforeKick = embedRows.mock.calls.length

    fail = false
    ctrl.kick('s1')
    await vi.advanceTimersByTimeAsync(0)
    expect(embedRows.mock.calls.length).toBe(callsBeforeKick + 1)

    // Backoff was reset by the kick: the next failure re-starts the ladder at 5s.
    fail = true
    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)
    expect(setTimer.mock.calls.at(-1)?.[1]).toBe(5_000)
  })

  it('aborts between batches when a run starts mid-drain', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`e${i}`))
    let checks = 0
    const hasActiveRun = () => {
      checks += 1
      // 1: top-of-drain guard, 2: first-batch guard -> both false;
      // 3: second-batch guard -> true, yields before the second batch.
      return checks >= 3
    }
    const { ctrl, embedRows, runInTransaction, onDrained } = makeController({
      loadStaleRows: async () => rows,
      hasActiveRun,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)

    expect(embedRows).toHaveBeenCalledOnce()
    expect(runInTransaction).toHaveBeenCalledOnce()
    expect(onDrained).toHaveBeenCalledExactlyOnceWith('s1', 4)
  })

  it('drained vectors match a direct embed of the same rows', async () => {
    const { embedAndBuildVecOps, embedTexts } = await import('./service')

    const deterministicVec = (text: string): Float32Array => {
      const v = new Float32Array(384)
      for (let i = 0; i < text.length; i += 1) v[text.charCodeAt(i) % 384] += 1
      v[0] += 1 // guarantee a non-zero vector for l2Normalize
      return v
    }
    mocks.embedLocal.mockImplementation(async (_id: string, texts: string[]) => ({
      vectors: texts.map(deterministicVec),
      dim: 384,
    }))

    const { sqlite, runInTransaction } = await createTestDb()
    seedStaleEntities(sqlite, [row('e1'), row('e2')])

    const exec = async (sql: string) => {
      sqlite.exec(sql)
    }
    const { ctrl } = makeController({
      loadStaleRows: async () => loadStaleEntities(sqlite),
      embedRows: (config, rows) => embedAndBuildVecOps(config, rows, exec),
      runInTransaction,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)

    for (const staleRow of [row('e1'), row('e2')]) {
      const stored = sqlite
        .prepare('SELECT embedding FROM entities_vec_384 WHERE id = ? AND model_id = ?')
        .get(staleRow.id, MINILM) as { embedding: Uint8Array }
      const direct = await embedTexts(cfg, [compositeText(staleRow.fields)], 'document')
      const expected = new Uint8Array(direct.vectors[0].buffer)
      expect(Buffer.from(stored.embedding)).toEqual(Buffer.from(expected))
    }
  })
})

function seedStaleEntities(sqlite: DatabaseSync, rows: EmbeddedFieldRow[]): void {
  const now = 1000
  sqlite
    .prepare(
      'INSERT INTO stories (id, title, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run('s1', 'S', JSON.stringify({ embedding_model_id: MINILM }), now, now)
  sqlite
    .prepare('INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run('b1', 's1', 'main', now)
  const ins = sqlite.prepare(
    `INSERT INTO entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
     VALUES (?, ?, 'character', ?, ?, 'active', 'auto', 1, ?, ?)`,
  )
  for (const r of rows) ins.run(r.id, r.branchId, r.fields[0], r.fields[1], now, now)
}

function loadStaleEntities(sqlite: DatabaseSync): EmbeddedFieldRow[] {
  const rows = sqlite
    .prepare('SELECT id, branch_id, name, description FROM entities WHERE embedding_stale = 1')
    .all() as { id: string; branch_id: string; name: string; description: string }[]
  return rows.map((r) => ({
    kind: 'entity',
    id: r.id,
    branchId: r.branch_id,
    fields: [r.name, r.description],
  }))
}
