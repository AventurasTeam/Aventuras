// Augmented per domain via `declare module '@/lib/actions/action-map'`. Each domain
// adds its action kinds in its own registration module — additive, conflict-free.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty interface is required for `declare module` augmentation; domains add their kinds per-file
export interface PipelineActionMap {}

// A unit test's throwaway fixture kinds. They join PipelineAction but stay out of the maps
// that must decide every production kind, like apply-delta-action.ts's lock keys.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by test files
export interface TestPipelineActionMap {}
