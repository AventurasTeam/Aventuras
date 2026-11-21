import type { ReactElement } from 'react'
import { View } from 'react-native'

import { ChapterProgressBar } from '@/components/compounds/chapter-progress-bar'
import { chapterProgressCounts } from '@/components/compounds/chapter-progress-label'
import { ChapterProgressLine } from '@/components/compounds/chapter-progress-line'
import { ReasonButton } from '@/components/compounds/reason-button'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { isReadyToClose, type ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { closeChapterReason } from './close-chapter-reason'

export type ChapterInProgressCardProps = {
  progress: ChapterProgress
  /** From chapterTimelineData's sinceLabel; null drops `since`. */
  sinceLabel: string | null
  /** The story's setting: `Ready to close` shows only while it's off. */
  chapterAutoClose: boolean
  /** The run gate's reason while it holds; it, or no reply to end on, disables `Close chapter…`. */
  gateReason: string | undefined
  /** Opens the close modal. */
  onCloseChapter: () => void
}

/** The open region's last card: it has no row yet, so nothing on it expands or edits. */
export function ChapterInProgressCard({
  progress,
  sinceLabel,
  chapterAutoClose,
  gateReason,
  onCloseChapter,
}: ChapterInProgressCardProps): ReactElement {
  const isPhone = useTier() === 'phone'
  const closeReason = closeChapterReason(gateReason, progress.canClose)
  return (
    <View
      testID="chapter-in-progress-card"
      // Not bg-bg-sunken: the progress bar's track is, and would vanish into it.
      className={cn(
        'gap-3 rounded-md border border-dashed border-border bg-bg-base py-3',
        isPhone ? 'px-3' : 'px-5',
      )}
    >
      <Text size="sm" variant="muted" className="font-medium italic">
        {sinceLabel != null
          ? t('chapters:inProgress.since', { time: sinceLabel })
          : t('chapters:inProgress.title')}
      </Text>
      <View className="gap-1">
        <ChapterProgressBar percent={progress.percent} className="h-1 rounded-full" />
        <ChapterProgressLine
          counts={chapterProgressCounts(progress)}
          ready={isReadyToClose(progress, chapterAutoClose)}
        />
      </View>
      <Text size="sm" variant="muted" className="italic">
        {t('chapters:inProgress.placeholder')}
      </Text>
      {/* Full width on phone, for a clear tap target. */}
      <ReasonButton
        variant="primary"
        layout={isPhone ? 'stretch' : 'start'}
        disabled={closeReason != null}
        disabledReason={closeReason}
        onPress={onCloseChapter}
      >
        <Text>{t('chapters:inProgress.close')}</Text>
      </ReasonButton>
    </View>
  )
}
