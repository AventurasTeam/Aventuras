import type { ErrorState } from '@/components/compounds/generation-status-pill'
import { embedderSwapStore, embeddingStatusStore } from '@/lib/stores'

export type MemoryHealth = { staleTotal: number; swapRunning: boolean; swapPaused: boolean }

/** The status pill's error for a story's memory health; a paused swap outranks pending rows. */
export function memoryPillError(health: MemoryHealth): ErrorState | undefined {
  if (health.swapPaused) return { code: 'swap-paused' }
  if (health.staleTotal > 0) return { code: 'memory-incomplete', pendingRows: health.staleTotal }
  return undefined
}

/** `swapTarget` is the story's `embedding_swap_target` marker, from whichever copy the surface holds. */
export function useMemoryHealth(
  storyId: string | null,
  swapTarget: string | null | undefined,
): MemoryHealth {
  const staleTotal = embeddingStatusStore.useEmbeddingStatus((s) =>
    embeddingStatusStore.staleTotalFor(s, storyId),
  )
  // A boolean stays stable across embed-batch ticks; the run's entry changes identity on each.
  const swapRunning = embedderSwapStore.useSwap(
    (s) => embedderSwapStore.progressFor(s, storyId) != null,
  )
  // Off the marker, not the stale count: staging clears stale rows as it goes.
  const swapPaused = storyId != null && swapTarget != null && !swapRunning
  return { staleTotal, swapRunning, swapPaused }
}
