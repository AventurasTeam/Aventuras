import { DatabaseSync } from 'node:sqlite'

import type { Page } from '@playwright/test'
import { gunzipSync } from 'fflate'

import type { EntryMetadata, ProbeCapturePayload } from '@/lib/db'

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

// Branch-scoped because both writers are: the drain warms only the open branch, a
// turn's sync stage only its own — an unscoped total waits on rows nothing drains.
const BRANCH_STALE_TOTAL_SQL = `SELECT (SELECT count(*) FROM entities WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM lore WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM chapters WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM threads WHERE branch_id = ? AND embedding_stale = 1)
                              + (SELECT count(*) FROM happenings WHERE branch_id = ? AND embedding_stale = 1)`

export async function branchStaleTotal(page: Page, branchId: string): Promise<number> {
  const [[total]] = await queryApp(page, BRANCH_STALE_TOTAL_SQL, Array<string>(5).fill(branchId))
  return Number(total)
}

export async function currentBranchId(page: Page, storyId: string): Promise<string> {
  const rows = await queryApp(page, `SELECT current_branch_id FROM stories WHERE id = ?`, [storyId])
  return rows[0]?.[0] as string
}

const TAIL_METADATA_SQL = `SELECT metadata FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply'
   ORDER BY position DESC LIMIT 1`

// queryApp is a raw SQL bridge, not drizzle's typed select, so the column's
// `mode: 'json'` transform never runs — parse it here instead.
export async function tailMetadata(page: Page, branchId: string): Promise<EntryMetadata | null> {
  const rows = await queryApp(page, TAIL_METADATA_SQL, [branchId])
  const raw = rows[0]?.[0] as string | null | undefined
  return raw ? (JSON.parse(raw) as EntryMetadata) : null
}

const LATEST_CAPTURE_SQL = `SELECT payload FROM probe_captures
   WHERE branch_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`

// Payload is a gzipped blob; queryApp's evaluate bridge returns the BLOB column as a real
// Uint8Array (Playwright has serialized typed arrays since 1.44), so it gunzips directly.
export async function latestCapture(
  page: Page,
  branchId: string,
): Promise<ProbeCapturePayload | null> {
  const rows = await queryApp(page, LATEST_CAPTURE_SQL, [branchId])
  const blob = rows[0]?.[0] as Uint8Array | undefined
  if (blob === undefined) return null
  const json = new TextDecoder().decode(gunzipSync(blob))
  return JSON.parse(json) as ProbeCapturePayload
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
