/**
 * chapter-close.md → Run order: the agent's tasks for a one-part chapter, in order. A chapter of
 * several parts runs Lore through Lifecycle once per part.
 */
export const CLOSE_TASKS = [
  'happenings',
  'lore',
  'identity',
  'threads',
  'upkeep',
  'lifecycle',
  'awareness',
] as const

export type CloseTaskName = (typeof CLOSE_TASKS)[number]
