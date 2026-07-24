import { type DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import {
  clearEmbeddingStaleOp,
  compositeText,
  ensureVecTables,
  packFloat32,
  sourceHash,
  upsertVecOps,
  type EmbeddedFieldRow,
  type SqlOp,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import type { EmbedderConfig } from '@/lib/embedder'

import {
  cancelSwap,
  reindexStory,
  relabelModel,
  resumeSwap,
  startSwap,
  SwapInProgressError,
  SwapStoryMissingError,
  type SwapDeps,
} from './engine'

const OLD = 'model-old'
const NEW = 'model-new'
const DIM = 384

const cfg = (modelId: string, dim = DIM): EmbedderConfig => ({ backend: 'local', modelId, dim })

function fakeVec(dim: number, seed: number): Uint8Array {
  const arr = new Float32Array(dim)
  arr[seed % dim] = 1
  return packFloat32(arr)
}

type EmbedFn = SwapDeps['embedRows']

function makeEmbedRows(
  sqlite: DatabaseSync,
  opts: {
    throwOnCall?: number
    beforeBatch?: (call: number, rows: EmbeddedFieldRow[]) => void
  } = {},
): { fn: EmbedFn; calls: EmbeddedFieldRow[][] } {
  const calls: EmbeddedFieldRow[][] = []
  let n = 0
  const fn: EmbedFn = async (config, rows) => {
    n += 1
    opts.beforeBatch?.(n, rows)
    calls.push(rows)
    if (opts.throwOnCall === n) throw new Error(`embed failed on batch ${n}`)
    const dim = config.dim ?? DIM
    await ensureVecTables(dim, async (sql) => {
      sqlite.exec(sql)
    })
    const ops: SqlOp[] = []
    rows.forEach((row, i) => {
      const composite = compositeText(row.fields)
      ops.push(
        ...upsertVecOps({
          kind: row.kind,
          id: row.id,
          branchId: row.branchId,
          modelId: config.modelId,
          dim,
          sourceHash: sourceHash(composite),
          vector: fakeVec(dim, i),
        }),
        clearEmbeddingStaleOp(row.kind, row.id, row.branchId),
      )
    })
    return ops
  }
  return { fn, calls }
}

function makeDeps(
  sqlite: DatabaseSync,
  runInTransaction: SwapDeps['runInTransaction'],
  embed: EmbedFn,
  over: Partial<SwapDeps> = {},
): { deps: SwapDeps; runSpy: ReturnType<typeof vi.fn> } {
  const runSpy = vi.fn(runInTransaction)
  const deps: SwapDeps = {
    runInTransaction: runSpy as unknown as SwapDeps['runInTransaction'],
    queryAll: async (sql, params) =>
      (sqlite.prepare(sql).all(...(params as SQLInputValue[])) as Record<string, unknown>[]).map(
        (r) => Object.values(r),
      ),
    embedRows: embed,
    listVecTables: async () =>
      (
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string
        }[]
      ).map((r) => r.name),
    onProgress: () => {},
    isCancelRequested: () => false,
    now: () => 2000,
    ...over,
  }
  return { deps, runSpy }
}

type SeedOpts = { extraEntities?: number; settingsNull?: boolean; markerTarget?: string | null }

async function setup(opts: SeedOpts = {}) {
  const { sqlite, runInTransaction } = await createTestDb()
  const now = 1000

  const settings = opts.settingsNull
    ? null
    : JSON.stringify({
        embedding_model_id: OLD,
        ...(opts.markerTarget ? { embedding_swap_target: opts.markerTarget } : {}),
      })
  sqlite
    .prepare(
      'INSERT INTO stories (id, title, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run('s1', 'S', settings, now, now)
  sqlite
    .prepare('INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run('b1', 's1', 'main', now)

  const embedded: EmbeddedFieldRow[] = []

  const insEntity = sqlite.prepare(
    `INSERT INTO entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
     VALUES (?, ?, 'character', ?, ?, 'active', 'auto', 0, ?, ?)`,
  )
  const nEntities = 3 + (opts.extraEntities ?? 0)
  for (let i = 1; i <= nEntities; i += 1) {
    insEntity.run(`e${i}`, 'b1', `Name ${i}`, `Desc ${i}`, now, now)
    embedded.push({
      kind: 'entity',
      id: `e${i}`,
      branchId: 'b1',
      fields: [`Name ${i}`, `Desc ${i}`],
    })
  }

  sqlite
    .prepare(
      `INSERT INTO lore (id, branch_id, title, body, injection_mode, embedding_stale, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'auto', 0, ?, ?)`,
    )
    .run('l1', 'b1', 'Lore One', 'Body one', now, now)
  embedded.push({ kind: 'lore', id: 'l1', branchId: 'b1', fields: ['Lore One', 'Body one'] })

  sqlite
    .prepare(
      `INSERT INTO happenings (id, branch_id, title, description, embedding_stale, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run('h1', 'b1', 'Happening One', 'It happened', now, now)
  embedded.push({
    kind: 'happening',
    id: 'h1',
    branchId: 'b1',
    fields: ['Happening One', 'It happened'],
  })

  sqlite
    .prepare(
      `INSERT INTO threads (id, branch_id, title, description, status, injection_mode, embedding_stale, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'auto', 0, ?, ?)`,
    )
    .run('t1', 'b1', 'Thread One', 'A tension', now, now)
  embedded.push({ kind: 'thread', id: 't1', branchId: 'b1', fields: ['Thread One', 'A tension'] })

  sqlite
    .prepare(
      `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme, start_entry_id, end_entry_id, token_count, closed_at, embedding_stale, created_at, updated_at)
       VALUES (?, ?, 0, 'Chapter One', ?, ?, 'x', 'y', 0, ?, 0, ?, ?)`,
    )
    .run('c1', 'b1', 'Chapter summary', 'A theme', now, now, now)
  embedded.push({
    kind: 'chapter',
    id: 'c1',
    branchId: 'b1',
    fields: ['Chapter summary', 'A theme'],
  })

  return { sqlite, runInTransaction, embedded }
}

function seedOldVectors(sqlite: DatabaseSync, rows: EmbeddedFieldRow[], modelId = OLD): void {
  sqlite.exec('BEGIN')
  try {
    rows.forEach((row, i) => {
      const composite = compositeText(row.fields)
      for (const op of upsertVecOps({
        kind: row.kind,
        id: row.id,
        branchId: row.branchId,
        modelId,
        dim: DIM,
        sourceHash: sourceHash(composite),
        vector: fakeVec(DIM, i),
      })) {
        sqlite.prepare(op.sql).run(...(op.params as SQLInputValue[]))
      }
    })
    sqlite.exec('COMMIT')
  } catch (err) {
    sqlite.exec('ROLLBACK')
    throw err
  }
}

// --- assertion helpers -----------------------------------------------------

function modelIdsIn(sqlite: DatabaseSync, table: string): string[] {
  return (
    sqlite.prepare(`SELECT model_id FROM ${table} ORDER BY id, model_id`).all() as {
      model_id: string
    }[]
  ).map((r) => r.model_id)
}

function idsForModel(sqlite: DatabaseSync, table: string, modelId: string): string[] {
  return (
    sqlite.prepare(`SELECT id FROM ${table} WHERE model_id = ? ORDER BY id`).all(modelId) as {
      id: string
    }[]
  ).map((r) => r.id)
}

function storySettings(sqlite: DatabaseSync): Record<string, unknown> | undefined {
  const row = sqlite.prepare('SELECT settings FROM stories WHERE id = ?').get('s1') as
    | { settings: string | null }
    | undefined
  return row?.settings ? (JSON.parse(row.settings) as Record<string, unknown>) : undefined
}

function staleFlag(sqlite: DatabaseSync, table: string, id: string): number {
  const row = sqlite.prepare(`SELECT embedding_stale FROM ${table} WHERE id = ?`).get(id) as {
    embedding_stale: number
  }
  return row.embedding_stale
}

function opsOf(runSpy: ReturnType<typeof vi.fn>): SqlOp[][] {
  return runSpy.mock.calls.map((c) => c[0] as SqlOp[])
}

function callsWith(runSpy: ReturnType<typeof vi.fn>, needle: string): SqlOp[][] {
  return opsOf(runSpy).filter((ops) => ops.some((op) => op.sql.includes(needle)))
}

// ---------------------------------------------------------------------------

describe('embedder-swap engine', () => {
  it('1. startSwap happy path: stages under NEW, flip leaves only NEW in one transaction', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    const result = await startSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: cfg(NEW),
    })

    expect(result).toBe('completed')
    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual(['e1', 'e2', 'e3'])
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual([])
    expect(idsForModel(sqlite, 'lore_vec_384', NEW)).toEqual(['l1'])
    expect(idsForModel(sqlite, 'lore_vec_384', OLD)).toEqual([])

    const s = storySettings(sqlite)
    expect(s?.embedding_model_id).toBe(NEW)
    expect(s?.embedding_swap_target).toBeUndefined()

    const flips = callsWith(runSpy, 'json_remove')
    expect(flips).toHaveLength(1)
    const flip = flips[0]
    expect(
      flip.some((op) => op.sql.includes('json_set') && op.sql.includes('embedding_model_id')),
    ).toBe(true)
    expect(flip.some((op) => op.sql.startsWith('DELETE FROM') && op.sql.includes('model_id'))).toBe(
      true,
    )
  })

  it('2. same-dim swap: OLD and NEW coexist in the same family mid-phase-1', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ extraEntities: 20 })
    seedOldVectors(sqlite, embedded)
    let midModels: string[] = []
    const { fn } = makeEmbedRows(sqlite, {
      beforeBatch: (call) => {
        if (call === 2) {
          midModels = [
            ...new Set(
              (
                sqlite.prepare('SELECT model_id FROM entities_vec_384').all() as {
                  model_id: string
                }[]
              ).map((r) => r.model_id),
            ),
          ]
        }
      },
    })
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    await startSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: cfg(NEW),
    })

    expect(midModels).toContain(OLD)
    expect(midModels).toContain(NEW)
    // After the flip, only NEW survives.
    expect([...new Set(modelIdsIn(sqlite, 'entities_vec_384'))]).toEqual([NEW])
  })

  it('3. crash mid-phase-1: rejects, marker stays set, partial NEW persists, OLD intact', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ extraEntities: 20 })
    seedOldVectors(sqlite, embedded)
    const oldCount = modelIdsIn(sqlite, 'entities_vec_384').length
    const { fn } = makeEmbedRows(sqlite, { throwOnCall: 2 })
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    await expect(
      startSwap(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        currentModelId: OLD,
        currentSwapTarget: null,
        targetConfig: cfg(NEW),
      }),
    ).rejects.toThrow(/embed failed/)

    expect(storySettings(sqlite)?.embedding_swap_target).toBe(NEW)
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)
    // Batch 1 (16 rows) committed before the crash.
    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toHaveLength(16)
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toHaveLength(oldCount)
  })

  it('4. resumeSwap after a crash re-embeds exactly the missing rows, then flips', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ extraEntities: 20 })
    seedOldVectors(sqlite, embedded)
    const totalRows = embedded.length

    const crash = makeEmbedRows(sqlite, { throwOnCall: 2 })
    const crashDeps = makeDeps(sqlite, runInTransaction, crash.fn)
    await expect(
      startSwap(crashDeps.deps, {
        storyId: 's1',
        branchIds: ['b1'],
        currentModelId: OLD,
        currentSwapTarget: null,
        targetConfig: cfg(NEW),
      }),
    ).rejects.toThrow()

    const stagedNewKeys = new Set(
      (
        sqlite
          .prepare("SELECT branch_id || ':' || id AS k FROM entities_vec_384 WHERE model_id = ?")
          .all(NEW) as { k: string }[]
      ).map((r) => r.k),
    )

    const resume = makeEmbedRows(sqlite)
    const resumeDeps = makeDeps(sqlite, runInTransaction, resume.fn)
    const result = await resumeSwap(resumeDeps.deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: NEW,
      targetConfig: cfg(NEW),
    })

    expect(result).toBe('completed')
    const embeddedByResume = resume.calls.flat()
    expect(embeddedByResume).toHaveLength(totalRows - stagedNewKeys.size)
    for (const row of embeddedByResume) {
      expect(stagedNewKeys.has(`${row.branchId}:${row.id}`)).toBe(false)
    }
    expect(storySettings(sqlite)?.embedding_model_id).toBe(NEW)
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
    expect([...new Set(modelIdsIn(sqlite, 'entities_vec_384'))]).toEqual([NEW])
  })

  it('5. cancelSwap: deletes NEW, clears marker, re-flags all five source tables, one transaction', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ markerTarget: NEW })
    seedOldVectors(sqlite, embedded)
    // Simulate a partial stage: NEW vectors present and stale flags cleared.
    seedOldVectors(sqlite, embedded, NEW)
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    await cancelSwap(deps, { storyId: 's1', branchIds: ['b1'], targetModelId: NEW })

    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual([])
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(idsForModel(sqlite, 'lore_vec_384', NEW)).toEqual([])
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)

    expect(staleFlag(sqlite, 'entities', 'e1')).toBe(1)
    expect(staleFlag(sqlite, 'lore', 'l1')).toBe(1)
    expect(staleFlag(sqlite, 'happenings', 'h1')).toBe(1)
    expect(staleFlag(sqlite, 'threads', 't1')).toBe(1)
    expect(staleFlag(sqlite, 'chapters', 'c1')).toBe(1)

    expect(runSpy).toHaveBeenCalledTimes(1)
    const ops = opsOf(runSpy)[0]
    expect(ops.some((op) => op.sql.includes('json_remove'))).toBe(true)
    expect(
      ops.some((op) => op.sql.includes('json_set') && op.sql.includes('embedding_model_id')),
    ).toBe(false)
    expect(ops.filter((op) => op.sql.includes('embedding_stale = 1'))).toHaveLength(5)
  })

  it('6. startSwap while marker set: throws SwapInProgressError, no writes', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ markerTarget: NEW })
    seedOldVectors(sqlite, embedded)
    const embed = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, embed.fn)

    await expect(
      startSwap(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        currentModelId: OLD,
        currentSwapTarget: NEW,
        targetConfig: cfg('model-other'),
      }),
    ).rejects.toBeInstanceOf(SwapInProgressError)

    expect(runSpy).not.toHaveBeenCalled()
    expect(embed.calls).toHaveLength(0)
  })

  it('7. reindexStory (target = current model): re-embeds in place, phase-2 delete skipped', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn, calls } = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    const result = await reindexStory(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: cfg(OLD),
    })

    expect(result).toBe('completed')
    // Every row re-embedded (stagedIds skip disabled for same-model).
    expect(calls.flat()).toHaveLength(embedded.length)
    // The just-staged rows survived (delete skipped); still exactly one OLD row each.
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect([...new Set(modelIdsIn(sqlite, 'entities_vec_384'))]).toEqual([OLD])
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
  })

  it('8. relabelModel: rewrites vec identity in SQL, preserves source_hash + embedding, never embeds', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const before = sqlite
      .prepare('SELECT pk, source_hash, embedding FROM entities_vec_384 WHERE id = ?')
      .get('e1') as { pk: string; source_hash: string; embedding: Uint8Array }

    const embed = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, embed.fn)

    await relabelModel(deps, { storyId: 's1', branchIds: ['b1'], oldModelId: OLD, newModelId: NEW })

    expect(embed.calls).toHaveLength(0)
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual([])
    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual(['e1', 'e2', 'e3'])
    expect(storySettings(sqlite)?.embedding_model_id).toBe(NEW)

    const after = sqlite
      .prepare(
        'SELECT pk, source_hash, embedding FROM entities_vec_384 WHERE id = ? AND model_id = ?',
      )
      .get('e1', NEW) as { pk: string; source_hash: string; embedding: Uint8Array }
    expect(after.pk).toBe('b1:e1:' + NEW)
    expect(before.pk).toBe('b1:e1:' + OLD)
    expect(after.source_hash).toBe(before.source_hash)
    expect(Buffer.from(after.embedding)).toEqual(Buffer.from(before.embedding))
  })

  it('8b. relabelModel wins over leftover target rows: no pk-constraint error, one row per id', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    // Leftover NEW row for e1 from an abandoned swap toward the same model id.
    seedOldVectors(
      sqlite,
      [{ kind: 'entity', id: 'e1', branchId: 'b1', fields: ['stale', 'leftover'] }],
      NEW,
    )
    const embed = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, embed.fn)

    await expect(
      relabelModel(deps, { storyId: 's1', branchIds: ['b1'], oldModelId: OLD, newModelId: NEW }),
    ).resolves.toBeUndefined()

    expect(embed.calls).toHaveLength(0)
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual([])
    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual(['e1', 'e2', 'e3'])
    // Exactly one row for e1 under NEW — the relabeled OLD row, not the leftover.
    expect(
      (
        sqlite
          .prepare("SELECT source_hash FROM entities_vec_384 WHERE id = 'e1' AND model_id = ?")
          .all(NEW) as { source_hash: string }[]
      ).map((r) => r.source_hash),
    ).toEqual([sourceHash(compositeText(['Name 1', 'Desc 1']))])
    expect(storySettings(sqlite)?.embedding_model_id).toBe(NEW)
  })

  it('9. cancel-requested mid-phase-1: loop stops, cancel path runs, returns cancelled', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ extraEntities: 20 })
    seedOldVectors(sqlite, embedded)
    let checks = 0
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn, {
      isCancelRequested: () => {
        checks += 1
        return checks > 1
      },
    })

    const result = await startSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: cfg(NEW),
    })

    expect(result).toBe('cancelled')
    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual([])
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)
    expect(staleFlag(sqlite, 'entities', 'e1')).toBe(1)
    expect(staleFlag(sqlite, 'chapters', 'c1')).toBe(1)

    const cancelCalls = callsWith(runSpy, 'json_remove')
    expect(cancelCalls).toHaveLength(1)
    expect(cancelCalls[0].filter((op) => op.sql.includes('embedding_stale = 1'))).toHaveLength(5)
    expect(cancelCalls[0].some((op) => op.sql.includes('embedding_model_id'))).toBe(false)
  })

  it('10. deleted-story guard: throws SwapStoryMissingError, no phase-2 transaction runs', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const total = embedded.length
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn, {
      onProgress: (done) => {
        if (done === total) {
          sqlite.exec(
            "PRAGMA foreign_keys=OFF; DELETE FROM stories WHERE id='s1'; PRAGMA foreign_keys=ON;",
          )
        }
      },
    })

    await expect(
      startSwap(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        currentModelId: OLD,
        currentSwapTarget: null,
        targetConfig: cfg(NEW),
      }),
    ).rejects.toBeInstanceOf(SwapStoryMissingError)

    // marker-set + one batch only; the flip transaction never ran.
    expect(runSpy).toHaveBeenCalledTimes(2)
    expect(callsWith(runSpy, 'embedding_model_id')).toHaveLength(0)
  })

  it('10b. null-settings guard: json_set no-ops, so the flip is refused', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ settingsNull: true })
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    await expect(
      startSwap(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        currentModelId: OLD,
        currentSwapTarget: null,
        targetConfig: cfg(NEW),
      }),
    ).rejects.toBeInstanceOf(SwapStoryMissingError)
  })
})
