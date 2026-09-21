export const INJECTION_MODES = ['always', 'auto', 'disabled'] as const
export type InjectionMode = (typeof INJECTION_MODES)[number]

/** Lifecycle enum for `threads.status` (data-model.md → Happenings & character knowledge). */
export const THREAD_STATUSES = ['pending', 'active', 'resolved', 'failed'] as const
export type ThreadStatus = (typeof THREAD_STATUSES)[number]
