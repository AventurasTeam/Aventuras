import { DatabaseSync } from 'node:sqlite'

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
