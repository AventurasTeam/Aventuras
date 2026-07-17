import type { PipelineActionMap } from './action-map'

export type { DbCtx } from '@/lib/db'

export type DeltaSource =
  | 'ai_classifier'
  | 'periodic_classifier'
  | 'user_edit'
  | 'lore_agent'
  | 'chapter_close'

export type PipelineAction = {
  [K in keyof PipelineActionMap]: { kind: K } & PipelineActionMap[K]
}[keyof PipelineActionMap]

export type MutationResult =
  | { status: 'ok'; logPosition: number }
  | { status: 'rejected'; reason: string; code?: string }
