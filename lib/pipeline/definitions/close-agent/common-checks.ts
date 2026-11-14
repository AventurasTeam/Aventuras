import type { GuardRow } from '@/lib/actions/types'

import { TURN_PREFIX, type CloseIds } from './ids'
import { keyedReason } from './reason-key'
import { FULL_ID_SHAPE } from './tool'

/** Rows a task and part has read: seeded by its start, then read_row and landed creates (C11). */
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

/** `taskEntryIds`: the turns the task was shown, by position; a write cites only these. */
type CheckContext = { ids: CloseIds; taskEntryIds: readonly string[]; readSet: ReadSet }

const TURN_HINT = 'cite the turns this task was shown, by their handles'

/**
 * A write's first refusals in order: turns, why, read gate. Turns return as entry ids in position
 * order, the last being the write's prose entry for user precedence.
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
      reason: keyedReason(
        'why-empty',
        'why is empty: give one sentence on what in the cited turns makes this write true',
      ),
    }
  const unread = named.find((row) => !ctx.readSet.has(row))
  if (unread !== undefined)
    return {
      ok: false,
      reason: keyedReason(
        'unread',
        `${ctx.ids.handleOf(unread.id) ?? unread.id} hasn't been read in this task: call read_row on it, then write it`,
      ),
    }
  return cited
}

function citedTurns(value: unknown, { ids, taskEntryIds }: CheckContext): CommonCheck {
  if (!Array.isArray(value) || value.length === 0)
    return { ok: false, reason: keyedReason('turns-empty', `turns is empty: ${TURN_HINT}`) }
  const positions = new Map(taskEntryIds.map((id, at) => [id, at] as const))
  const cited = new Set<number>()
  for (const handle of value) {
    const id = typeof handle === 'string' ? ids.idOf(handle) : undefined
    if (id === undefined && typeof handle === 'string' && FULL_ID_SHAPE.test(handle))
      return {
        ok: false,
        reason: keyedReason(
          'turns-full-id',
          'turns takes the short handles of the turns this task was shown, not a full id',
        ),
      }
    if (id === undefined || !id.startsWith(TURN_PREFIX))
      return {
        ok: false,
        reason: keyedReason('not-a-turn', `${String(handle)} is not a turn: ${TURN_HINT}`),
      }
    const at = positions.get(id)
    if (at === undefined)
      return {
        ok: false,
        reason: keyedReason(
          'turn-not-shown',
          `${String(handle)} is not one of the turns this task was shown: cite only those turns`,
        ),
      }
    cited.add(at)
  }
  const ordered = [...cited].sort((a, b) => a - b).map((at) => taskEntryIds[at])
  return { ok: true, turns: ordered, proseEntryId: ordered[ordered.length - 1] }
}
