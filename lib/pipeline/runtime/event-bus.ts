import { loggerWithoutTurn } from '@/lib/diagnostics'

import type { PipelineEvent } from '../types'

type AnyListener = (e: PipelineEvent) => void

const byType = new Map<string, Set<AnyListener>>()
const wildcard = new Set<AnyListener>()

function call(listener: AnyListener, event: PipelineEvent): void {
  try {
    listener(event)
  } catch (e) {
    loggerWithoutTurn.error('pipeline.subscriber_error', {
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

export const pipelineEventBus = {
  subscribe<T extends PipelineEvent['type']>(
    type: T,
    listener: (event: Extract<PipelineEvent, { type: T }>) => void,
  ): () => void {
    const set = byType.get(type) ?? new Set<AnyListener>()
    set.add(listener as AnyListener)
    byType.set(type, set)
    return () => set.delete(listener as AnyListener)
  },
  subscribeAll(listener: (e: PipelineEvent) => void): () => void {
    wildcard.add(listener)
    return () => wildcard.delete(listener)
  },
  emit(event: PipelineEvent): void {
    for (const l of byType.get(event.type) ?? []) call(l, event)
    for (const l of wildcard) call(l, event)
  },
}

// Test seam — clears all listeners between tests (mirrors __resetRegistry).
export function __resetBus(): void {
  byType.clear()
  wildcard.clear()
}
