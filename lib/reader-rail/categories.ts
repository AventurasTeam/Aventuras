import type { EntityKind } from '@/lib/db'
import {
  isPlotKind,
  isWorldCategory,
  PLOT_KINDS,
  WORLD_CATEGORIES,
  type EntityFilter,
  type HappeningFilter,
  type ThreadFilter,
} from '@/lib/list-modules'
import { ROW_CATEGORIES, type RowCategory } from '@/lib/row-signals'

export const RAIL_CATEGORIES = ROW_CATEGORIES
export type RailCategory = RowCategory

// principles.md → World / Plot split: the dropdown's two groups, in display order.
export const RAIL_GROUPS = {
  world: WORLD_CATEGORIES,
  plot: PLOT_KINDS,
} as const satisfies Record<'world' | 'plot', readonly RailCategory[]>
export type RailGroup = keyof typeof RAIL_GROUPS

export function railGroupOf(category: RailCategory): RailGroup {
  return (RAIL_GROUPS.plot as readonly RailCategory[]).includes(category) ? 'plot' : 'world'
}

export function isRailCategory(value: unknown): value is RailCategory {
  return isWorldCategory(value) || isPlotKind(value)
}

export type RailView =
  | { category: EntityKind; filter: EntityFilter; search: string }
  | { category: 'lore'; search: string }
  | { category: 'thread'; filter: ThreadFilter; search: string }
  | { category: 'happening'; filter: HappeningFilter; search: string }

/** The view a switch to `category` lands on: filter `all`, search empty. */
export function railViewFor(category: RailCategory): RailView {
  switch (category) {
    case 'lore':
      return { category, search: '' }
    default:
      return { category, filter: 'all', search: '' }
  }
}

/** The row a peek shows. */
export type RailPeek = { category: RailCategory; id: string }

export const DEFAULT_RAIL_VIEW: RailView = railViewFor('character')
