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
import { EmbedderCallError, EmbedderCancelledError, EmbedderInitError } from '@/lib/embedder'

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
    revalidateRows?: SyncStageDeps['revalidateRows']
    abortSignal?: AbortSignal
  } = {},
) {
  const embedRows = vi.fn<SyncStageDeps['embedRows']>(
    opts.embedRows ?? (async (rows) => rows.map((r) => clearEmbeddingStaleOp(r))),
  )
  const tx = vi.fn<DbCtx['runInTransaction']>(runInTransaction)
  return {
    branchIds: opts.branchIds ?? ['br_1'],
    loadStaleRows: opts.loadStaleRows ?? loaderOf(sqlite),
    revalidateRows:
      opts.revalidateRows ??
      (async (rows: EmbeddedFieldRow[]) => ({ staleRows: rows, freshOps: [] })),
    embedRows,
    runInTransaction: tx,
    ...(opts.abortSignal != null ? { abortSignal: opts.abortSignal } : {}),
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

const embeddedIds = (
  embedRows: { mock: { calls: [EmbeddedFieldRow[], (AbortSignal | undefined)?][] } },
  call = 0,
): string[] => embedRows.mock.calls[call][0].map((r) => r.id).sort()

describe('runSyncStage', () => {
  it('embeds every stale row in one batch and clears their flags', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
      { kind: 'lore', id: 'lo_fresh', stale: 0 },
      { kind: 'entity', id: 'en_a' },
    ])
    const d = depsFor(sqlite, runInTransaction)

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 3, revalidated: 0 })
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

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 2, revalidated: 0 })
    expect(embeddedIds(d.embedRows)).toEqual(['lo_alt', 'lo_main'])
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_alt: 0, lo_main: 0 })
  })

  it('loads the stale set for the requested branches only', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_here', branchId: 'br_1' },
      { kind: 'lore', id: 'lo_elsewhere', branchId: 'br_2' },
    ])
    const d = depsFor(sqlite, runInTransaction, { branchIds: ['br_1'] })

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 1, revalidated: 0 })
    expect(embeddedIds(d.embedRows)).toEqual(['lo_here'])
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_elsewhere: 1, lo_here: 0 })
  })

  it('is a no-op with no embed and no transaction when nothing is stale', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a', stale: 0 }])
    const d = depsFor(sqlite, runInTransaction)

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 0, revalidated: 0 })
    expect(d.embedRows).not.toHaveBeenCalled()
    expect(d.runInTransaction).not.toHaveBeenCalled()
  })

  // retrieval.md → Compute lifecycle: a restored row "revalidates to 0 with no re-embed".
  it('clears a revalidated-fresh row instead of paying to re-embed it', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_restored' },
      { kind: 'lore', id: 'lo_drifted' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      revalidateRows: async (rows) => ({
        staleRows: rows.filter((r) => r.id === 'lo_drifted'),
        freshOps: rows.filter((r) => r.id === 'lo_restored').map(clearEmbeddingStaleOp),
      }),
    })

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 1, revalidated: 1 })
    expect(embeddedIds(d.embedRows)).toEqual(['lo_drifted'])
    // The clears land in their own commit, ahead of the embed's ops.
    expect(d.runInTransaction).toHaveBeenCalledTimes(2)
    expect(d.runInTransaction.mock.calls[0][0].map((op) => op.params)).toEqual([
      ['lo_restored', 'br_1', 'Title lo_restored', 'Body lo_restored'],
    ])
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_drifted: 0, lo_restored: 0 })
  })

  it('spends no embed call when every dirty row revalidates fresh', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      revalidateRows: async (rows) => ({
        staleRows: [],
        freshOps: rows.map(clearEmbeddingStaleOp),
      }),
    })

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 0, revalidated: 2 })
    expect(d.embedRows).not.toHaveBeenCalled()
    expect(d.runInTransaction).toHaveBeenCalledOnce()
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 0, lo_b: 0 })
  })

  // A matching stored vector justifies the clear on its own, so the rows that did
  // NOT drift stay clean through a failure of the embed for the rows that did.
  it('keeps the fresh clears and reports the revalidated count when the embed fails', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
      { kind: 'lore', id: 'lo_c' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      revalidateRows: async (rows) => ({
        staleRows: rows.filter((r) => r.id !== 'lo_a'),
        freshOps: rows.filter((r) => r.id === 'lo_a').map(clearEmbeddingStaleOp),
      }),
      embedRows: async () => {
        throw new EmbedderCallError('provider 503')
      },
    })

    expect(await runSyncStage(d)).toEqual({
      ok: false,
      reason: 'call',
      detail: 'provider 503',
      staleCount: 2,
      revalidated: 1,
    })
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 0, lo_b: 1, lo_c: 1 })
  })

  it('sends the whole dirty set in one call rather than the drain worker chunks', async () => {
    const seeds: Seed[] = Array.from({ length: 40 }, (_, i) => ({
      kind: 'lore' as const,
      id: `lo_${String(i).padStart(2, '0')}`,
    }))
    const { sqlite, runInTransaction } = await setup(seeds)
    const d = depsFor(sqlite, runInTransaction)

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 40, revalidated: 0 })
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
      revalidated: 0,
    })
    expect(d.runInTransaction).not.toHaveBeenCalled()
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 1, lo_b: 1 })
  })

  // The whole point of the cancelled arm: a stop must not arrive as a `reason` the
  // failure surface can render, indistinguishable from a dead provider.
  it('reports a cancellation as its own arm, carrying no failure reason', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a' }])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async () => {
        throw new EmbedderCancelledError('embed cancelled')
      },
    })

    const result = await runSyncStage(d)

    expect(result).toEqual({ ok: false, cancelled: true, revalidated: 0 })
    // Spelled out because it is the property the failure surface reads: there is
    // no reason on this arm to render, and no staleCount to report as a fault.
    expect(result).not.toHaveProperty('reason')
    expect(result).not.toHaveProperty('staleCount')
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
      revalidated: 0,
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
      revalidated: 0,
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
      revalidated: 0,
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
      revalidated: 0,
    })
  })

  it('rolls back the batch when one op fails, leaving every flag set', async () => {
    const { sqlite, runInTransaction } = await setup([
      { kind: 'lore', id: 'lo_a' },
      { kind: 'lore', id: 'lo_b' },
    ])
    const d = depsFor(sqlite, runInTransaction, {
      embedRows: async (rows) => [
        clearEmbeddingStaleOp(rows[0]),
        { sql: 'UPDATE no_such_table SET embedding_stale = 0', params: [] } satisfies SqlOp,
        clearEmbeddingStaleOp(rows[1]),
      ],
    })

    await expect(runSyncStage(d)).rejects.toThrow(/no_such_table/)
    expect(staleFlags(sqlite, 'lore')).toEqual({ lo_a: 1, lo_b: 1 })
  })

  // The commit is database work, so it escapes to the caller rather than
  // reporting on the embedder surface, whose fix action re-indexes the story.
  it('lets a commit fault escape instead of blaming the embedder', async () => {
    const { sqlite } = await setup([{ kind: 'lore', id: 'lo_a' }])
    const locked = new Error('SQLITE_BUSY: database is locked')
    const d = depsFor(
      sqlite,
      async () => {
        throw locked
      },
      {},
    )

    await expect(runSyncStage(d)).rejects.toThrow(locked)
  })

  // The counterpart on the read side: a dirty-set load is the same DB work.
  it('lets a stale-row load failure escape instead of blaming the embedder', async () => {
    const { sqlite, runInTransaction } = await setup([])
    const unreachable = new Error('db unreachable')
    const d = depsFor(sqlite, runInTransaction, {
      loadStaleRows: async () => {
        throw unreachable
      },
    })

    await expect(runSyncStage(d)).rejects.toThrow(unreachable)
    expect(d.embedRows).not.toHaveBeenCalled()
  })

  // The sync stage is the turn's hard gate: without the signal reaching the
  // embedder, Cancel during a blocking embed reaches nothing and the turn holds
  // the gate for the full timeout. Nothing else in the suite pins the hand-off.
  it('hands the abort signal to the embedder', async () => {
    const { sqlite, runInTransaction } = await setup([{ kind: 'lore', id: 'lo_a' }])
    const abortSignal = new AbortController().signal
    const d = depsFor(sqlite, runInTransaction, { abortSignal })

    expect(await runSyncStage(d)).toEqual({ ok: true, embedded: 1, revalidated: 0 })
    expect(d.embedRows).toHaveBeenCalledWith(expect.anything(), abortSignal)
  })
})
