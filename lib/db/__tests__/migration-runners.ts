import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { getLoadablePath } from 'sqlite-vec'

import { applyMigration, MIGRATIONS_DIR, migrationTags } from './test-db'

export type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean }
export type Runner = (sqlite: DatabaseSync, tags: readonly string[]) => void

export function journalEntries(): JournalEntry[] {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
    entries: JournalEntry[]
  }
  return journal.entries
}

/** The tag ending in `suffix`: by name, not number, so a step that lands first can renumber it. */
export function tagEnding(suffix: string): string {
  const tag = migrationTags().find((t) => t.endsWith(suffix))
  if (tag === undefined) throw new Error(`no migration tag ends with ${suffix}`)
  return tag
}

// Desktop: the sqlite-proxy migrator hands initDb a flat statement list that it execs one by one
// (electron/db/service.ts), so the rebuild's PRAGMA foreign_keys=OFF takes effect.
export function migrateLikeDesktop(sqlite: DatabaseSync, tags: readonly string[]): void {
  for (const tag of tags) applyMigration(sqlite, tag)
}

// Android: expo's migrator runs every pending step between one BEGIN and COMMIT, preparing each
// breakpoint chunk as one statement, so PRAGMA foreign_keys does nothing there.
export function migrateLikeAndroid(sqlite: DatabaseSync, tags: readonly string[]): void {
  sqlite.exec('BEGIN')
  try {
    for (const tag of tags) {
      const chunks = readFileSync(`${MIGRATIONS_DIR}/${tag}.sql`, 'utf8').split(
        '--> statement-breakpoint',
      )
      for (const chunk of chunks) if (chunk.trim()) sqlite.prepare(chunk).run()
    }
    sqlite.exec('COMMIT')
  } catch (err) {
    sqlite.exec('ROLLBACK')
    throw err
  }
}

export const RUNNERS: readonly [string, Runner][] = [
  ['desktop', migrateLikeDesktop],
  ['android', migrateLikeAndroid],
]

/** In memory, sqlite-vec loaded and foreign keys on, as the app opens it, migrated through `tags`. */
export function openMigratedTo(tags: readonly string[]): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:', { allowExtension: true })
  sqlite.loadExtension(getLoadablePath())
  sqlite.exec('PRAGMA foreign_keys = ON;')
  for (const tag of tags) applyMigration(sqlite, tag)
  return sqlite
}
