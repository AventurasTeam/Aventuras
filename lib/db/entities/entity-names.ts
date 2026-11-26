import { and, eq, inArray } from 'drizzle-orm'

import { chunked } from '../bind-limit'
import type { DbCtx } from '../types'
import { entities } from './entities.table'

/** The names of the branch's rows among `ids`, by id; an id the branch doesn't hold is absent. */
export async function readEntityNames(
  branchId: string,
  ids: readonly string[],
  db: DbCtx['db'],
): Promise<ReadonlyMap<string, string>> {
  const names = new Map<string, string>()
  for (const chunk of chunked(ids)) {
    const rows = await db
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(and(eq(entities.branchId, branchId), inArray(entities.id, chunk)))
    for (const row of rows) names.set(row.id, row.name)
  }
  return names
}
