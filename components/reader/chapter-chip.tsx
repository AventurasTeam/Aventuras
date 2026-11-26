import { ChevronDown } from 'lucide-react-native'
import type { ReactElement, Ref } from 'react'
import { Pressable, type PressableProps, type View } from 'react-native'

import { CHIP_HIT_SLOP, STATE_CHIP_CLASS } from '@/components/ui/chip'
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
      className={cn(STATE_CHIP_CLASS, className)}
      {...slotProps}
    >
      <Text size="xs" className="font-medium">
        {label}
      </Text>
      <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
    </Pressable>
  )
}
