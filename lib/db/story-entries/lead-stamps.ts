import { and, eq, inArray, sql } from 'drizzle-orm'

import type { DbCtx } from '../types'
import { storyEntries } from './story-entries.table'

const stampedLead = sql<string>`json_extract(${storyEntries.metadata}, '$.leadId')`

/** The ids among `ids` that a `metadata.leadId` stamp on the branch's entries names. */
export async function readStampedLeadIds(
  branchId: string,
  ids: readonly string[],
  db: DbCtx['db'],
): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set()
  const rows = await db
    .selectDistinct({ leadId: stampedLead })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), inArray(stampedLead, [...ids])))
  return new Set(rows.map((row) => row.leadId))
}
