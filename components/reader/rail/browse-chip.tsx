import { Menu } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'

import { CHIP_HIT_SLOP } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'
import { cn } from '@/lib/utils'

import { TintLayer } from './tint-layer'

export type BrowseChipProps = {
  tint: RecentlyClassified | undefined
  onPress: () => void
  /** Whether the rail Sheet it opens is open. */
  expanded?: boolean
}

export function BrowseChip({ tint, onPress, expanded = false }: BrowseChipProps) {
  const label = t('reader:rail.browse')
  // As SheetTrigger: aria-haspopup is a web-only DOM attribute RN's prop types don't model.
  const webProps = Platform.OS === 'web' ? ({ 'aria-haspopup': 'dialog' } as object) : null
  return (
    <Pressable
      testID="browse-chip"
      accessibilityRole="button"
      aria-label={label}
      aria-expanded={expanded}
      {...webProps}
      onPress={onPress}
      hitSlop={CHIP_HIT_SLOP}
      className={cn(
        'relative h-control-xs flex-row items-center gap-1.5 overflow-hidden rounded-sm border border-border-strong bg-bg-base px-row-x-sm active:bg-tint-press',
        Platform.select({
          web: 'cursor-pointer outline-none transition-colors hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
        }),
      )}
    >
      <TintLayer tint={tint} testID="browse-chip-tint" />
      <Icon as={Menu} size="sm" />
      <Text size="xs" className="font-medium">
        {label}
      </Text>
    </Pressable>
  )
}
