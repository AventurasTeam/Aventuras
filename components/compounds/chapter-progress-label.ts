import type { ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'

type Counts = Pick<ChapterProgress, 'tokens' | 'threshold'>

export function chapterProgressCounts({ tokens, threshold }: Counts): string {
  return t('chapters:progress.counts', { tokens, threshold })
}

export function chapterProgressLabel(progress: Counts): string {
  return t('chapters:progress.label', { counts: chapterProgressCounts(progress) })
}
