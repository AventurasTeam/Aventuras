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
  RelabelDimMismatchError,
  SwapInProgressError,
  SwapMarkerChangedError,
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
    return { ops, dim }
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

// Settings transitions are json_patch, so the keys they touch live in the JSON
// payload rather than the SQL text — a `sql.includes('embedding_model_id')`
// needle would match nothing and pass vacuously.
function patchOf(op: SqlOp): Record<string, unknown> | undefined {
  if (!op.sql.includes('json_patch')) return undefined
  return JSON.parse(op.params[0] as string) as Record<string, unknown>
}

type PatchPredicate = (patch: Record<string, unknown>) => boolean

const clearsMarker: PatchPredicate = (patch) =>
  'embedding_swap_target' in patch && patch.embedding_swap_target === null

const flipsModel: PatchPredicate = (patch) => typeof patch.embedding_model_id === 'string'

function hasPatch(ops: SqlOp[], predicate: PatchPredicate): boolean {
  return ops.some((op) => {
    const patch = patchOf(op)
    return patch !== undefined && predicate(patch)
  })
}

function callsPatching(runSpy: ReturnType<typeof vi.fn>, predicate: PatchPredicate): SqlOp[][] {
  return opsOf(runSpy).filter((ops) => hasPatch(ops, predicate))
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

    const flips = callsPatching(runSpy, clearsMarker)
    expect(flips).toHaveLength(1)
    const flip = flips[0]
    expect(hasPatch(flip, flipsModel)).toBe(true)
    expect(flip.some((op) => op.sql.startsWith('DELETE FROM') && op.sql.includes('model_id'))).toBe(
      true,
    )
  })

  it('1b. cross-backend swap: the flip writes backend and provider id with the model', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    const result = await startSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: {
        backend: 'provider',
        providerId: 'prov1',
        modelId: NEW,
        dim: DIM,
        truncation: null,
      },
    })

    expect(result).toBe('completed')
    const s = storySettings(sqlite)
    // A model-id-only flip would leave the story pointing at a provider model
    // under its old local backend — the shape that resolves as
    // `unknown-local-model` on the next embed.
    expect(s?.embedding_model_id).toBe(NEW)
    expect(s?.embeddingBackend).toBe('provider')
    expect(s?.embedding_provider_id).toBe('prov1')

    // The marker carried the target's backend while the swap was in flight, so a
    // crash-resume can resolve it without guessing.
    const markerWrite = callsPatching(
      runSpy,
      (patch) => patch.embedding_swap_target === NEW,
    )[0].map(patchOf)
    expect(markerWrite).toContainEqual({
      embedding_swap_target: NEW,
      embedding_swap_backend: 'provider',
      embedding_swap_provider_id: 'prov1',
    })
  })

  it('1c. provider→local swap: the flip writes the local backend and clears the provider id', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    // Start provider-backed so the flip has a provider id to clear: a model-id-only
    // flip would strand a local model under a provider backend and provider id.
    sqlite.prepare('UPDATE stories SET settings = ? WHERE id = ?').run(
      JSON.stringify({
        embedding_model_id: OLD,
        embeddingBackend: 'provider',
        embedding_provider_id: 'prov1',
      }),
      's1',
    )
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
    const s = storySettings(sqlite)
    expect(s?.embedding_model_id).toBe(NEW)
    expect(s?.embeddingBackend).toBe('local')
    // json_patch deletes on null, so the provider id is gone rather than left
    // pointing at a provider that no longer serves this story.
    expect(s?.embedding_provider_id).toBeUndefined()

    const markerWrite = callsPatching(
      runSpy,
      (patch) => patch.embedding_swap_target === NEW,
    )[0].map(patchOf)
    expect(markerWrite).toContainEqual({
      embedding_swap_target: NEW,
      embedding_swap_backend: 'local',
      embedding_swap_provider_id: null,
    })
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

  it('5. cancelSwap cross-model: deletes NEW, clears marker, re-derives staleness', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ markerTarget: NEW })
    seedOldVectors(sqlite, embedded)
    // Partial stage: only these rows reached the target model, so only these had
    // their flag cleared by staging.
    const staged = embedded.filter((row) => ['e1', 'e2', 'l1'].includes(row.id))
    seedOldVectors(sqlite, staged, NEW)
    // e2 was edited while the swap ran, so its OLD vector no longer describes it.
    sqlite.prepare('UPDATE entities SET description = ? WHERE id = ?').run('Rewritten', 'e2')
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    await cancelSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      targetModelId: NEW,
      currentModelId: OLD,
    })

    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual([])
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(idsForModel(sqlite, 'lore_vec_384', NEW)).toEqual([])
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)

    // Cross-model staging overwrote nothing, so the OLD vectors the story reverts
    // to are still current — flagging them queued a full re-embed, on a paid
    // provider, of exactly the work the user just cancelled.
    expect(staleFlag(sqlite, 'entities', 'e1')).toBe(0)
    expect(staleFlag(sqlite, 'lore', 'l1')).toBe(0)
    // Edited mid-swap: this one's old vector really is out of date.
    expect(staleFlag(sqlite, 'entities', 'e2')).toBe(1)
    // Never staged, so staging never cleared their flag — nothing to restore.
    expect(staleFlag(sqlite, 'entities', 'e3')).toBe(0)
    expect(staleFlag(sqlite, 'happenings', 'h1')).toBe(0)
    expect(staleFlag(sqlite, 'threads', 't1')).toBe(0)
    expect(staleFlag(sqlite, 'chapters', 'c1')).toBe(0)

    expect(runSpy).toHaveBeenCalledTimes(1)
    const ops = opsOf(runSpy)[0]
    expect(hasPatch(ops, clearsMarker)).toBe(true)
    expect(hasPatch(ops, flipsModel)).toBe(false)
  })

  it('5b. cancelSwap same-model with live run state: keeps every vector, flags only the tail', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ markerTarget: OLD })
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    await cancelSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      targetModelId: OLD,
      currentModelId: OLD,
      unprocessed: embedded.filter((row) => ['h1', 't1', 'c1'].includes(row.id)),
    })

    // Staging upserted in place, so the target's rows ARE the story's only
    // vectors — a delete here would wipe the vector space, not unwind a stage.
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)

    // Re-embedded before the cancel: current, so queueing them again would both
    // lie about coverage and redo work the user explicitly stopped.
    expect(staleFlag(sqlite, 'entities', 'e1')).toBe(0)
    expect(staleFlag(sqlite, 'lore', 'l1')).toBe(0)
    // Still holding the embedding the re-index was asked to replace.
    expect(staleFlag(sqlite, 'happenings', 'h1')).toBe(1)
    expect(staleFlag(sqlite, 'threads', 't1')).toBe(1)
    expect(staleFlag(sqlite, 'chapters', 'c1')).toBe(1)

    const ops = opsOf(runSpy)[0]
    expect(ops.some((op) => op.sql.includes('DELETE'))).toBe(false)
  })

  it('5c. cancelSwap same-model without run state: queues the whole story, deletes nothing', async () => {
    const { sqlite, runInTransaction, embedded } = await setup({ markerTarget: OLD })
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    await cancelSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      targetModelId: OLD,
      currentModelId: OLD,
    })

    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(staleFlag(sqlite, 'entities', 'e1')).toBe(1)
    expect(staleFlag(sqlite, 'chapters', 'c1')).toBe(1)

    const ops = opsOf(runSpy)[0]
    expect(ops.some((op) => op.sql.includes('DELETE'))).toBe(false)
    expect(ops.filter((op) => op.sql.includes('embedding_stale = 1'))).toHaveLength(5)
  })

  it('5c. cancel during the FINAL batch still unwinds instead of flipping', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    // 8 rows, BATCH_SIZE 16 — one batch, so the only poll before this cancel is
    // the loop-entry one. Requesting after it lands the cancel with staging done
    // and phase 2 not yet committed: the window the post-loop check exists for.
    let staged = false
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, async (config, rows) => {
      const ops = await fn(config, rows)
      staged = true
      return ops
    })
    deps.isCancelRequested = () => staged

    const result = await startSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: cfg(NEW),
    })

    expect(result).toBe('cancelled')
    // The flip must not have happened: old model still recorded, staged NEW rows gone.
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)
    expect(storySettings(sqlite)?.embedding_swap_target).toBeUndefined()
    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual([])
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(hasPatch(opsOf(runSpy).flat(), (patch) => patch.embedding_model_id === NEW)).toBe(false)
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

  it('7b. same model id, new dim family: phase 2 sweeps the old family, spares the staged one', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    // Swapping a story between a provider copy and a local copy of one model keeps
    // the model id while the truncation (and so the dim family) changes.
    const result = await startSwap(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      currentModelId: OLD,
      currentSwapTarget: null,
      targetConfig: cfg(OLD, 768),
    })

    expect(result).toBe('completed')
    expect(idsForModel(sqlite, 'entities_vec_768', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(idsForModel(sqlite, 'lore_vec_768', OLD)).toEqual(['l1'])
    // The pre-swap family must not survive under the same model id — retrieval
    // resolves one family, so leftovers there are unreachable orphans.
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual([])
    expect(idsForModel(sqlite, 'lore_vec_384', OLD)).toEqual([])
  })

  it('8z. relabel refuses when the target would be read at another dim', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    // The story's vectors live at 384 — say a provider truncating to effectiveDim.
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    await expect(
      relabelModel(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        oldModelId: OLD,
        target: { modelId: OLD, backend: 'local' },
        // The local copy of the same model reads at its full catalog dim.
        targetReadDim: 768,
      }),
    ).rejects.toBeInstanceOf(RelabelDimMismatchError)

    // Relabel never moves a row between families, so going through would have left
    // every vector in a table the story no longer reads — total silent loss on the
    // one path whose whole purpose is to avoid re-embedding.
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('8y. relabel proceeds when the target reads at the dim the vectors already use', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    await relabelModel(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      oldModelId: OLD,
      target: { modelId: NEW, backend: 'local' },
      targetReadDim: DIM,
    })

    expect(idsForModel(sqlite, 'entities_vec_384', NEW)).toEqual(['e1', 'e2', 'e3'])
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual([])
  })

  it('8. relabelModel: rewrites vec identity in SQL, preserves source_hash + embedding, never embeds', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const before = sqlite
      .prepare('SELECT pk, source_hash, embedding FROM entities_vec_384 WHERE id = ?')
      .get('e1') as { pk: string; source_hash: string; embedding: Uint8Array }

    const embed = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, embed.fn)

    await relabelModel(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      oldModelId: OLD,
      target: { modelId: NEW, backend: 'local' },
    })

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
      relabelModel(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        oldModelId: OLD,
        target: { modelId: NEW, backend: 'local' },
      }),
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

  it('8c. relabelModel at the same model id still writes the backend and provider', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite)
    const { deps } = makeDeps(sqlite, runInTransaction, fn)

    // "Same model, now served elsewhere" — the move relabel exists for. Returning
    // early on the model id alone wrote nothing at all for exactly this case.
    await relabelModel(deps, {
      storyId: 's1',
      branchIds: ['b1'],
      oldModelId: OLD,
      target: { modelId: OLD, backend: 'provider', providerId: 'prov1' },
    })

    const s = storySettings(sqlite)
    expect(s?.embedding_model_id).toBe(OLD)
    expect(s?.embeddingBackend).toBe('provider')
    expect(s?.embedding_provider_id).toBe('prov1')
    // Identity is model-scoped, so an unchanged id leaves every vector in place.
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
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
    // Batch 1 covered e1, so staging cleared its flag — but nothing overwrote its
    // OLD vector, and the content has not moved, so the cancel leaves it current.
    expect(staleFlag(sqlite, 'entities', 'e1')).toBe(0)
    // c1 sits past the cancel point and was never touched.
    expect(staleFlag(sqlite, 'chapters', 'c1')).toBe(0)

    const cancelCalls = callsPatching(runSpy, clearsMarker)
    expect(cancelCalls).toHaveLength(1)
    expect(hasPatch(cancelCalls[0], flipsModel)).toBe(false)
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
    expect(callsPatching(runSpy, flipsModel)).toHaveLength(0)
  })

  it('10c. a settings write dropping the marker mid-phase-1 blocks the flip', async () => {
    const { sqlite, runInTransaction, embedded } = await setup()
    seedOldVectors(sqlite, embedded)
    const { fn } = makeEmbedRows(sqlite, {
      beforeBatch: (call) => {
        if (call !== 1) return
        // updateStorySettings merges the whole settings blob in a separate
        // transaction, so a save that read before the marker was written commits
        // a snapshot without it (docs/implementation/triage.md).
        sqlite
          .prepare('UPDATE stories SET settings = ? WHERE id = ?')
          .run(JSON.stringify({ embedding_model_id: OLD }), 's1')
      },
    })
    const { deps, runSpy } = makeDeps(sqlite, runInTransaction, fn)

    await expect(
      startSwap(deps, {
        storyId: 's1',
        branchIds: ['b1'],
        currentModelId: OLD,
        currentSwapTarget: null,
        targetConfig: cfg(NEW),
      }),
    ).rejects.toBeInstanceOf(SwapMarkerChangedError)

    // Flipping regardless would delete every OLD vector and then have the stale
    // snapshot name the old model again: vectors gone, flags clean, nothing to
    // re-derive from. Failing loudly leaves the story exactly as it was.
    expect(storySettings(sqlite)?.embedding_model_id).toBe(OLD)
    expect(idsForModel(sqlite, 'entities_vec_384', OLD)).toEqual(['e1', 'e2', 'e3'])
    expect(callsPatching(runSpy, flipsModel)).toHaveLength(0)
  })

  it('10b. null-settings guard: json_patch no-ops, so the flip is refused', async () => {
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
