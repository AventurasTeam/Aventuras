import { Fragment } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type BreadcrumbSegment = {
  key: string
  label: string
  /**
   * Parent segments navigate; the last segment ignores this (principles.md →
   * Breadcrumb tappability).
   */
  onPress?: () => void
}

type BreadcrumbProps = {
  segments: readonly BreadcrumbSegment[]
  className?: string
  testID?: string
  size?: 'sm' | 'base'
}

// One box for every segment keeps the bar's height when the current one becomes a link;
// phone adds the 44px touch floor as visible size (hitSlop can't pass the parent on Android).
const SEGMENT_BOX = 'py-2'
const PHONE_SEGMENT_BOX = 'min-h-[44px] justify-center'

export function Breadcrumb({ segments, className, testID, size = 'base' }: BreadcrumbProps) {
  const isPhone = useTier() === 'phone'
  const segmentBox = cn(SEGMENT_BOX, isPhone && PHONE_SEGMENT_BOX)
  // Grows to fill its row, so the current segment's 70% cap measures the bar; a content-sized
  // parent would cap it against its own text.
  return (
    <View
      className={cn('min-w-0 shrink grow flex-row items-center gap-1', className)}
      testID={testID}
    >
      {segments.map((segment, index) => {
        const current = index === segments.length - 1
        const interactive = !current && segment.onPress != null
        const label = (
          <Text
            numberOfLines={1}
            size={size}
            className={cn(
              'shrink',
              current ? 'font-semibold text-fg-primary' : 'text-fg-muted',
              interactive && Platform.select({ web: 'hover:text-fg-primary hover:underline' }),
            )}
          >
            {segment.label}
          </Text>
        )
        return (
          <Fragment key={segment.key}>
            {index > 0 ? (
              <View aria-hidden>
                <Text variant="muted" size={size}>
                  /
                </Text>
              </View>
            ) : null}
            {interactive ? (
              <Pressable
                accessibilityRole="link"
                onPress={segment.onPress}
                className={cn(
                  index === 0 ? 'min-w-0 shrink' : 'shrink-0',
                  Platform.select({
                    web: 'cursor-pointer outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-focus-ring',
                  }),
                  segmentBox,
                  'active:opacity-70',
                )}
              >
                {label}
              </Pressable>
            ) : (
              <View
                className={cn(
                  'min-w-0',
                  segmentBox,
                  current ? 'max-w-[70%] shrink-0' : index === 0 ? 'shrink' : 'shrink-0',
                )}
              >
                {label}
              </View>
            )}
          </Fragment>
        )
      })}
    </View>
  )
}

export type { BreadcrumbProps, BreadcrumbSegment }
