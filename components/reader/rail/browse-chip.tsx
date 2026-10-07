import { Menu } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'
import { cn } from '@/lib/utils'

import { TintLayer } from './tint-layer'

// As Chip: h-control-xs is 36 at regular density, and 36 + 2·4 reaches the 44 px phone floor.
const CHIP_HIT_SLOP = 4

export type BrowseChipProps = { tint: RecentlyClassified | undefined; onPress: () => void }

export function BrowseChip({ tint, onPress }: BrowseChipProps) {
  const label = t('reader:rail.browse')
  return (
    <Pressable
      testID="browse-chip"
      accessibilityRole="button"
      aria-label={label}
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
