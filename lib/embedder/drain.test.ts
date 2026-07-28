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
    expect(onDrained).toHaveBeenCalledWith('s1')
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
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
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
    expect(warnSpy).toHaveBeenCalledWith(
      'embedder.drain_batches_failed',
      expect.objectContaining({
        storyId: 's1',
        failedRows: 1,
        error: expect.stringContaining('boom'),
      }),
    )
    // Re-scheduled at the first backoff step after the failure.
    expect(setTimer.mock.calls.at(-1)?.[1]).toBe(5_000)
  })

  it('a failing batch does not block the batches behind it', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    // 40 rows -> 3 batches of 16/16/8, and the FIRST one fails — the shape that
    // matters, because every attempt restarts at row 0, so aborting the pass on a
    // batch failure would starve the rows behind it indefinitely.
    const rows = Array.from({ length: 40 }, (_, i) => row(`e${i + 1}`))
    let call = 0
    const embedRows = vi.fn(async () => {
      call += 1
      if (call === 1) throw new Error('poison row')
      return [] as SqlOp[]
    })
    const { ctrl, onDrained, setTimer } = makeController({
      loadStaleRows: async () => rows,
      embedRows,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0)

    expect(embedRows).toHaveBeenCalledTimes(3)
    // Batches 2 and 3 landed despite batch 1 failing.
    expect(onDrained).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith(
      'embedder.drain_batches_failed',
      expect.objectContaining({ failedRows: 16, totalRows: 40 }),
    )
    // Still retried, so the failed rows get another pass.
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
    expect(onDrained).toHaveBeenCalledExactlyOnceWith('s1')
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

  it('stop() mid-flight prevents a re-armed retry timer when the embed then fails', async () => {
    let releaseEmbed: () => void = () => {}
    const embedGate = new Promise<void>((resolve) => {
      releaseEmbed = resolve
    })
    const embedRows = vi.fn(async () => {
      await embedGate
      throw new Error('embedder down')
    })
    const setTimer = vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms))
    const { ctrl } = makeController({
      loadStaleRows: async () => [row('e1')],
      embedRows,
      setTimer,
    })

    ctrl.noteIdle('s1')
    await vi.advanceTimersByTimeAsync(0) // drain starts, parks in the awaited embedRows
    expect(embedRows).toHaveBeenCalledOnce()

    ctrl.stop()
    const timerCallsAtStop = setTimer.mock.calls.length
    releaseEmbed() // embed rejects now, after stop()
    await vi.advanceTimersByTimeAsync(120_000)

    // The catch saw stopped === true, so no backoff retry was scheduled.
    expect(setTimer.mock.calls.length).toBe(timerCallsAtStop)
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

describe('poison-row isolation', () => {
  const warn = () => vi.spyOn(logger, 'warn').mockImplementation(() => {})

  // 20 rows -> batches of 16 + 4; `e7` can never be embedded.
  function poisonSetup() {
    const rows = Array.from({ length: 20 }, (_, i) => row(`e${i + 1}`))
    const embedRows = vi.fn(async (_c: EmbedderConfig, batch: EmbeddedFieldRow[]) => {
      if (batch.some((r) => r.id === 'e7')) throw new Error('input too long')
      return [] as SqlOp[]
    })
    return { rows, embedRows }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leaves the first failing pass alone, then isolates on the second', async () => {
    warn()
    const { rows, embedRows } = poisonSetup()
    const { ctrl } = makeController({ loadStaleRows: async () => rows, embedRows })

    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    // Pass 1: two batch calls, the poisoned one failing whole. No single-row calls,
    // because one transient provider outage must not cost BATCH_SIZE calls a cycle.
    const firstPass = embedRows.mock.calls.length
    expect(embedRows.mock.calls.every(([, batch]) => batch.length > 1)).toBe(true)

    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows.mock.calls.length).toBeGreaterThan(firstPass + 2))
    // Pass 2 re-runs the failing batch row by row to find what is actually at fault.
    const singles = embedRows.mock.calls.filter(([, batch]) => batch.length === 1)
    expect(singles).toHaveLength(16)
    ctrl.stop()
  })

  it('quarantines only the row that fails alone, and drains its batch-mates', async () => {
    warn()
    const { rows, embedRows } = poisonSetup()
    const { ctrl } = makeController({ loadStaleRows: async () => rows, embedRows })

    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    ctrl.noteIdle('s1')
    await vi.waitFor(() =>
      expect(embedRows.mock.calls.some(([, b]) => b.length === 1 && b[0].id === 'e7')).toBe(true),
    )

    embedRows.mockClear()
    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    // e7 is out of the working set; the 15 rows it was batched with are not.
    const seen = embedRows.mock.calls.flatMap(([, batch]) => batch.map((r) => r.id))
    expect(seen).not.toContain('e7')
    expect(seen).toContain('e1')
    ctrl.stop()
  })

  it('an explicit kick clears the quarantine', async () => {
    warn()
    const { rows, embedRows } = poisonSetup()
    const { ctrl } = makeController({ loadStaleRows: async () => rows, embedRows })

    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    ctrl.noteIdle('s1')
    await vi.waitFor(() =>
      expect(embedRows.mock.calls.some(([, b]) => b.length === 1 && b[0].id === 'e7')).toBe(true),
    )

    embedRows.mockClear()
    // The kick means the reason a row failed may be gone (embedder recovered, model
    // downloaded), so nothing may stay excluded on the strength of an old failure.
    ctrl.kick('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    expect(embedRows.mock.calls.flatMap(([, b]) => b.map((r) => r.id))).toContain('e7')
    ctrl.stop()
  })

  it('quarantines nothing when every row in the batch fails alone', async () => {
    warn()
    const rows = Array.from({ length: 4 }, (_, i) => row(`e${i + 1}`))
    // A provider outage, not a content problem: isolating finds no innocent rows.
    const embedRows = vi.fn(
      async (_c: EmbedderConfig, _batch: EmbeddedFieldRow[]): Promise<SqlOp[]> => {
        throw new Error('connection refused')
      },
    )
    const { ctrl } = makeController({ loadStaleRows: async () => rows, embedRows })

    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows.mock.calls.some(([, b]) => b.length === 1)).toBe(true))

    embedRows.mockClear()
    ctrl.noteIdle('s1')
    await vi.waitFor(() => expect(embedRows).toHaveBeenCalled())
    // Every row is still in play — quarantining the batch would strand rows that
    // are perfectly embeddable once the embedder is back.
    const seen = embedRows.mock.calls.flatMap(([, b]) => b.map((r) => r.id))
    expect(new Set(seen)).toEqual(new Set(['e1', 'e2', 'e3', 'e4']))
    ctrl.stop()
  })
})
