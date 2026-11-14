import type { openTestDb } from '@/lib/db/__tests__/test-db'
import type { DbBridge } from '@/types/db-bridge'
import type { EmbedderBridge } from '@/types/embedder-bridge'

import { resolveModelDir } from '../electron/embedder/paths'
import { countTokens, embed, smokeTest } from '../electron/embedder/service'

// A Node close has no Electron preload: these stand in for its embedder and raw-database bridges.

/** What a close reaches: the range embed, its token counts and a smoke test. */
export type ProbeEmbedderBridge = Pick<
  EmbedderBridge,
  'embed' | 'countTokens' | 'smokeTest' | 'cancelEmbed'
>

/** The probe's database as openTestDb opens it: { db, sqlite, runInTransaction }. */
export type OpenedProbeDb = Awaited<ReturnType<typeof openTestDb>>

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// As main's requireModelDir: an id resolves under the root or throws, naming it.
function modelDirUnder(root: string, modelId: string): string {
  try {
    return resolveModelDir(root, modelId)
  } catch (error) {
    throw new Error(`Invalid model id "${modelId}": ${messageOf(error)}`)
  }
}

/** Main's embedder IPC handlers (electron/main.ts) over `root`, in place of userData's. */
export function probeEmbedderBridge(root: string): ProbeEmbedderBridge {
  const aborts = new Map<string, AbortController>()
  return {
    async embed({ modelId, texts, requestId }) {
      const controller = new AbortController()
      if (requestId !== undefined) aborts.set(requestId, controller)
      try {
        return await embed({
          modelDir: modelDirUnder(root, modelId),
          texts,
          signal: controller.signal,
        })
      } finally {
        // A reused request id keeps the live entry when an earlier call exits.
        if (requestId !== undefined && aborts.get(requestId) === controller)
          aborts.delete(requestId)
      }
    },
    async countTokens({ modelId, texts }) {
      return countTokens({ modelDir: modelDirUnder(root, modelId), texts })
    },
    async smokeTest({ modelId }) {
      return smokeTest({ modelDir: modelDirUnder(root, modelId) })
    },
    async cancelEmbed({ requestId }) {
      aborts.get(requestId)?.abort()
    },
  }
}

// As electron/db/service.ts: positional rows, and a 'get' as the one row itself or undefined.
function probeDbBridge({ sqlite, runInTransaction }: OpenedProbeDb): DbBridge {
  return {
    async query(sql, params, method) {
      const statement = sqlite.prepare(sql)
      if (method === 'run') {
        statement.run(...(params as never[]))
        return { rows: [] }
      }
      const rows = (statement.all(...(params as never[])) as Record<string, unknown>[]).map((row) =>
        Object.values(row),
      )
      return { rows: (method === 'get' ? rows[0] : rows) as unknown[] }
    },
    async exec(sql) {
      sqlite.exec(sql)
    },
    async transaction(ops) {
      await runInTransaction(ops)
      return { ok: true }
    },
  }
}

/** Installs the embedder and the raw DB bridge on globalThis.window; returns the uninstall. */
export function installProbeBridges(bridge: ProbeEmbedderBridge, db: OpenedProbeDb): () => void {
  if (typeof globalThis.window !== 'undefined')
    throw new Error(
      '[probe:close] globalThis.window is already set; the probe installs its bridges on an empty one',
    )
  globalThis.window = {
    // A close never reaches the download members, which belong to Settings.
    aventurasEmbedder: bridge as EmbedderBridge,
    aventurasDb: probeDbBridge(db),
  } as unknown as Window & typeof globalThis
  return () => {
    delete (globalThis as { window?: unknown }).window
  }
}
