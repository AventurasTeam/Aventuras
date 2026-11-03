import { closeSync, openSync, readSync, statSync } from 'node:fs'

// The 16-byte magic string every SQLite 3 database file opens with.
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1')

export function isSqliteFile(path: string): boolean {
  if (!statSync(path).isFile()) return false
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(SQLITE_HEADER.length)
    return readSync(fd, head, 0, head.length, 0) === head.length && head.equals(SQLITE_HEADER)
  } finally {
    closeSync(fd)
  }
}
