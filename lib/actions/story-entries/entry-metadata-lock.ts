import type { StoryEntry } from '@/lib/db'
import type { HeadTurn } from '@/lib/head-turn'

import { withKeyLock } from '../delta/key-lock'
import type { DbCtx } from '../types'
import { loadHeadTurn } from './head-turn'

/**
 * Serializes ungated entry-metadata writers' read-then-decide per ROW: same-row writers under
 * different action names must not interleave. Not reentrant — never call one from `run`, it
 * deadlocks. Outermost lock: `run` may take the runner's row locks; no row-lock holder takes this.
 */
export function withEntryMetadataLock<T>(
  branchId: string,
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  return withKeyLock(`entryMetadata:${branchId}:${id}`, run)
}

/**
 * Runs `run` holding the branch tail's metadata lock, taken before the branch lock as every tail
 * writer takes it. The tail is read, locked, then re-read: `run` gets that head, and `moved`
 * answers instead when another write moved the tail in between.
 */
export async function withTailMetadataLock<T>(
  branchId: string,
  ctx: DbCtx,
  run: (head: HeadTurn<StoryEntry> | null) => Promise<T>,
  moved: () => T,
): Promise<T> {
  const lockedTail = (await loadHeadTurn(branchId, ctx))?.tail.id ?? null
  const locked = async () => {
    const head = await loadHeadTurn(branchId, ctx)
    return (head?.tail.id ?? null) === lockedTail ? run(head) : moved()
  }
  return lockedTail == null ? locked() : withEntryMetadataLock(branchId, lockedTail, locked)
}
