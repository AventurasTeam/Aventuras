import { resolveByTable, type TableEntry } from './registry'
import { undoneColumn } from './reverse-replay'
import type { TermMatch } from './term-list'

function registeredEntry(caller: string, table: string): TableEntry {
  const entry = resolveByTable(table)
  if (!entry) throw new Error(`${caller}: no registered table "${table}"`)
  return entry
}

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, i) => key === b[i])

/** `current` stepped back through one payload partial, as a reversal restores the column. Throws on an unregistered table. */
export function undoneColumnOf(
  table: string,
  column: string,
  partial: unknown,
  current: unknown,
): unknown {
  return undoneColumn(registeredEntry('undoneColumnOf', table), column, partial, current)
}

/** How a registered term list's terms match, or undefined when column/path is no term list. Throws on an unregistered table. */
export function termMatchOf(
  table: string,
  column: string,
  path: readonly string[] = [],
): TermMatch | undefined {
  const lists = registeredEntry('termMatchOf', table).termLists ?? []
  return lists.find((list) => list.column === column && samePath(list.path ?? [], path))?.match
}
