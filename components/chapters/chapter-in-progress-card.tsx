import type { ReactElement } from 'react'
import { Platform, View } from 'react-native'

import { ChapterProgressBar } from '@/components/compounds/chapter-progress-bar'
import { chapterProgressCounts } from '@/components/compounds/chapter-progress-label'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterProgress } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type ChapterInProgressCardProps = {
  progress: ChapterProgress
  /** From chapterTimelineData's sinceLabel; null drops `since`. */
  sinceLabel: string | null
}

/** The open region's last card: it has no row yet, so nothing on it expands or edits. */
export function ChapterInProgressCard({
  progress,
  sinceLabel,
}: ChapterInProgressCardProps): ReactElement {
  const isPhone = useTier() === 'phone'
  const closeReason = t('chapters:popover.closeLandsLater')
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
        <Text size="xs" variant="muted">
          {chapterProgressCounts(progress)}
        </Text>
      </View>
      <Text size="sm" variant="muted" className="italic">
        {t('chapters:inProgress.placeholder')}
      </Text>
      {/* Stretched on phone, the button stretches with it (full width); sized to its label else. */}
      <View className={cn('gap-0.5', isPhone ? 'self-stretch' : 'self-start')}>
        <Button variant="primary" disabled disabledReason={closeReason}>
          <Text>{t('chapters:inProgress.close')}</Text>
        </Button>
        {/* Native has no tooltip to carry the reason. */}
        {Platform.OS !== 'web' ? (
          <Text size="xs" variant="muted">
            {closeReason}
          </Text>
        ) : null}
      </View>
    </View>
  )
}
