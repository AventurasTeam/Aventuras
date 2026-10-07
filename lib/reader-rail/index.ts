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
export { matchesRailToggleShortcut } from './shortcut'
export { RAIL_SHEET_OPENED, reduceRailSheet } from './sheet'
export type { RailSheetEvent, RailSheetState } from './sheet'
export { aggregateTint, formatStripCount, railStripModel, STRIP_COUNT_CAP } from './strip'
export type {
  RailStripModel,
  StripCategory,
  StripCountedCategory,
  StripCountedCell,
  StripGlyphCategory,
  StripGlyphCell,
} from './strip'
