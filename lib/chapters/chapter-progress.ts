import type { StoryEntry } from '@/lib/db'

import { canEndChapter } from './can-end-chapter'
import { chapterProgressTone, type ChapterProgressTone } from './chapter-progress-tone'

export type ChapterProgress = Readonly<{
  tokens: number
  threshold: number
  percent: number
  tone: ChapterProgressTone
  canClose: boolean
  /** The open region's first entry, where the open chapter starts; null while it holds none. */
  startEntryId: string | null
}>

/**
 * `series` oldest first, as `openRegionSeries` reads it. `percent` is 0–100, and reads 0 for a
 * non-positive or non-finite threshold.
 */
export function chapterProgressOf(
  series: readonly { id: string; kind: StoryEntry['kind']; tokens: number }[],
  threshold: number,
): ChapterProgress {
  const tokens = series.reduce((sum, row) => sum + row.tokens, 0)
  const percent =
    Number.isFinite(threshold) && threshold > 0 ? Math.min(100, (tokens / threshold) * 100) : 0
  return {
    tokens,
    threshold,
    percent,
    tone: chapterProgressTone(percent),
    canClose: series.some(canEndChapter),
    startEntryId: series[0]?.id ?? null,
  }
}
