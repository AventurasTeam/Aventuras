import type { Liquid } from 'liquidjs'

type Kinded = { kind?: unknown }
type Statused = { status?: unknown }

export function byKind<T extends Kinded>(items: T[], kind: string): T[] {
  return Array.isArray(items) ? items.filter((i) => i.kind === kind) : []
}

export function active<T extends Statused>(items: T[]): T[] {
  return Array.isArray(items) ? items.filter((i) => i.status === 'active') : []
}

export function proseJoin(items: unknown[]): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  const parts = items.map(String)
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

export function jsonFilter(value: unknown): string {
  return JSON.stringify(value)
}

// Registered names match the author-facing filter names in architecture.md.
export function registerFilters(engine: Liquid): void {
  engine.registerFilter('by_kind', byKind)
  engine.registerFilter('active', active)
  engine.registerFilter('prose_join', proseJoin)
  engine.registerFilter('json', jsonFilter)
}
