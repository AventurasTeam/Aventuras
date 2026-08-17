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

export type PipelineAction = {
  [K in keyof PipelineActionMap]: { kind: K } & PipelineActionMap[K]
}[keyof PipelineActionMap]

export type MutationResult =
  // Null when the post-commit readback missed: the write is durable regardless,
  // so the position is unknown rather than the action failed.
  | { status: 'ok'; logPosition: number | null }
  | { status: 'rejected'; reason: string; code?: string }
