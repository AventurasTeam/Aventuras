import {
  BookOpen,
  Coins,
  Crown,
  Diamond,
  DoorOpen,
  Eye,
  Flame,
  Handshake,
  Heart,
  Key,
  Map as MapIcon,
  Scroll,
  Shield,
  Skull,
  Sparkles,
  Swords,
  VenetianMask,
  Zap,
  type LucideIcon,
} from 'lucide-react-native'
import { View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import type { PlotKind } from '@/lib/list-modules'
import { isPlotIconKey, type PlotIconKey } from '@/lib/plot'
import { cn } from '@/lib/utils'

/**
 * The glyph for each catalog key (`lib/plot`'s `PLOT_ICON_KEYS`); unknown keys fall back per kind
 * and survive a save. Keyed by `PlotIconKey`, so a key on one side only fails to compile.
 */
export const PLOT_ICONS: Readonly<Record<PlotIconKey, LucideIcon>> = {
  sparkles: Sparkles,
  eye: Eye,
  handshake: Handshake,
  door: DoorOpen,
  swords: Swords,
  flame: Flame,
  mask: VenetianMask,
  scroll: Scroll,
  key: Key,
  skull: Skull,
  crown: Crown,
  map: MapIcon,
  heart: Heart,
  shield: Shield,
  coins: Coins,
  book: BookOpen,
}

// detail-pane.tsx names ◇ for threads; Zap keeps happenings distinct from the CK ⊙ marker.
const FALLBACK: Record<PlotKind, LucideIcon> = { thread: Diamond, happening: Zap }

export function plotIconGlyph(kind: PlotKind, icon: string | null | undefined): LucideIcon {
  return icon != null && isPlotIconKey(icon) ? PLOT_ICONS[icon] : FALLBACK[kind]
}

type PlotIconProps = { kind: PlotKind; icon: string | null | undefined; className?: string }

/** 22×22 glyph wrapper, the same box `EntityKindIcon` uses so rows align across World and Plot. */
export function PlotIcon({ kind, icon, className }: PlotIconProps) {
  return (
    <View className={cn('h-[22px] w-[22px] items-center justify-center', className)}>
      <Icon as={plotIconGlyph(kind, icon)} size="sm" />
    </View>
  )
}
