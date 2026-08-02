import type { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import {
  VEC_FAMILIES,
  branches,
  clearEmbeddingStaleOp,
  entities,
  lore,
  staleRowsQuery,
  stories,
  toEmbeddedFieldRow,
  type DbCtx,
  type EmbeddedFieldRow,
  type SqlOp,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { EmbedderCallError, EmbedderInitError } from '@/lib/embedder'

import { runSyncStage, type SyncStageDeps } from './sync'

// Mirrors lib/db/runtime/exec.ts's queryRows: rows arrive as arrays of values in
// SELECT order, which is what toEmbeddedFieldRow's positional read depends on.
const queryAllOf =
  (sqlite: DatabaseSync) =>
  async (sql: string, params: unknown[]): Promise<unknown[][]> =>
    (sqlite.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]).map((r) =>
      Object.values(r),
    )

// Same shape as lib/actions/embedder-swap/app-deps.ts's loadStaleRows, so the
// branch predicate and column order under test are the shipped ones.
const loaderOf =
  (sqlite: DatabaseSync): SyncStageDeps['loadStaleRows'] =>
  async (branchIds) => {
    const queryAll = queryAllOf(sqlite)
    const out: EmbeddedFieldRow[] = []
    for (const kind of Object.keys(VEC_FAMILIES) as VecTargetKind[]) {
      const { sql, params } = staleRowsQuery(kind, branchIds)
      out.push(...(await queryAll(sql, params)).map((row) => toEmbeddedFieldRow(kind, row)))
    }
    return out
  }

type Seed = { kind: 'lore' | 'entity'; id: string; branchId?: string; stale?: 0 | 1 }

async function setup(seeds: Seed[]) {
  const { db, sqlite, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 },
  ])

  const loreSeeds = seeds.filter((s) => s.kind === 'lore')
  if (loreSeeds.length > 0) {
    await db.insert(lore).values(
      loreSeeds.map((s) => ({
        id: s.id,
        branchId: s.branchId ?? 'br_1',
        title: `Title ${s.id}`,
        body: `Body ${s.id}`,
        injectionMode: 'auto' as const,
        embeddingStale: s.stale ?? 1,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
  }
  const entitySeeds = seeds.filter((s) => s.kind === 'entity')
  if (entitySeeds.length > 0) {
    await db.insert(entities).values(
      entitySeeds.map((s) => ({
        id: s.id,
        branchId: s.branchId ?? 'br_1',
        kind: 'character' as const,
        name: `Name ${s.id}`,
        description: `Desc ${s.id}`,
        status: 'active' as const,
        injectionMode: 'auto' as const,
        embeddingStale: s.stale ?? 1,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
  }
  return { sqlite, runInTransaction }
}

function depsFor(
  sqlite: DatabaseSync,
  runInTransaction: DbCtx['runInTransaction'],
  opts: {
    branchIds?: readonly string[]
    embedRows?: SyncStageDeps['embedRows']
    loadStaleRows?: SyncStageDeps['loadStaleRows']
  } = {},
) {
  const embedRows = vi.fn<SyncStageDeps['embedRows']>(
    opts.embedRows ??
      (async (rows) => rows.map((r) => clearEmbeddingStaleOp(r.kind, r.id, r.branchId))),
  )
  const tx = vi.fn<DbCtx['runInTransaction']>(runInTransaction)
  return {
    branchIds: opts.branchIds ?? ['br_1'],
    loadStaleRows: opts.loadStaleRows ?? loaderOf(sqlite),
    embedRows,
    runInTransaction: tx,
  }
}

const staleFlags = (sqlite: DatabaseSync, table: 'lore' | 'entities'): Record<string, number> =>
  Object.fromEntries(
    (
      sqlite.prepare(`SELECT id, embedding_stale FROM ${table} ORDER BY id`).all() as {
        id: string
        embedding_stale: number
      }[]
    ).map((r) => [r.id, r.embedding_stale]),
  )

const embeddedIds = (embedRows: { mock: { calls: [EmbeddedFieldRow[]][] } }, call = 0): string[] =>
  embedRows.mock.calls[call][0].map((r) => r.id).sort()

describe('runSyncStage', () => {
  it('embeds every stale row in one batch and clears their flags', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
      { kind: 'lore', id: 'lo_fresh', stale: 0 },
      { kind: 'entity', id: 'en_a' },
    ])
    const d = depsFor(sqlite, runInTransaction)

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 3 })
    expect(d.embedRows).toHaveBeenCalledTimes(1)
    expect(embeddedIds(d.embedRows)).toEqual(['en_a', 'lo_a', 'lo_b'])
    expect(d.runInTransaction).toHaveBeenCalledTimes(1)
    expect(staleFlags(sqlite, 'lore')).toMatchObject({ lo_a: 0, lo_b: 0 })
    expect(staleFlags(sqlite, 'entities')).toEqual({ en_a: 0 })
  })

  // The scope difference from the drain worker, which warms the open branch only.
  it('embeds the union of every requested branch', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_main', branchId: 'br_1' },
      { kind: 'lore', id: 'lo_alt', branchId: 'br_2' },
    ])
    const d = depsFor(sqlite, runInTransaction, { branchIds: ['br_1', 'br_2'] })

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 2 })
    expect(embeddedIds(d.embedRows)).toEqual(['lo_alt', 'lo_main'])
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_alt: 0, lo_main: 0 })
  })

  it('loads the stale set for the requested branches only', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_here', branchId: 'br_1' },
      { kind: 'lore', id: 'lo_elsewhere', branchId: 'br_2' },
    ])
    const d = depsFor(sqlite, runInTransaction, { branchIds: ['br_1'] })

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 1 })
    expect(embeddedIds(d.embedRows)).toEqual(['lo_here'])
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_elsewhere: 1, lo_here: 0 })
  })

  it('is a no-op with no embed and no transaction when nothing is stale', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a', stale: 0 }])
    const d = depsFor(sqlite, runInTransaction)

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 0 })
    expect(d.embedRows).not.toHaveBeenCalled()
    expect(d.runInTransaction).not.toHaveBeenCalled()
  })

  it('sends the whole dirty set in one call rather than the drain worker chunks', async () => {
    const seeds: Seed[] = Array.from({ length: 40 }, (_, i) => ({
      kind: 'lore' as const,
      id: `lo_${String(i).padStart(2, '0')}`,
    }))
    const { sqlite, runInTransaction } = await setup(seeds)
    const d = depsFor(sqlite, runInTransaction)

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 40 })
    expect(d.embedRows).toHaveBeenCalledTimes(1)
    expect(embeddedIds(d.embedRows)).toEqual(seeds.map((s) => s.id))
  })

  it('reports an init failure as a blocking result and leaves every flag set', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async () => {
        throw new EmbedderInitError('model file missing')
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'init',
      detail: 'model file missing',
      staleCount: 2,
    })
    expect(d.runInTransaction).not.toHaveBeenCalled()
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 1, lo_b: 1 })
  })

  it('reports a call failure with its own reason', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a' }])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async () => {
        throw new EmbedderCallError('provider 503')
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'call',
      detail: 'provider 503',
      staleCount: 1,
    })
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 1 })
  })

  it('reports the stale count even when the embedder drains the row array', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async (rows) => {
        rows.length = 0
        throw new EmbedderCallError('drained then failed')
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'call',
      detail: 'drained then failed',
      staleCount: 2,
    })
  })

  it('classifies an untyped throw as an init failure', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a' }])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async () => {
        throw new Error('something else')
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'init',
      detail: 'something else',
      staleCount: 1,
    })
  })

  it('stringifies a non-Error throw into the detail', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a' }])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async () => {
        throw 'embedder worker vanished'
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'init',
      detail: 'embedder worker vanished',
      staleCount: 1,
    })
  })

  it('rolls back the batch when one op fails, leaving every flag set', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async (rows) => [
        clearEmbeddingStaleOp(rows[0].kind, rows[0].id, rows[0].branchId),
        { sql: 'UPDATE no_such_table SET embedding_stale = 0', params: [] } satisfies SqlOp,
        clearEmbeddingStaleOp(rows[1].kind, rows[1].id, rows[1].branchId),
      ],
    })

    const result = await runSyncStage(d)
    expect(result).toMatchObject({ ok: false, reason: 'init', staleCount: 2 })
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 1, lo_b: 1 })
  })

  it('reports a stale-row load failure with an unknown stale count', async () => {
    const { sqlite, runInTransaction } = await setup([])
    const d = depsFor(sqlite, runInTransaction, {
      loadStaleRows: async () => {
        throw new Error('db unreachable')
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'init',
      detail: 'db unreachable',
      staleCount: null,
    })
    expect(d.embedRows).not.toHaveBeenCalled()
  })
})
