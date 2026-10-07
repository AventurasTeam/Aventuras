import type { EntityKind } from '@/lib/db'
import type { EntityFilter, HappeningFilter, ThreadFilter } from '@/lib/list-modules'
import { ROW_CATEGORIES, type RowCategory } from '@/lib/row-signals'

export const RAIL_CATEGORIES = ROW_CATEGORIES
export type RailCategory = RowCategory

// principles.md → World / Plot split: the dropdown's two groups, in display order.
export const RAIL_GROUPS = {
  world: ['character', 'location', 'item', 'faction', 'lore'],
  plot: ['thread', 'happening'],
} as const satisfies Record<'world' | 'plot', readonly RailCategory[]>
export type RailGroup = keyof typeof RAIL_GROUPS

export function railGroupOf(category: RailCategory): RailGroup {
  return (RAIL_GROUPS.plot as readonly RailCategory[]).includes(category) ? 'plot' : 'world'
}

export function isRailCategory(value: unknown): value is RailCategory {
  return typeof value === 'string' && (RAIL_CATEGORIES as readonly string[]).includes(value)
}

export type RailView =
  | { category: EntityKind; filter: EntityFilter; search: string }
  | { category: 'lore'; search: string }
  | { category: 'thread'; filter: ThreadFilter; search: string }
  | { category: 'happening'; filter: HappeningFilter; search: string }

export const DEFAULT_RAIL_VIEW: RailView = { category: 'character', filter: 'all', search: '' }

/** The view a switch to `category` lands on: filter `all`, search empty. */
export function railViewFor(category: RailCategory): RailView {
  switch (category) {
    case 'lore':
      return { category, search: '' }
    case 'thread':
      return { category, filter: 'all', search: '' }
    case 'happening':
      return { category, filter: 'all', search: '' }
    default:
      return { category, filter: 'all', search: '' }
  }
}

/** The row a peek shows; 4.5b's desktop drawer and phone Sheet level both carry it. */
export type RailPeek = { category: RailCategory; id: string }
