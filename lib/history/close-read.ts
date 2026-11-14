import { and, asc, between, desc, eq, max, min, ne, sql } from 'drizzle-orm'

import {
  chapters,
  closeReportSchema,
  deltas,
  type CloseReport,
  type DbCtx,
  type Delta,
  type EntityKind,
} from '@/lib/db'

import { latestDeletedValues } from './link-ends'

type Db = DbCtx['db']

const ENTITY_KINDS = {
  character: true,
  location: true,
  item: true,
  faction: true,
} as const satisfies Record<EntityKind, true>

const isEntityKind = (value: unknown): value is EntityKind =>
  typeof value === 'string' && Object.hasOwn(ENTITY_KINDS, value)

function parsedReport(stored: unknown): CloseReport | null {
  return stored == null ? null : closeReportSchema.parse(stored)
}

/** C4: the chapter's `close_report`, parsed; null when no close wrote one. A failing report throws. */
export async function readCloseReport(
  db: Db,
  branchId: string,
  chapterId: string,
): Promise<CloseReport | null> {
  const [row] = await db
    .select({ report: chapters.closeReport })
    .from(chapters)
    .where(and(eq(chapters.branchId, branchId), eq(chapters.id, chapterId)))
    .limit(1)
  return parsedReport(row?.report)
}

/**
 * C1: the close's deltas but its stamps, in log order. `deltas` has no `action_id` index, so the
 * chapter row's first and last deltas under the action (its create and its report update) bound a
 * range read off `deltas_log_position_uniq`; redo re-inserts at the same positions.
 */
export async function loadCloseDeltas(
  db: Db,
  branchId: string,
  chapterId: string,
  actionId: string,
): Promise<Delta[]> {
  const [range] = await db
    .select({ first: min(deltas.logPosition), last: max(deltas.logPosition) })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetId, chapterId),
        eq(deltas.targetTable, 'chapters'),
        eq(deltas.actionId, actionId),
      ),
    )
  if (range?.first == null || range.last == null) return []
  return db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        between(deltas.logPosition, range.first, range.last),
        eq(deltas.actionId, actionId),
        ne(deltas.targetTable, 'story_entries'),
      ),
    )
    .orderBy(asc(deltas.logPosition))
}

/** The branch's latest chapter and its report; null when the branch has no chapter. */
export async function readLatestCloseReport(
  db: Db,
  branchId: string,
): Promise<{ chapterId: string; report: CloseReport | null } | null> {
  const [row] = await db
    .select({ id: chapters.id, report: chapters.closeReport })
    .from(chapters)
    .where(eq(chapters.branchId, branchId))
    .orderBy(desc(chapters.sequenceNumber))
    .limit(1)
  return row === undefined ? null : { chapterId: row.id, report: parsedReport(row.report) }
}

const PAYLOAD_KIND = sql<unknown>`json_extract(${deltas.undoPayload}, '$.kind')`

/** Each deleted entity's kind, from its latest delete delta; an id with none is left out. */
export function readDeletedEntityKinds(
  db: Db,
  branchId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, EntityKind>> {
  return latestDeletedValues(db, branchId, ['entities'], ids, PAYLOAD_KIND, isEntityKind)
}
