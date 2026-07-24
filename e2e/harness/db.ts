import { DatabaseSync } from 'node:sqlite'

import type { Page } from '@playwright/test'

// Query the running app's own DB connection through the preload bridge
// (window.aventurasDb). The faithful way to assert an in-app write: it reads
// through the same main-process connection that just committed, whereas a
// second file handle can miss a WAL-buffered write. sqlite-proxy hands rows
// back as arrays-of-values. See docs/testing.md → Selector strategy, Tier 1.
export async function queryApp(
  page: Page,
  sql: string,
  params: unknown[] = [],
): Promise<unknown[][]> {
  const result = await page.evaluate(
    ({ sql, params }) =>
      (
        window as unknown as {
          aventurasDb: {
            query: (s: string, p: unknown[], m: string) => Promise<{ rows: unknown[][] }>
          }
        }
      ).aventurasDb.query(sql, params, 'all'),
    { sql, params },
  )
  return result.rows
}

// Read-only assertion handle over the fixture DB file. E2E drives the app
// through the UI and asserts the outcome here — the DB is the source of truth
// for "did the write actually land" (docs/testing.md → Selector strategy,
// Tier 1). Opening the file directly keeps assertions independent of the
// renderer; the renderer→IPC→main bridge is exercised by the app under test.
export class FixtureDb {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true })
  }

  count(table: string): number {
    return (this.db.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined
  }

  close(): void {
    this.db.close()
  }
}
