import type { DatabaseSync } from 'node:sqlite'

import { asc, eq, getTableColumns, inArray, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/sqlite-proxy'

import { assertScannableKey, holdsSecret } from './export'
import { branches, stories } from '../../lib/db/schema'
import { DATASET_SEED_TABLES, parseStorySeed, type SeedAppRefs } from '../seed/dataset-story'
import { makeProxy } from '../seed/sqlite-proxy'

const CREDENTIAL_FIELD =
  /^(api[-_]?key|secret|password|authorization|bearer|access[-_]?token|refresh[-_]?token)$/i
const CREDENTIAL_VALUE = /\bsk-[\w-]{20,}|\bBearer\s+[\w.~+/=-]{20,}/i

function providerKeys(sqlite: DatabaseSync): string[] {
  const row = sqlite.prepare(`SELECT providers FROM app_settings`).get() as
    | { providers: string }
    | undefined
  const providers = row ? (JSON.parse(row.providers) as { apiKey?: string }[]) : []
  return providers.map((p) => p.apiKey ?? '').filter((key) => key !== '')
}

// Names the path, never the value: the refusal must not print the secret it caught. Scans decoded
// strings, since JSON escapes a key's quote or backslash out of the file's bytes.
function credentialAt(value: unknown, path: string, keys: readonly string[]): string | null {
  if (typeof value === 'string') {
    if (holdsSecret(value, keys))
      return `${path} holds a provider key from the database's app settings`
    return CREDENTIAL_VALUE.test(value) ? `${path} looks like a credential` : null
  }
  if (value === null || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value)) {
    const at = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`
    if (!Array.isArray(value) && holdsSecret(key, keys))
      return `${path} has a field named with a provider key from the database's app settings`
    if (!Array.isArray(value) && CREDENTIAL_VALUE.test(key))
      return `${path} has a field whose name looks like a credential`
    if (!Array.isArray(value) && CREDENTIAL_FIELD.test(key))
      return `${at} is named like a credential`
    const found = credentialAt(child, at, keys)
    if (found !== null) return found
  }
  return null
}

/**
 * One story as the checked-in seed: rows ordered so a refresh diffs cleanly, every embedded row
 * stale (no vector ships). Refuses a credential in any row, and a seed its own loader would refuse.
 */
export async function exportStorySeed(
  sqlite: DatabaseSync,
  storyId: string,
  refs: SeedAppRefs,
): Promise<string> {
  // One read transaction: a write landing between two tables' reads can't split the seed.
  sqlite.exec('BEGIN')
  try {
    return await exportInSnapshot(sqlite, storyId, refs)
  } finally {
    sqlite.exec('ROLLBACK')
  }
}

async function exportInSnapshot(
  sqlite: DatabaseSync,
  storyId: string,
  refs: SeedAppRefs,
): Promise<string> {
  const unfinished = sqlite
    .prepare(`SELECT run_id FROM pipeline_runs WHERE story_id = ? AND finished_at IS NULL`)
    .all(storyId) as { run_id: string }[]
  if (unfinished.length > 0)
    throw new Error(
      `run ${unfinished.map((r) => r.run_id).join(', ')} on story ${storyId} is unfinished: export once it ends`,
    )
  const keys = providerKeys(sqlite)
  for (const key of keys) assertScannableKey(key)
  const db = drizzle(makeProxy(sqlite))
  const branchIds = (
    await db.select({ id: branches.id }).from(branches).where(eq(branches.storyId, storyId))
  ).map((branch) => branch.id)

  const seed: Record<string, Record<string, unknown>[]> = {}
  for (const spec of DATASET_SEED_TABLES) {
    const scope: SQL =
      spec.table === stories
        ? eq(stories.id, storyId)
        : spec.table === branches
          ? eq(branches.storyId, storyId)
          : inArray(getTableColumns(spec.table).branchId as SQLiteColumn, branchIds)
    const rows = (await db
      .select()
      .from(spec.table)
      .where(scope)
      .orderBy(...spec.order.map((column) => asc(column)))) as Record<string, unknown>[]
    seed[spec.name] = rows.map((row) =>
      'embeddingStale' in row ? { ...row, embeddingStale: 1 } : row,
    )
  }
  if (seed.stories!.length === 0) throw new Error(`the database holds no story ${storyId}`)

  for (const [name, rows] of Object.entries(seed))
    rows.forEach((row, i) => {
      const found = credentialAt(row, `${name}[${i}]`, keys)
      if (found !== null) throw new Error(`dataset seed ${found}`)
    })
  const json = `${JSON.stringify(seed, null, 2)}\n`
  parseStorySeed(json, refs)
  return json
}
