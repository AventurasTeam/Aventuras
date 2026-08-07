import type { StoryEntry } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'

export type WindowTurn = { handle: string; entryId: string; position: number; content: string }

export type ClassifierWindow = {
  turns: readonly WindowTurn[]
  /** Highest position the pass may claim on success. */
  coversThrough: number
  /** Handle of the window head — the unattributed-fallback anchor. */
  headHandle: string | null
  truncated: boolean
  isEmpty: boolean
  resolveHandle: (handle: string | undefined) => { entryId: string; fellBack: boolean }
}

// `entry_*` is deliberately absent from SUBSTITUTABLE_PREFIXES, so the id walker
// neither substitutes nor resolves entry refs: provenance rides its own handle
// map (classifier.md -> Provenance attribution).
export function buildClassifierWindow(args: {
  entries: readonly StoryEntry[]
  processedThrough: number | null
  maxEntries: number
}): ClassifierWindow {
  const { entries, processedThrough, maxEntries } = args
  const floor = processedThrough ?? 0
  const ascending = [...entries].sort((a, b) => a.position - b.position)
  const candidates = ascending.filter((e) => e.position > floor)
  const capped = candidates.slice(0, maxEntries)
  const truncated = capped.length < candidates.length
  // System entries are technical rows the model must never see, but they still
  // occupy positions, so the watermark covers them or the pass would loop on
  // a window it cannot advance past.
  // Prose only: the template asks for facts "the turn whose prose produced it",
  // and a persisted <suggestions> block offers actions the story never took as
  // if they were narrated.
  const turns = capped
    .filter((e) => e.kind !== 'system')
    .map((e, i) => ({
      handle: `t${i + 1}`,
      entryId: e.id,
      position: e.position,
      content: promptProse(e),
    }))
  const coversThrough = capped.at(-1)?.position ?? floor
  const byHandle = new Map(turns.map((t) => [t.handle, t]))
  const head = turns.at(-1) ?? null

  return {
    turns,
    coversThrough,
    headHandle: head?.handle ?? null,
    truncated,
    isEmpty: turns.length === 0,
    resolveHandle: (handle) => {
      const hit = handle != null ? byHandle.get(handle) : undefined
      if (hit) return { entryId: hit.entryId, fellBack: false }
      // Unattributed fallback: the window head, so the fact reverses on any
      // reversal into its window but never survives as an orphan.
      return { entryId: head?.entryId ?? '', fellBack: true }
    },
  }
}
