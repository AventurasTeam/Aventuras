import { Flag, MapPin, Package, User, type LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type EntityKind = 'character' | 'location' | 'item' | 'faction'

type EntityKindIconProps = {
  kind: EntityKind
  /**
   * Optional class overrides for the 22×22 wrapper.
   */
  className?: string
}

const KIND_GLYPHS: Record<EntityKind, LucideIcon> = {
  character: User,
  location: MapPin,
  item: Package,
  faction: Flag,
}

export function EntityKindIcon({ kind, className }: EntityKindIconProps) {
  const Glyph = KIND_GLYPHS[kind]
  return (
    <View
      accessibilityRole="image"
      aria-label={kind}
      className={cn('h-[22px] w-[22px] items-center justify-center', className)}
    >
      <Icon as={Glyph} size="sm" />
    </View>
  )
}

export type { EntityKind, EntityKindIconProps }
