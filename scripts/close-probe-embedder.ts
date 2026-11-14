import { makeCallback, type openTestDb } from '@/lib/db/__tests__/test-db'
import type { DbBridge } from '@/types/db-bridge'
import type { EmbedderBridge } from '@/types/embedder-bridge'

import { embedderCallHandlers } from '../electron/embedder/handlers'

// A Node close has no Electron preload: these stand in for its embedder and raw-database bridges.

/** What a close reaches: the range embed, its token counts and a smoke test. */
export type ProbeEmbedderBridge = Pick<
  EmbedderBridge,
  'embed' | 'countTokens' | 'smokeTest' | 'cancelEmbed'
>

/** The probe's database as openTestDb opens it: { db, sqlite, runInTransaction }. */
export type OpenedProbeDb = Awaited<ReturnType<typeof openTestDb>>

/** Main's embedder IPC handlers (electron/main.ts) over `root`, in place of userData's. */
export function probeEmbedderBridge(root: string): ProbeEmbedderBridge {
  return embedderCallHandlers(root)
}

function probeDbBridge({ sqlite, runInTransaction }: OpenedProbeDb): DbBridge {
  return {
    query: makeCallback(sqlite),
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
