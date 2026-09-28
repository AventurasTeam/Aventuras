import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { embedViaProvider } from '@/lib/ai'
import type { ProviderInstanceWithStub } from '@/lib/ai'
import {
  compositeText,
  packFloat32,
  SOURCE_TABLES,
  sourceHash,
  staleRowsQuery,
  toEmbeddedFieldRow,
  vecTableName,
  type EmbeddedFieldRow,
  type SqlOp,
  type VecTargetKind,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { KIND_COLUMNS } from '@/lib/db/embeddings/stale'
import { logger } from '@/lib/diagnostics'

import { embedLocal } from './local/runtime'
import { embedAndBuildVecOps, embedRowsToVecOps, embedTexts, testEmbedder } from './service'
import { EmbedderCallError, EmbedderInitError, type EmbedderConfig } from './types'

// Hoisted so the mock identities survive vi.resetModules() — the lazy-init test
// re-evaluates ./service, and a factory-local vi.fn() would hand the fresh module
// a different spy than the one asserted on here.
const mocks = vi.hoisted(() => ({ embedLocal: vi.fn(), embedViaProvider: vi.fn() }))
vi.mock('./local/runtime', () => ({ embedLocal: mocks.embedLocal }))
vi.mock('@/lib/ai', () => ({ embedViaProvider: mocks.embedViaProvider }))

const MINILM = 'Xenova/all-MiniLM-L6-v2'
const GEMMA = 'onnx-community/embeddinggemma-300m-ONNX'

const provider: ProviderInstanceWithStub = {
  id: 'prov-1',
  type: 'openai-compatible',
  displayName: 'Local',
  apiKey: 'sk-local',
  endpoint: 'http://localhost:1234/v1',
  favoriteModelIds: [],
}

function unit(values: number[]): Float32Array {
  const v = new Float32Array(values)
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum)
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm
  return v
}

function normOf(v: Float32Array): number {
  let sum = 0
  for (const x of v) sum += x * x
  return Math.sqrt(sum)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('embedTexts routing + prefixing', () => {
  it('routes local MiniLM with unprefixed texts and returns unit-norm vectors', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [unit([0.6, 0.8])], dim: 2, truncated: [] })

    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 2 }
    const result = await embedTexts(config, ['hello'], 'document')

    expect(embedLocal).toHaveBeenCalledWith(MINILM, ['hello'], undefined)
    expect(normOf(result.vectors[0])).toBeCloseTo(1, 6)
    expect(result.dim).toBe(2)
  })

  it('applies Gemma document/query prefixes per intent', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [unit([1, 0])], dim: 2, truncated: [] })
    const config: EmbedderConfig = { backend: 'local', modelId: GEMMA, dim: 2 }

    await embedTexts(config, ['world'], 'document')
    expect(embedLocal).toHaveBeenLastCalledWith(GEMMA, ['title: none | text: world'], undefined)

    await embedTexts(config, ['world'], 'query')
    expect(embedLocal).toHaveBeenLastCalledWith(
      GEMMA,
      ['task: search result | query: world'],
      undefined,
    )
  })

  it('forwards the abort signal to the local runtime', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [unit([1, 0])], dim: 2, truncated: [] })
    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 2 }
    const controller = new AbortController()

    await embedTexts(config, ['hello'], 'document', undefined, controller.signal)

    expect(embedLocal).toHaveBeenCalledWith(MINILM, ['hello'], controller.signal)
  })

  it('routes provider configs to embedViaProvider (no prefix) and normalizes returned vectors', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({ vectors: [new Float32Array([3, 4])], dim: 2 })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'prov-1',
      modelId: 'm1',
      dim: 2,
      truncation: null,
    }

    const result = await embedTexts(config, ['x'], 'document', provider)

    expect(embedViaProvider).toHaveBeenCalledWith(
      provider,
      'm1',
      ['x'],
      undefined,
      undefined,
      undefined,
    )
    expect(normOf(result.vectors[0])).toBeCloseTo(1, 6)
    expect(Array.from(result.vectors[0])).toEqual([0.6, 0.8].map((n) => Math.fround(n)))
  })

  it('throws EmbedderInitError when a provider config has no provider instance', async () => {
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'prov-1',
      modelId: 'm1',
      dim: 2,
      truncation: null,
    }
    await expect(embedTexts(config, ['x'])).rejects.toBeInstanceOf(EmbedderInitError)
    await expect(embedTexts(config, ['x'])).rejects.toThrow('provider instance not supplied')
  })
})

describe('embedTexts dim verification', () => {
  it('throws EmbedderCallError when returned dim differs from a known config dim', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [unit([1, 0])], dim: 2, truncated: [] })
    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 384 }

    await expect(embedTexts(config, ['a'])).rejects.toBeInstanceOf(EmbedderCallError)
    await expect(embedTexts(config, ['a'])).rejects.toThrow('expected 384, got 2')
  })

  it('throws EmbedderCallError when the backend returns fewer vectors than texts', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({ vectors: [new Float32Array([1, 0])], dim: 2 })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'prov-1',
      modelId: 'm1',
      dim: 2,
      truncation: null,
    }

    await expect(embedTexts(config, ['a', 'b'], 'document', provider)).rejects.toThrow(
      'embedding count mismatch: expected 2 vectors, got 1',
    )
  })

  it('accepts the returned dim when a provider dim is not yet probed', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({ vectors: [new Float32Array([3, 4])], dim: 2 })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'prov-1',
      modelId: 'm1',
      dim: null,
      truncation: null,
    }

    const result = await embedTexts(config, ['a'], 'document', provider)
    expect(result.dim).toBe(2)
  })

  it('still checks the dim for a local config — no unprobed escape hatch', async () => {
    vi.mocked(embedLocal).mockResolvedValue({
      vectors: [new Float32Array([1, 0, 0])],
      dim: 3,
      truncated: [],
    })
    const config: EmbedderConfig = {
      backend: 'local',
      modelId: 'Xenova/all-MiniLM-L6-v2',
      dim: 384,
    }

    await expect(embedTexts(config, ['a'])).rejects.toThrow(
      'embedding dim mismatch: expected 384, got 3',
    )
  })
})

describe('matryoshka truncation', () => {
  it('truncates provider vectors to effectiveDim and re-normalizes to unit length', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({
      vectors: [new Float32Array([1, 1, 1, 1, 1, 1, 1, 1])],
      dim: 8,
    })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'p',
      modelId: 'm',
      dim: 8,
      truncation: { effectiveDim: 4, serverSide: false },
    }

    const { vectors, dim } = await embedTexts(config, ['x'], 'document', provider)

    expect(dim).toBe(4)
    expect(vectors[0]).toHaveLength(4)
    const norm = Math.hypot(...vectors[0])
    expect(norm).toBeCloseTo(1, 5)
    expect(packFloat32(vectors[0]).byteLength).toBe(4 * 4)
  })

  it('clamps effectiveDim above native to native (no-op truncation)', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({
      vectors: [new Float32Array([1, 1, 1, 1, 1, 1, 1, 1])],
      dim: 8,
    })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'p',
      modelId: 'm',
      dim: null,
      truncation: { effectiveDim: 4096, serverSide: false },
    }

    const { dim } = await embedTexts(config, ['x'], 'document', provider)

    expect(dim).toBe(8)
  })

  it('non-matryoshka story stores native dim untouched', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({
      vectors: [new Float32Array([1, 1, 1, 1, 1, 1, 1, 1])],
      dim: 8,
    })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'p',
      modelId: 'm',
      dim: 8,
      truncation: null,
    }

    const { dim } = await embedTexts(config, ['x'], 'document', provider)

    expect(dim).toBe(8)
  })

  it('requests the provider-side dimensions param only when truncation is serverSide', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({
      vectors: [new Float32Array([1, 1, 1, 1, 1, 1, 1, 1])],
      dim: 8,
    })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'p',
      modelId: 'm',
      dim: 8,
      truncation: { effectiveDim: 4, serverSide: true },
    }

    await embedTexts(config, ['x'], 'document', provider)

    expect(embedViaProvider).toHaveBeenCalledWith(provider, 'm', ['x'], undefined, 4, undefined)
  })

  it('accepts an already-truncated vector when the server honors dimensions', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({
      vectors: [unit([1, 1, 1, 1])],
      dim: 4,
    })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'p',
      modelId: 'm',
      dim: 8,
      truncation: { effectiveDim: 4, serverSide: true },
    }

    const { vectors, dim } = await embedTexts(config, ['x'], 'document', provider)

    expect(dim).toBe(4)
    expect(vectors[0]).toHaveLength(4)
    expect(normOf(vectors[0])).toBeCloseTo(1, 6)
  })

  it('still rejects a dim that matches neither native nor effectiveDim', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({
      vectors: [new Float32Array([1, 1, 1, 1, 1, 1])],
      dim: 6,
    })
    const config: EmbedderConfig = {
      backend: 'provider',
      providerId: 'p',
      modelId: 'm',
      dim: 8,
      truncation: { effectiveDim: 4, serverSide: true },
    }

    await expect(embedTexts(config, ['x'], 'document', provider)).rejects.toBeInstanceOf(
      EmbedderCallError,
    )
    await expect(embedTexts(config, ['x'], 'document', provider)).rejects.toThrow(
      'expected 8, got 6',
    )
  })
})

describe('lazy init', () => {
  it('does not invoke the runtime factories on import (only on first embed call)', async () => {
    // resetModules, not a bare import: ./service is statically imported above,
    // so a plain dynamic import would hand back the cached module without
    // re-running its top-level code — and any violation would have fired during
    // that first import, before clearAllMocks could observe it.
    vi.resetModules()
    vi.clearAllMocks()
    await import('./service')
    expect(embedLocal).not.toHaveBeenCalled()
    expect(embedViaProvider).not.toHaveBeenCalled()
  })
})

const MIGRATIONS_DIR = 'lib/db/migrations'

function migrationTags(): string[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag)
}

function applyMigration(sqlite: DatabaseSync, tag: string): void {
  const sql = readFileSync(`${MIGRATIONS_DIR}/${tag}.sql`, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) sqlite.exec(trimmed)
  }
}

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { allowExtension: true })
  db.loadExtension(getLoadablePath())
  for (const tag of migrationTags()) applyMigration(db, tag)
  return db
}

function runOps(db: DatabaseSync, ops: SqlOp[]): void {
  db.exec('BEGIN')
  try {
    for (const op of ops) db.prepare(op.sql).run(...(op.params as SQLInputValue[]))
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function oneHot(dim: number, at: number): Float32Array {
  const v = new Float32Array(dim)
  v[at] = 1
  return v
}

describe('embedAndBuildVecOps integration', () => {
  let db: DatabaseSync
  const now = Date.now()

  beforeEach(() => {
    db = makeDb()
    db.prepare(`insert into stories (id, title, created_at, updated_at) values (?, ?, ?, ?)`).run(
      's1',
      'Story',
      now,
      now,
    )
    db.prepare(`insert into branches (id, story_id, name, created_at) values (?, ?, ?, ?)`).run(
      'b1',
      's1',
      'main',
      now,
    )
    // description matters: clearEmbeddingStaleOp only clears a row still holding
    // the fields the embed read, so a fixture that seeds NULL here while passing
    // 'a scout' below would assert the clear against content that never matched.
    db.prepare(
      `insert into entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
       values (?, ?, 'character', ?, ?, 'active', 'always', 1, ?, ?)`,
    ).run('e1', 'b1', 'Kara', 'a scout', now, now)
  })

  it('ensures vec tables, lands a KNN-visible row, and flips embedding_stale to 0', async () => {
    const queryVec = oneHot(384, 3)
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [queryVec], dim: 384, truncated: [] })

    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 384 }
    const ops = await embedAndBuildVecOps(
      config,
      [{ kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] }],
      async (sql) => {
        db.exec(sql)
      },
    )
    runOps(db, ops)

    const knn = db
      .prepare(
        'select id from entities_vec_384 where embedding match ? and k = 1 and branch_id = ?',
      )
      .all(new Uint8Array(queryVec.buffer), 'b1') as { id: string }[]
    expect(knn).toHaveLength(1)
    expect(knn[0].id).toBe('e1')

    const stale = db.prepare('select embedding_stale from entities where id = ?').get('e1') as {
      embedding_stale: number
    }
    expect(stale.embedding_stale).toBe(0)
  })

  it('rethrows a failing vec-table ensure as EmbedderCallError', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [oneHot(384, 0)], dim: 384, truncated: [] })
    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 384 }

    const failingExec = async () => {
      throw new Error('disk full')
    }
    await expect(
      embedAndBuildVecOps(
        config,
        [{ kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara'] }],
        failingExec,
      ),
    ).rejects.toThrow('vec table ensure failed: disk full')
    await expect(
      embedAndBuildVecOps(
        config,
        [{ kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara'] }],
        failingExec,
      ),
    ).rejects.toBeInstanceOf(EmbedderCallError)
  })

  it('returns no ops for an empty row set', async () => {
    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 384 }
    const ops = await embedAndBuildVecOps(config, [], async () => {})
    expect(ops).toEqual([])
    expect(embedLocal).not.toHaveBeenCalled()
  })
})

describe('testEmbedder', () => {
  it('returns a success result with a non-negative duration', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [unit([1, 0])], dim: 2, truncated: [] })
    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 2 }

    const result = await testEmbedder(config)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dim).toBe(2)
      expect(result.ms).toBeGreaterThanOrEqual(0)
    }
  })

  it('captures an init failure into the result union without throwing', async () => {
    vi.mocked(embedLocal).mockRejectedValue(new EmbedderInitError('session never came up'))
    const config: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 2 }

    const result = await testEmbedder(config)
    expect(result).toEqual({ ok: false, kind: 'init', message: 'session never came up' })
  })
})

describe('embedAndBuildVecOps — vector/row alignment', () => {
  // The builder correlates rows[i], vectors[i] and composites[i] by index. A
  // transposition attaches the wrong embedding to the wrong entity, clears its
  // stale flag, and never self-heals — and one-row fixtures cannot detect it.
  it('pairs each row with its own vector and its own composite hash', async () => {
    const rows: EmbeddedFieldRow[] = [
      { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] },
      { kind: 'entity', id: 'e2', branchId: 'b1', fields: ['Bram', 'a smith'] },
      { kind: 'lore', id: 'l1', branchId: 'b1', fields: ['The Reach', 'cold north'] },
    ]
    // Distinguishable one-hot vectors, in row order.
    const vectors = [
      new Float32Array([1, 0, 0]),
      new Float32Array([0, 1, 0]),
      new Float32Array([0, 0, 1]),
    ]
    vi.mocked(embedLocal).mockResolvedValue({ vectors, dim: 3, truncated: [] })

    const ops = await embedAndBuildVecOps(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 3 },
      rows,
      async () => {},
    )

    // Each row contributes an upsert (params: pk, branchId, modelId, id, hash,
    // vector) followed by its stale-clear.
    const upserts = ops.filter((op) => op.sql.includes('INSERT INTO'))
    expect(upserts).toHaveLength(3)

    for (const [i, row] of rows.entries()) {
      const params = upserts[i].params
      expect(params).toContain(row.id)
      expect(params).toContain(sourceHash(compositeText(row.fields)))
      const packed = params.find((p) => p instanceof Uint8Array) as Uint8Array
      expect(new Float32Array(packed.buffer, packed.byteOffset, 3)).toEqual(vectors[i])
    }
  })

  it('embeds the composites in row order, so the model sees each row once', async () => {
    const rows: EmbeddedFieldRow[] = [
      { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] },
      { kind: 'entity', id: 'e2', branchId: 'b1', fields: ['Bram', 'a smith'] },
    ]
    vi.mocked(embedLocal).mockResolvedValue({
      vectors: [new Float32Array([1, 0]), new Float32Array([0, 1])],
      dim: 2,
      truncated: [],
    })

    await embedAndBuildVecOps(
      { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 2 },
      rows,
      async () => {},
    )

    const texts = vi.mocked(embedLocal).mock.calls.at(-1)?.[1]
    expect(texts).toEqual(['Kara a scout', 'Bram a smith'])
  })
})

describe('truncation reporting', () => {
  const localConfig = { backend: 'local', modelId: 'Xenova/all-MiniLM-L6-v2', dim: 2 } as const
  const rows = [
    { kind: 'entity', id: 'e1', branchId: 'b1', fields: ['Kara', 'a scout'] },
    { kind: 'lore', id: 'l1', branchId: 'b1', fields: ['Harbour', 'a long body'] },
  ] as never[]
  const exec = async () => {}

  it('passes the local runtime’s report through', async () => {
    vi.mocked(embedLocal).mockResolvedValue({ vectors: [unit([1, 0])], dim: 2, truncated: [0] })

    const result = await embedTexts(localConfig, ['long'], 'document')

    expect(result.truncated).toEqual([0])
  })

  // null is not []: a provider cannot report the cut, so [] would be a false claim.
  it('reports null for a provider, which cannot say', async () => {
    vi.mocked(embedViaProvider).mockResolvedValue({ vectors: [new Float32Array([1, 0])], dim: 2 })

    const result = await embedTexts(
      { backend: 'provider', providerId: 'p1', modelId: 'm', dim: 2, truncation: null },
      ['long'],
      'document',
      {} as never,
    )

    expect(result.truncated).toBeNull()
  })

  it('names the truncated rows by kind and id', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.mocked(embedLocal).mockResolvedValue({
      vectors: [unit([1, 0]), unit([0, 1])],
      dim: 2,
      truncated: [1],
    })

    await embedRowsToVecOps(localConfig, rows, exec)

    expect(warn).toHaveBeenCalledWith(
      'embedder.input_truncated',
      expect.objectContaining({ count: 1, rows: ['lore:l1'] }),
    )
  })

  it('stays silent when nothing was cut', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.mocked(embedLocal).mockResolvedValue({
      vectors: [unit([1, 0]), unit([0, 1])],
      dim: 2,
      truncated: [],
    })

    await embedRowsToVecOps(localConfig, rows, exec)

    expect(warn).not.toHaveBeenCalledWith('embedder.input_truncated', expect.anything())
  })

  // A main process predating the field sends nothing back; a diagnostic must not
  // turn that into a failed embed.
  it('survives a runtime that reports no truncation field at all', async () => {
    vi.mocked(embedLocal).mockResolvedValue({
      vectors: [unit([1, 0]), unit([0, 1])],
      dim: 2,
    } as never)

    await expect(embedRowsToVecOps(localConfig, rows, exec)).resolves.toBeDefined()
  })
})

describe('embedRowsToVecOps — per-kind guard against a source row that moved on', () => {
  const KINDS: VecTargetKind[] = ['entity', 'lore', 'happening', 'thread', 'chapter']
  const cfg: EmbedderConfig = { backend: 'local', modelId: MINILM, dim: 384 }

  beforeEach(() => {
    vi.mocked(embedLocal).mockImplementation(async (_id, texts: string[]) => ({
      vectors: texts.map((_, i) => {
        const v = new Float32Array(384)
        v[i % 384] = 1
        return v
      }),
      dim: 384,
      truncated: [],
    }))
  })

  // One row per kind, id 'x1', on branch b1 — and the same id + text on a b2
  // fork when withStory is false, so the delete test can assert b2 is untouched.
  function seedKindRows(sqlite: DatabaseSync, branch: string, withStory: boolean): void {
    const now = 1000
    if (withStory) {
      sqlite
        .prepare('INSERT INTO stories (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('s1', 'S', now, now)
    }
    sqlite
      .prepare('INSERT INTO branches (id, story_id, name, created_at) VALUES (?, ?, ?, ?)')
      .run(branch, 's1', branch, now)
    sqlite
      .prepare(
        `INSERT INTO entities (id, branch_id, kind, name, description, status, injection_mode, embedding_stale, created_at, updated_at)
         VALUES ('x1', ?, 'character', 'Kael', NULL, 'active', 'auto', 1, ?, ?)`,
      )
      .run(branch, now, now)
    sqlite
      .prepare(
        `INSERT INTO lore (id, branch_id, title, body, injection_mode, embedding_stale, created_at, updated_at)
         VALUES ('x1', ?, 'Lore One', 'Body one', 'auto', 1, ?, ?)`,
      )
      .run(branch, now, now)
    sqlite
      .prepare(
        `INSERT INTO happenings (id, branch_id, title, description, embedding_stale, created_at, updated_at)
         VALUES ('x1', ?, 'Happening One', 'It happened', 1, ?, ?)`,
      )
      .run(branch, now, now)
    sqlite
      .prepare(
        `INSERT INTO threads (id, branch_id, title, description, status, injection_mode, embedding_stale, created_at, updated_at)
         VALUES ('x1', ?, 'Thread One', 'A tension', 'active', 'auto', 1, ?, ?)`,
      )
      .run(branch, now, now)
    sqlite
      .prepare(
        `INSERT INTO chapters (id, branch_id, sequence_number, title, summary, theme, start_entry_id, end_entry_id, token_count, closed_at, embedding_stale, created_at, updated_at)
         VALUES ('x1', ?, 0, 'Chapter One', 'Chapter summary', 'A theme', 'x', 'y', 0, ?, 1, ?, ?)`,
      )
      .run(branch, now, now, now)
  }

  function loadStale(sqlite: DatabaseSync, branch: string): EmbeddedFieldRow[] {
    const out: EmbeddedFieldRow[] = []
    for (const kind of KINDS) {
      const q = staleRowsQuery(kind, [branch])
      const rows = (
        sqlite.prepare(q.sql).all(...(q.params as never[])) as Record<string, unknown>[]
      ).map((r) => Object.values(r))
      out.push(...rows.map((r) => toEmbeddedFieldRow(kind, r)))
    }
    return out
  }

  const vecIds = (sqlite: DatabaseSync, kind: VecTargetKind, branch: string) =>
    (
      sqlite
        .prepare(`select id from ${vecTableName(kind, 384)} where branch_id = ?`)
        .all(branch) as { id: string }[]
    ).map((r) => r.id)

  const staleOf = (sqlite: DatabaseSync, kind: VecTargetKind, branch: string) =>
    (
      sqlite
        .prepare(
          `select embedding_stale s from ${SOURCE_TABLES[kind]} where branch_id = ? and id = 'x1'`,
        )
        .get(branch) as { s: number } | undefined
    )?.s

  it('lands a vector and clears the flag for every embedded kind', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seedKindRows(sqlite, 'b1', true)

    const rows = loadStale(sqlite, 'b1')
    expect(rows).toHaveLength(5)
    const { ops } = await embedRowsToVecOps(cfg, rows, async (sql) => void sqlite.exec(sql))
    await runInTransaction(ops)

    for (const kind of KINDS) {
      expect(vecIds(sqlite, kind, 'b1'), kind).toEqual(['x1'])
      expect(staleOf(sqlite, kind, 'b1'), kind).toBe(0)
    }
  })

  it('a row edited between assembly and commit lands no vector and stays stale; the next drain lands it', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seedKindRows(sqlite, 'b1', true)

    const first = await embedRowsToVecOps(
      cfg,
      loadStale(sqlite, 'b1'),
      async (sql) => void sqlite.exec(sql),
    )
    await runInTransaction(first.ops)
    for (const kind of KINDS)
      sqlite
        .prepare(`update ${SOURCE_TABLES[kind]} set embedding_stale = 1 where branch_id = 'b1'`)
        .run()

    const rows = loadStale(sqlite, 'b1')
    const { ops } = await embedRowsToVecOps(cfg, rows, async (sql) => void sqlite.exec(sql))
    // A user edit landing after assembly but before commit — the guard must refuse the insert.
    for (const kind of KINDS) {
      const column = KIND_COLUMNS[kind][1]
      sqlite
        .prepare(
          `update ${SOURCE_TABLES[kind]} set ${column} = 'edited', embedding_stale = 1 where branch_id = 'b1'`,
        )
        .run()
    }
    await runInTransaction(ops)

    for (const kind of KINDS) {
      expect(vecIds(sqlite, kind, 'b1'), kind).toEqual([])
      expect(staleOf(sqlite, kind, 'b1'), kind).toBe(1)
    }

    const again = await embedRowsToVecOps(
      cfg,
      loadStale(sqlite, 'b1'),
      async (sql) => void sqlite.exec(sql),
    )
    await runInTransaction(again.ops)

    for (const kind of KINDS) {
      expect(vecIds(sqlite, kind, 'b1'), kind).toEqual(['x1'])
      expect(staleOf(sqlite, kind, 'b1'), kind).toBe(0)
    }
  })

  it('a row deleted between assembly and commit lands no vector on its branch, leaving a same-id fork already embedded untouched', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    seedKindRows(sqlite, 'b1', true)
    seedKindRows(sqlite, 'b2', false)

    // b2 embeds first so this can fail: the upsert's DELETE half is scoped to branch_id too, not
    // just id — unscoped, it would delete this same-id row on the other branch.
    const b2 = await embedRowsToVecOps(
      cfg,
      loadStale(sqlite, 'b2'),
      async (sql) => void sqlite.exec(sql),
    )
    await runInTransaction(b2.ops)

    const rows = loadStale(sqlite, 'b1')
    const { ops } = await embedRowsToVecOps(cfg, rows, async (sql) => void sqlite.exec(sql))
    for (const kind of KINDS)
      sqlite
        .prepare(`delete from ${SOURCE_TABLES[kind]} where branch_id = 'b1' and id = 'x1'`)
        .run()
    await runInTransaction(ops)

    for (const kind of KINDS) {
      expect(vecIds(sqlite, kind, 'b1'), kind).toEqual([])
      expect(vecIds(sqlite, kind, 'b2'), kind).toEqual(['x1'])
    }
  })
})
