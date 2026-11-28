import { Menu } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'

import { CHIP_HIT_SLOP, STATE_CHIP_CLASS } from '@/components/ui/chip'
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
      className={cn(STATE_CHIP_CLASS, 'relative overflow-hidden')}
    >
      <TintLayer tint={tint} testID="browse-chip-tint" />
      <Icon as={Menu} size="sm" />
      <Text size="xs" className="font-medium">
        {label}
      </Text>
    </Pressable>
  )
}
