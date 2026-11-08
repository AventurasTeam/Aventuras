import type { GuardRow } from '@/lib/actions/types'

import type { CloseIds } from './ids'
import { FULL_ID_SHAPE } from './tool'

/** The rows a task and part has read: seeded by its start, added to by read_row (C11). */
export type ReadSet = {
  has: (row: GuardRow) => boolean
  add: (rows: readonly GuardRow[]) => void
}

const rowKey = ({ table, id }: GuardRow): string => `${table}:${id}`

export function createReadSet(): ReadSet {
  const read = new Set<string>()
  return {
    has: (row) => read.has(rowKey(row)),
    add: (rows) => {
      for (const row of rows) read.add(rowKey(row))
    },
  }
}

export type CommonCheck =
  | { ok: true; turns: readonly string[]; proseEntryId: string }
  | { ok: false; reason: string }

type CheckContext = { ids: CloseIds; chapterEntryIds: readonly string[]; readSet: ReadSet }

const TURN_HINT = 'cite turns by the handles the chapter shows (t1, t2…)'

/**
 * A write's first refusals, in order: its turns, its why, then the read gate. The turns come back
 * as entry ids in position order, the last of them the write's prose entry for user precedence.
 */
export function commonChecks(
  args: { turns: unknown; why: unknown },
  named: readonly GuardRow[],
  ctx: CheckContext,
): CommonCheck {
  const cited = citedTurns(args.turns, ctx)
  if (!cited.ok) return cited
  if (typeof args.why !== 'string' || args.why.trim() === '')
    return {
      ok: false,
      reason: 'why is empty: give one sentence on what in the cited turns makes this write true',
    }
  const unread = named.find((row) => !ctx.readSet.has(row))
  if (unread !== undefined)
    return {
      ok: false,
      reason: `${ctx.ids.handleOf(unread.id) ?? unread.id} hasn't been read in this task: call read_row on it, then write it`,
    }
  return cited
}

function citedTurns(value: unknown, { ids, chapterEntryIds }: CheckContext): CommonCheck {
  if (!Array.isArray(value) || value.length === 0)
    return { ok: false, reason: `turns is empty: ${TURN_HINT}` }
  const positions = new Map(chapterEntryIds.map((id, at) => [id, at] as const))
  const cited = new Set<number>()
  for (const handle of value) {
    const id = typeof handle === 'string' ? ids.idOf(handle) : undefined
    if (id === undefined && typeof handle === 'string' && FULL_ID_SHAPE.test(handle))
      return {
        ok: false,
        reason: 'turns takes the short handles as shown (t1, t2…), not a full id',
      }
    if (id === undefined || !id.startsWith('entry_'))
      return { ok: false, reason: `${String(handle)} is not a turn: ${TURN_HINT}` }
    const at = positions.get(id)
    if (at === undefined)
      return {
        ok: false,
        reason: `${String(handle)} is outside this chapter: cite only this chapter's turns`,
      }
    cited.add(at)
  }
  const ordered = [...cited].sort((a, b) => a - b).map((at) => chapterEntryIds[at])
  return { ok: true, turns: ordered, proseEntryId: ordered[ordered.length - 1] }
}
