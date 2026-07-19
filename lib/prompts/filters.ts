import type { Liquid } from 'liquidjs'

type Kinded = { kind?: unknown }
type Statused = { status?: unknown }

export function byKind<T extends Kinded>(items: T[], kind: string): T[] {
  return Array.isArray(items) ? items.filter((i) => i && i.kind === kind) : []
}

export function active<T extends Statused>(items: T[]): T[] {
  return Array.isArray(items) ? items.filter((i) => i && i.status === 'active') : []
}

// Floor at 1: slice(-0) returns the whole array, so `recent: 0` (or garbage
// input) would silently send everything instead of a minimal window.
export function recent<T>(items: T[], count: number): T[] {
  if (!Array.isArray(items)) return []
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
  return items.slice(-n)
}

export function proseJoin(items: unknown[]): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  const parts = items
    .filter((i) => i !== null && i !== undefined && String(i).trim() !== '')
    .map(String)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

export function jsonFilter(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // Circular refs / BigInt throw; never crash the render path.
    return ''
  }
}

// Registered names match the author-facing filter names in architecture.md.
export function registerFilters(engine: Liquid): void {
  engine.registerFilter('by_kind', byKind)
  engine.registerFilter('active', active)
  engine.registerFilter('recent', recent)
  engine.registerFilter('prose_join', proseJoin)
  engine.registerFilter('json', jsonFilter)
}
