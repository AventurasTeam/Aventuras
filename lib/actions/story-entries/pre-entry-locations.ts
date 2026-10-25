import { and, asc, eq, inArray, or } from 'drizzle-orm'

import { deltas, type Entity } from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'
import { stateAs } from '@/lib/world'

import type { DbCtx } from '../types'

/**
 * Where each character stood before the entry first moved them, from that write's before-value:
 * null when it can't be read, absent when the entry never moved them.
 */
export async function firstLocationWrites(
  args: { branchId: string; entryId: string; characterIds: readonly string[] },
  ctx: DbCtx,
): Promise<Map<string, string | null>> {
  const { branchId, entryId, characterIds } = args
  const first = new Map<string, string | null>()
  if (characterIds.length === 0) return first

  // The turn's fold logs with no entry anchor; its run is the one that created the entry.
  const [created] = await ctx.db
    .select({ actionId: deltas.actionId })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.entryId, entryId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.targetId, entryId),
        eq(deltas.op, 'create'),
      ),
    )
    .limit(1)
  const writes = await ctx.db
    .select({ targetId: deltas.targetId, undoPayload: deltas.undoPayload })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'entities'),
        inArray(deltas.targetId, [...characterIds]),
        created
          ? or(eq(deltas.entryId, entryId), eq(deltas.actionId, created.actionId))
          : eq(deltas.entryId, entryId),
      ),
    )
    .orderBy(asc(deltas.targetId), asc(deltas.logPosition))

  for (const { targetId, undoPayload } of writes) {
    const state = isJsonObject(undoPayload) ? undoPayload.state : undefined
    if (first.has(targetId) || !isJsonObject(state) || !('current_location_id' in state)) continue
    const before = state.current_location_id
    first.set(targetId, typeof before === 'string' ? before : null)
  }
  return first
}

/**
 * `firstWrites` less anyone no longer at the scene's place, whom something moved since; a place
 * that is gone reads as null (docs/ui/patterns/entry-card.md → Scene editor).
 */
export function preEntryLocations(
  firstWrites: ReadonlyMap<string, string | null>,
  sceneLocationId: string | null,
  branchEntities: readonly Entity[],
): Map<string, string | null> {
  const byId = new Map(branchEntities.map((e) => [e.id, e]))
  const restored = new Map<string, string | null>()
  for (const [id, before] of firstWrites) {
    const row = byId.get(id)
    if (row?.kind !== 'character') continue
    if (stateAs(row, 'character').current_location_id !== sceneLocationId) continue
    restored.set(id, before !== null && byId.get(before)?.kind === 'location' ? before : null)
  }
  return restored
}
