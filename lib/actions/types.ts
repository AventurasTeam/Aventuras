import type { PipelineActionMap } from './action-map'

export type { DbCtx } from '@/lib/db'

export type DeltaSource =
  | 'ai_classifier'
  | 'piggyback_tagged_block'
  | 'per_turn_classifier'
  | 'periodic_classifier'
  | 'user_edit'
  | 'lore_agent'
  | 'chapter_close'

// Exhaustive over DeltaSource via `satisfies`: a new member with no entry here
// is a compile error, not a silent default.
const DELTA_SOURCE_ORIGIN = {
  user_edit: 'user',
  ai_classifier: 'pipeline',
  piggyback_tagged_block: 'pipeline',
  per_turn_classifier: 'pipeline',
  periodic_classifier: 'pipeline',
  lore_agent: 'pipeline',
  chapter_close: 'pipeline',
} satisfies Record<DeltaSource, 'user' | 'pipeline'>

export function isUserOriginatedSource(source: DeltaSource): boolean {
  return DELTA_SOURCE_ORIGIN[source] === 'user'
}

export type PipelineAction = {
  [K in keyof PipelineActionMap]: { kind: K } & PipelineActionMap[K]
}[keyof PipelineActionMap]

export type MutationResult =
  // Null when the post-commit readback missed: the write is durable regardless,
  // so the position is unknown rather than the action failed.
  | { status: 'ok'; logPosition: number | null }
  // `code` is a bare string: each action family funnels its own vocabulary through it
  // (see HandlerOutcome). It must always let a consumer tell a transient, self-clearing
  // refusal from a failed write.
  | { status: 'rejected'; reason: string; code?: string }
