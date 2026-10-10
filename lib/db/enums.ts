export const INJECTION_MODES = ['always', 'auto', 'disabled'] as const
export type InjectionMode = (typeof INJECTION_MODES)[number]

/** Lifecycle enum for `threads.status` (data-model.md → Happenings & character knowledge). */
export const THREAD_STATUSES = ['pending', 'active', 'resolved', 'failed'] as const
export type ThreadStatus = (typeof THREAD_STATUSES)[number]

/** Why a writer flagged a create: `name_collision_reason` (classifier.md → Disambiguation, piggyback.md → Matching before creating). */
export const COLLISION_REASONS = [
  'alike',
  'ambiguous',
  'distinct',
  'in-scene',
  'no-signal',
  'same-parent',
] as const
export type CollisionReason = (typeof COLLISION_REASONS)[number]
