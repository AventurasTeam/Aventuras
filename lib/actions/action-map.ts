// Augmented per domain via `declare module '@/lib/actions/action-map'`. Each domain
// adds its action kinds in its own registration module — additive, conflict-free.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- empty interface is required for `declare module` augmentation; domains add their kinds per-file
export interface PipelineActionMap {}
