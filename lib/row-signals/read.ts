import { and, asc, eq, gte, inArray, ne } from 'drizzle-orm'

import { deltas, type DbCtx } from '@/lib/db'

import { isLinkTable, LINK_TABLES, resolveLinkOwners, type LinkDeltaRow } from './link-owners'
import { lastTwoReplies } from './replies'
import { SIGNAL_TARGET_TABLES } from './types'
import type { ReplyEdit, SignalDelta, SignalEntry, TurnBoundaries } from './types'

/** The last two ai_reply ids, latest first. Entries ascending by position. */
export function latestReplyIds(entries: readonly SignalEntry[]): string[] {
  return lastTwoReplies(entries).map((r) => r.reply.id)
}

export async function readTurnBoundaries(
  db: DbCtx['db'],
  branchId: string,
  entries: readonly SignalEntry[],
): Promise<TurnBoundaries | null> {
  const ids = latestReplyIds(entries)
  if (ids.length === 0) return null
  const rows = await db
    .select({ targetId: deltas.targetId, logPosition: deltas.logPosition })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.op, 'create'),
        inArray(deltas.targetId, ids),
      ),
    )
  const byId = new Map(rows.map((r) => [r.targetId, r.logPosition]))
  const fresh = byId.get(ids[0])
  if (fresh == null) return null
  const fading = ids[1] != null ? (byId.get(ids[1]) ?? null) : null
  return { fresh, fading }
}

export async function readSignalDeltas(
  db: DbCtx['db'],
  branchId: string,
  fromLogPosition: number,
): Promise<SignalDelta[]> {
  const rowTables = [...SIGNAL_TARGET_TABLES.keys()]
  const rows = await db
    .select({
      source: deltas.source,
      targetTable: deltas.targetTable,
      targetId: deltas.targetId,
      logPosition: deltas.logPosition,
      op: deltas.op,
      undoPayload: deltas.undoPayload,
    })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        gte(deltas.logPosition, fromLogPosition),
        ne(deltas.source, 'user_edit'),
        inArray(deltas.targetTable, [...rowTables, ...LINK_TABLES]),
      ),
    )
    .orderBy(asc(deltas.logPosition))

  const passThrough: SignalDelta[] = []
  const linkRows: LinkDeltaRow[] = []
  for (const r of rows) {
    if (isLinkTable(r.targetTable)) {
      linkRows.push({
        source: r.source,
        targetTable: r.targetTable,
        targetId: r.targetId,
        logPosition: r.logPosition,
        op: r.op,
        undoPayload: r.undoPayload,
      })
    } else {
      passThrough.push({
        source: r.source,
        targetTable: r.targetTable,
        targetId: r.targetId,
        logPosition: r.logPosition,
      })
    }
  }

  const linkResolved = await resolveLinkOwners(db, branchId, linkRows)
  return [...passThrough, ...linkResolved].sort((a, b) => a.logPosition - b.logPosition)
}

/** The given replies' `user_edit` updates, oldest first. */
export async function readReplyEdits(
  db: DbCtx['db'],
  branchId: string,
  replyIds: readonly string[],
): Promise<ReplyEdit[]> {
  if (replyIds.length === 0) return []
  return db
    .select({
      targetId: deltas.targetId,
      logPosition: deltas.logPosition,
      undoPayload: deltas.undoPayload,
    })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.op, 'update'),
        eq(deltas.source, 'user_edit'),
        inArray(deltas.targetId, [...replyIds]),
      ),
    )
    .orderBy(asc(deltas.logPosition))
}
