import { memoryPillError, useMemoryHealth } from '@/hooks/use-memory-health'

import { GenerationStatusPill, type GenerationStatusPillProps } from './generation-status-pill'

type StoryStatusPillProps = Omit<GenerationStatusPillProps, 'error' | 'onErrorTap'> & {
  storyId: string | null
  /** The story's `embedding_swap_target` marker, from whichever copy the surface holds. */
  swapTarget: string | null | undefined
  /** Every error this pill raises is a memory one, and each routes to Story Settings · Memory. */
  onOpenMemory: () => void
}

/** The in-story status pill; a leaf, so the stale count's per-batch ticks re-render only it. */
export function StoryStatusPill({
  storyId,
  swapTarget,
  onOpenMemory,
  ...pill
}: StoryStatusPillProps) {
  const health = useMemoryHealth(storyId, swapTarget)
  return (
    <GenerationStatusPill {...pill} error={memoryPillError(health)} onErrorTap={onOpenMemory} />
  )
}
