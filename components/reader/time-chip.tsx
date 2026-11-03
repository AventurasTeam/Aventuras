import { Clock } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { View } from 'react-native'

import { TruncatedText } from '@/components/compounds/truncated-text'
import { Icon } from '@/components/ui/icon'
import type { CalendarFrame } from '@/lib/calendar'
import { t } from '@/lib/i18n'

import { worldTimeLabel } from './chapter-time-range'

export type TimeChipProps = { seconds: number; frame: CalendarFrame | null }

export function TimeChip({ seconds, frame }: TimeChipProps): ReactElement | null {
  const label = worldTimeLabel(seconds, frame)
  if (label == null) return null
  return (
    <View
      testID="time-chip"
      role="group"
      aria-label={t('chapters:time.label', { time: label })}
      className="h-control-xs max-w-[260px] flex-row items-center gap-1.5"
    >
      <Icon as={Clock} size="sm" className="text-fg-muted" />
      <TruncatedText size="xs" variant="muted" containerClassName="min-h-touch justify-center">
        {label}
      </TruncatedText>
    </View>
  )
}
