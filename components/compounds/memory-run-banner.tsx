import { Info, TriangleAlert, X, type LucideIcon } from 'lucide-react-native'
import type { ReactElement } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { useMemoryRunBanner, type MemoryRunBannerState } from './use-memory-run-banner'

type MemoryRunBannerViewProps = MemoryRunBannerState

type Tone = { bar: string; fill: string; icon: LucideIcon; iconClass: string; iconTestID: string }

const TONE = {
  info: {
    bar: 'border-info',
    fill: 'bg-info',
    icon: Info,
    iconClass: 'text-info',
    iconTestID: 'memory-run-banner-info-icon',
  },
  warning: {
    bar: 'border-warning',
    fill: 'bg-warning',
    icon: TriangleAlert,
    iconClass: 'text-warning',
    iconTestID: 'memory-run-banner-warning-icon',
  },
} as const satisfies Record<'info' | 'warning', Tone>

/** The bar under the in-story chrome: a memory run holding the gate, or the close it committed. */
export function MemoryRunBannerView(props: MemoryRunBannerViewProps): ReactElement {
  const tone = TONE[props.kind === 'run' ? 'info' : props.tone]
  return (
    <View
      // E2E scope anchor: the banner's Cancel shares its role and name with the composer's.
      testID="memory-run-banner"
      className={cn('relative w-full flex-row items-center gap-2 border-b px-4 py-1.5', tone.bar)}
    >
      <View
        aria-hidden
        style={POINTER_EVENTS_NONE}
        className={cn('absolute inset-0 opacity-[.12]', tone.fill)}
      />
      <Icon as={tone.icon} size="sm" className={tone.iconClass} testID={tone.iconTestID} />
      {/* Scoped to the label: role="status" implies aria-atomic, so a region spanning the bar
          would re-announce its buttons too. aria-live is what maps to Android's live region. */}
      <View role="status" aria-live="polite" className="min-w-0 flex-1">
        <Text size="sm" className="text-fg-primary">
          {props.label}
        </Text>
      </View>
      {props.kind === 'run' ? (
        <Button variant="ghost" size="sm" onPress={props.onCancel}>
          <Text>{t('cancel')}</Text>
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onPress={props.onReview}>
            <Text>{t('chrome.closeResult.review')}</Text>
          </Button>
          <IconAction
            icon={X}
            label={t('chrome.closeResult.dismiss')}
            size="sm"
            onPress={props.onDismiss}
          />
        </>
      )}
    </View>
  )
}

/** The open branch's pass or close, or the close it committed, as a banner; else nothing. */
export function MemoryRunBanner() {
  const banner = useMemoryRunBanner()
  if (banner == null) return null
  return <MemoryRunBannerView {...banner} />
}

export type { MemoryRunBannerViewProps }
