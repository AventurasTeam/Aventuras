import { ChevronLeft } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'

import { useTapTooltipTrigger } from '@/components/compounds/truncated-text'
import { KIND_GLYPHS } from '@/components/entity/entity-kind-icon'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { t } from '@/lib/i18n'
import { formatStripCount, type RailStripModel, type StripCategory } from '@/lib/reader-rail'
import type { RecentlyClassified } from '@/lib/row-signals'
import { cn } from '@/lib/utils'

import { TintLayer } from './tint-layer'

export const RAIL_STRIP_WIDTH_PX = 32

// Like the tint layer: under the glyph, and later in the DOM, so above the tint.
const HOVER_STYLE = { ...POINTER_EVENTS_NONE, zIndex: -1 } satisfies ViewStyle
const STRIP_WIDTH_STYLE = { width: RAIL_STRIP_WIDTH_PX } satisfies ViewStyle

export type RailStripProps = {
  model: RailStripModel
  /** Chevron and empty region: expand, keep the current category. */
  onExpand: () => void
  /** A cell: expand and switch to its category. */
  onExpandTo: (category: StripCategory) => void
}

export function RailStrip({ model, onExpand, onExpandTo }: RailStripProps) {
  return (
    <View testID="rail-strip" className="flex-1 bg-bg-sunken pt-1" style={STRIP_WIDTH_STYLE}>
      <StripCell label={t('reader:rail.expand')} onPress={onExpand}>
        <Icon as={ChevronLeft} size="sm" />
      </StripCell>
      {model.counted.map((cell) => (
        <StripCell
          key={cell.category}
          label={t(`reader:rail.strip.${cell.category}`, { count: cell.count })}
          tint={cell.tint}
          tintTestID={`rail-strip-tint-${cell.category}`}
          hoverTestID={`rail-strip-hover-${cell.category}`}
          onPress={() => onExpandTo(cell.category)}
        >
          <Icon as={KIND_GLYPHS[cell.category]} size="sm" />
          <Text size="xs" variant={cell.count === 0 ? 'muted' : 'default'} className="font-medium">
            {formatStripCount(cell.count)}
          </Text>
        </StripCell>
      ))}
      <View aria-hidden className="h-1.5" />
      {model.quickAccess.map((cell) => (
        <StripCell
          key={cell.category}
          label={t(`reader:rail.strip.${cell.category}`)}
          tint={cell.tint}
          tintTestID={`rail-strip-tint-${cell.category}`}
          hoverTestID={`rail-strip-hover-${cell.category}`}
          onPress={() => onExpandTo(cell.category)}
        >
          <Icon as={KIND_GLYPHS[cell.category]} size="sm" />
        </StripCell>
      ))}
      {/* Pointer-only: it repeats the chevron's action, so assistive tech meets one expand control. */}
      <Pressable
        testID="rail-strip-empty"
        accessible={false}
        tabIndex={-1}
        onPress={onExpand}
        className={cn('group relative flex-1', Platform.select({ web: 'cursor-pointer' }))}
      >
        <HoverLayer />
      </Pressable>
    </View>
  )
}

type StripCellProps = {
  /** The accessible name and the tooltip text. */
  label: string
  onPress: () => void
  tint?: RecentlyClassified
  tintTestID?: string
  hoverTestID?: string
  children: ReactNode
}

function StripCell(props: StripCellProps) {
  if (Platform.OS === 'web') {
    return (
      <ReasonTooltip reason={props.label}>
        <CellPressable {...props} />
      </ReasonTooltip>
    )
  }
  return <NativeStripCell {...props} />
}

// A tap is the cell's action, so touch.md's tap-to-tooltip moves to a long press here.
function NativeStripCell(props: StripCellProps) {
  const { trigger, onOpenChange } = useTapTooltipTrigger()
  return (
    <Popover asChild onOpenChange={onOpenChange} ariaLabel={props.label}>
      <View>
        <CellPressable {...props} onLongPress={() => trigger.current?.open()} />
        {/* Anchor only: wrapping the cell, the trigger's own onPress would open it on every tap. */}
        <PopoverTrigger ref={trigger} asChild>
          <View
            accessible={false}
            aria-hidden
            className="absolute inset-0"
            style={POINTER_EVENTS_NONE}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto max-w-72 px-3 py-2">
          <Text size="sm">{props.label}</Text>
        </PopoverContent>
      </View>
    </Popover>
  )
}

function CellPressable({
  label,
  onPress,
  onLongPress,
  tint,
  tintTestID,
  hoverTestID,
  children,
}: StripCellProps & { onLongPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-label={label}
      onPress={onPress}
      onLongPress={onLongPress}
      className={cn(
        'group relative items-center justify-center gap-0.5 py-1.5 active:opacity-80',
        Platform.select({
          web: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
        }),
      )}
    >
      <TintLayer tint={tint} testID={tintTestID} />
      <HoverLayer testID={hoverTestID} />
      {children}
    </Pressable>
  )
}

// Over the tint, never instead of it: hover is feedback, the tint is information.
function HoverLayer({ testID }: { testID?: string }) {
  if (Platform.OS !== 'web') return null
  return (
    <View
      testID={testID}
      aria-hidden
      className="absolute inset-0 group-hover:bg-tint-hover"
      style={HOVER_STYLE}
    />
  )
}
