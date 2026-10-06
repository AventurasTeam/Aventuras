// Both shipped runtimes cap binds at 32766: node:sqlite probed, expo-sqlite 55
// vendors the same SQLITE_MAX_VARIABLE_NUMBER default; 999 is a pre-3.32 floor.
const SQLITE_MAX_BIND_VARS = 32766

// 8192 folds any realistic id set into one statement, ~24.5k spare; 4 would overrun.
export const BIND_CHUNK = 8192

/** `items` in runs of at most `size`, so each `IN (...)` list stays under the bind cap. */
export function chunked<T>(items: readonly T[], size = BIND_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

/** Largest row count whose columns still fit one multi-row INSERT under the bind cap. */
export function rowsPerInsert(columnCount: number): number {
  return Math.max(1, Math.floor(SQLITE_MAX_BIND_VARS / columnCount))
}
