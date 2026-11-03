import { ChevronDown } from 'lucide-react-native'
import type { ReactElement, Ref } from 'react'
import { Platform, Pressable, type PressableProps, type View } from 'react-native'

import { CHIP_HIT_SLOP } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type ChapterChipProps = Omit<PressableProps, 'children'> & {
  number: number
  /** Whether the overlay it opens is open. */
  expanded?: boolean
  ref?: Ref<View>
}

export function ChapterChip({
  number,
  expanded = false,
  className,
  ...slotProps
}: ChapterChipProps): ReactElement {
  const label = t('chapters:label', { number })
  return (
    <Pressable
      testID="chapter-chip"
      accessibilityRole="button"
      aria-label={label}
      aria-expanded={expanded}
      hitSlop={CHIP_HIT_SLOP}
      className={cn(
        'h-control-xs flex-row items-center gap-1.5 rounded-sm border border-border-strong bg-bg-base px-row-x-sm active:bg-tint-press',
        Platform.select({
          web: 'cursor-pointer outline-none transition-colors hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
        }),
        className,
      )}
      {...slotProps}
    >
      <Text size="xs" className="font-medium">
        {label}
      </Text>
      <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
    </Pressable>
  )
}
