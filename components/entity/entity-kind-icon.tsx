import { Flag, MapPin, Package, ScrollText, User, type LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type EntityKind = 'character' | 'location' | 'item' | 'faction'

/** Lore isn't an entity kind, but it takes its glyph from the same set. */
type GlyphKind = EntityKind | 'lore'

type EntityKindIconProps = {
  kind: GlyphKind
  /**
   * Optional class overrides for the 22×22 wrapper.
   */
  className?: string
}

// foundations/iconography.md → Entity kind glyphs.
export const KIND_GLYPHS: Record<GlyphKind, LucideIcon> = {
  character: User,
  location: MapPin,
  item: Package,
  faction: Flag,
  lore: ScrollText,
}

export function EntityKindIcon({ kind, className }: EntityKindIconProps) {
  const Glyph = KIND_GLYPHS[kind]
  return (
    <View
      accessibilityRole="image"
      aria-label={t(`kinds.${kind}`)}
      className={cn('h-[22px] w-[22px] items-center justify-center', className)}
    >
      <Icon as={Glyph} size="sm" />
    </View>
  )
}

export type { EntityKind, EntityKindIconProps, GlyphKind }
