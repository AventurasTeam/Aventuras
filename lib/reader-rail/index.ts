export {
  DEFAULT_RAIL_VIEW,
  isRailCategory,
  RAIL_CATEGORIES,
  RAIL_GROUPS,
  railGroupOf,
  railViewFor,
} from './categories'
export type { RailCategory, RailGroup, RailPeek, RailView } from './categories'
export {
  initialRailDisplay,
  isRailCollapsed,
  RAIL_COLLAPSE_BELOW_PX,
  RAIL_RESTORE_ABOVE_PX,
  reduceRailDisplay,
} from './display'
export type { RailDisplayEvent, RailDisplayState } from './display'
