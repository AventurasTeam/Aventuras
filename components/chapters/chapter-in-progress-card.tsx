import type { ReactElement } from 'react'
import { View } from 'react-native'

import { ChapterProgressBar } from '@/components/compounds/chapter-progress-bar'
import { chapterProgressCounts } from '@/components/compounds/chapter-progress-label'
import { ReasonButton } from '@/components/compounds/reason-button'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type ChapterInProgressCardProps = {
  progress: ChapterProgress
  /** From chapterTimelineData's sinceLabel; null drops `since`. */
  sinceLabel: string | null
  /** Opens the close modal; absent disables `Close chapter…`. */
  onCloseChapter?: () => void
  /** Why `Close chapter…` is disabled; absent with onCloseChapter set means enabled. */
  closeReason?: string
  /** isReadyToClose's verdict, shown on the progress line. */
  readyToClose: boolean
}

/** The open region's last card: it has no row yet, so nothing on it expands or edits. */
export function ChapterInProgressCard({
  progress,
  sinceLabel,
  onCloseChapter,
  closeReason,
  readyToClose,
}: ChapterInProgressCardProps): ReactElement {
  const isPhone = useTier() === 'phone'
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
        {/* One paragraph: a text-width label beside it would drop its last word on Android. */}
        <Text size="xs" variant="muted">
          {chapterProgressCounts(progress)}
          {readyToClose ? (
            <>
              {' · '}
              <Text size="xs" variant="default" className="font-medium">
                {t('chapters:readyToClose')}
              </Text>
            </>
          ) : null}
        </Text>
      </View>
      <Text size="sm" variant="muted" className="italic">
        {t('chapters:inProgress.placeholder')}
      </Text>
      {/* chapter-timeline.md → Mobile expression. */}
      <ReasonButton
        variant="primary"
        layout={isPhone ? 'stretch' : 'start'}
        disabled={onCloseChapter == null || closeReason != null}
        disabledReason={closeReason}
        onPress={onCloseChapter}
      >
        <Text>{t('chapters:inProgress.close')}</Text>
      </ReasonButton>
    </View>
  )
}
