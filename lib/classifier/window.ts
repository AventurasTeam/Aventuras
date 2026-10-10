import { inheritedEntryMetadata, type StoryEntry } from '@/lib/db'
import { promptProse } from '@/lib/piggyback'

export type WindowTurn = {
  handle: string
  entryId: string
  position: number
  content: string
  /** The entry's saved metadata.sceneEntities; [] when it has no metadata. */
  sceneEntities: readonly string[]
  /** The entry's saved metadata.currentLocationId; null when it has none. */
  currentLocationId: string | null
}

export type ClassifierWindow = {
  turns: readonly WindowTurn[]
  /** Highest position the pass may claim on success. */
  coversThrough: number
  /** Handle of the window head — the unattributed-fallback anchor. */
  headHandle: string | null
  truncated: boolean
  isEmpty: boolean
  resolveHandle: (handle: string | undefined) => { entryId: string; fellBack: boolean }
  /** The saved scene of the turn `handle` names; null when the handle falls back to the window head. */
  sceneOf: (handle: string | undefined) => ReadonlySet<string> | null
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
  const turns: WindowTurn[] = capped
    .filter((e) => e.kind !== 'system')
    .map((e, i) => {
      // User actions too: each carries the scene submitTurn inherited onto it.
      const { sceneEntities, currentLocationId } = inheritedEntryMetadata(e.metadata)
      return {
        handle: `t${i + 1}`,
        entryId: e.id,
        position: e.position,
        content: promptProse(e),
        sceneEntities,
        currentLocationId,
      }
    })
  const coversThrough = capped.at(-1)?.position ?? floor
  const byHandle = new Map(turns.map((t) => [t.handle, t]))
  const head = turns.at(-1) ?? null
  const turnOf = (handle: string | undefined) => (handle != null ? byHandle.get(handle) : undefined)

  return {
    turns,
    coversThrough,
    headHandle: head?.handle ?? null,
    truncated,
    isEmpty: turns.length === 0,
    resolveHandle: (handle) => {
      const hit = turnOf(handle)
      if (hit) return { entryId: hit.entryId, fellBack: false }
      // Unattributed fallback: the window head, so the fact reverses on any
      // reversal into its window but never survives as an orphan.
      return { entryId: head?.entryId ?? '', fellBack: true }
    },
    // Never the head's scene on a fallback: it isn't the unattributed fact's.
    sceneOf: (handle) => {
      const hit = turnOf(handle)
      return hit ? new Set(hit.sceneEntities) : null
    },
  }
}
