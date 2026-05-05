import { Flag, MapPin, Package, User, type LucideIcon } from 'lucide-react-native'
import * as React from 'react'
import { View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type EntityKind = 'character' | 'location' | 'item' | 'faction'

type EntityKindIconProps = {
  kind: EntityKind
  /**
   * Optional class overrides for the 22×22 wrapper. Use for
   * alignment / margin adjustments inside a row; do not override
   * the box size — it is part of the contract so list-pane rows
   * can rely on a stable kind-icon column.
   */
  className?: string
}

// Canonical entity-kind → Lucide glyph map. Pinned in
// docs/ui/foundations/iconography.md → Entity kind glyphs. Source
// table is the single source of truth — when the data-model adds
// or renames a kind, update both this map and the iconography
// table together.
const KIND_GLYPHS: Record<EntityKind, LucideIcon> = {
  character: User,
  location: MapPin,
  item: Package,
  faction: Flag,
}

// 22×22 box with a 16 px (sm) Lucide glyph centered inside it.
// The wrapper has no explicit color — the inner Icon inherits
// from the surrounding `TextClassContext`, so a row that sets
// `text-fg-secondary` on its label gets the same tint on the
// kind icon without per-icon plumbing.
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
