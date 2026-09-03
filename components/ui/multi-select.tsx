import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import * as PopoverPrimitive from '@rn-primitives/popover'
import { ChevronDown } from 'lucide-react-native'
import { useCallback, useId, useMemo, useState } from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'
// Desktop: gesture-handler ScrollView bypasses rn-primitives Content's
// onStartShouldSetResponder claim. Phone: BottomSheetScrollView registers
// with gorhom's sheet gesture system so the row scroll and the sheet drag
// don't fight each other (same pattern Select uses for its phone branch).
import { ScrollView } from 'react-native-gesture-handler'

import { Checkbox } from '@/components/ui/checkbox'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

import {
  clearAll,
  computeSelectionState,
  normalizeSelection,
  selectAll,
  selectionLabel,
  toggleValue,
  type MultiSelectOption,
} from './multi-select-state'

type MultiSelectProps = {
  /** Label prefix shown before the auto-computed state on the trigger (e.g. `Subsystem`). */
  prefix: string
  /** Source-order list. Render order is preserved; primitive does not sort. */
  options: readonly MultiSelectOption[]
  /** Current selection. Accepts Set or array; primitive normalizes internally. */
  selected: ReadonlySet<string> | readonly string[]
  /** Fired on every toggle, Select-all, and Clear-all. Emits an array in source order. */
  onChange: (next: string[]) => void
  /** Whole-control disable. */
  disabled?: boolean
  /** Title-tooltip when disabled (parity with Input / Select). */
  disabledReason?: string
  /** Class override for the trigger (consumer customization, e.g. de-emphasis on `all`). */
  triggerClassName?: string
}

function emitSelection(
  next: ReadonlySet<string>,
  options: readonly MultiSelectOption[],
  onChange: (next: string[]) => void,
) {
  const ordered = options.filter((o) => next.has(o.value)).map((o) => o.value)
  onChange(ordered)
}

export function MultiSelect({
  prefix,
  options,
  selected,
  onChange,
  disabled,
  disabledReason,
  triggerClassName,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const tier = useTier()
  const usesSheet = Platform.OS !== 'web' && tier === 'phone'

  const normalized = useMemo(() => normalizeSelection(selected, options), [selected, options])
  const state = useMemo(() => computeSelectionState(normalized, options), [normalized, options])
  const stateLabel = selectionLabel(state)

  const handleSelectAll = useCallback(() => {
    emitSelection(selectAll(options), options, onChange)
  }, [options, onChange])

  const handleClearAll = useCallback(() => {
    emitSelection(clearAll(), options, onChange)
  }, [options, onChange])

  const handleToggle = useCallback(
    (value: string) => {
      emitSelection(toggleValue(normalized, value), options, onChange)
    },
    [normalized, options, onChange],
  )

  const overlay = (
    <Overlay
      options={options}
      selected={normalized}
      state={state}
      onSelectAll={handleSelectAll}
      onClearAll={handleClearAll}
      onToggle={handleToggle}
      // Not `false`: the trigger blocks OPENING while disabled, but an overlay already
      // open when the prop flips would keep its rows and bulk actions live.
      disabled={disabled === true}
      insideSheet={usesSheet}
      scroll={usesSheet ? 'sheet' : 'bounded'}
    />
  )

  const triggerInner = (
    <>
      <Text nativeID={labelId} size="xs" className="text-fg-muted">
        {prefix}:
      </Text>
      <Text size="xs" className="text-fg-primary">
        {stateLabel}
      </Text>
      <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
    </>
  )

  const triggerClass = cn(
    'h-control-xs flex-row items-center gap-2 rounded-md border border-border bg-bg-base px-3',
    'active:bg-tint-hover',
    Platform.select({
      web: 'outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus-ring',
    }),
    disabled && 'opacity-50',
    triggerClassName,
  )

  const webTitle = Platform.OS === 'web' ? { title: disabled ? disabledReason : undefined } : null

  if (usesSheet) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${prefix}: ${stateLabel}`}
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          {...webTitle}
          className={triggerClass}
        >
          {triggerInner}
        </Pressable>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent anchor="bottom" size="medium" title={prefix}>
            {overlay}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover onOpenChange={setOpen} ariaLabelledBy={labelId}>
      <PopoverTrigger asChild disabled={disabled}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${prefix}: ${stateLabel}`}
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          {...webTitle}
          className={triggerClass}
        >
          {triggerInner}
        </Pressable>
      </PopoverTrigger>
      <PopoverContent
        accessibilityRole="dialog"
        className={cn(
          'p-0',
          // Web: match trigger width via radix's exposed CSS variable so the
          // popover never looks narrower than its trigger. Native equivalent
          // applied via inline style below.
          Platform.select({ web: 'min-w-[var(--radix-popover-trigger-width)]' }),
        )}
      >
        <NativeWidthSync>{overlay}</NativeWidthSync>
      </PopoverContent>
    </Popover>
  )
}

export type MultiSelectListProps = {
  options: readonly MultiSelectOption[]
  selected: ReadonlySet<string> | readonly string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /**
   * True when this list is rendered inside a bottom sheet. Selects the scroll host:
   * a plain ScrollView's touches fight the sheet's drag gesture.
   */
  insideSheet?: boolean
  /** Override the scroll host. `'none'` when an ancestor already scrolls. */
  scroll?: 'bounded' | 'none'
  className?: string
}

/**
 * The selection list on its own, with no trigger and no overlay around it.
 *
 * Exists because every pick-from-a-list primitive here presents as a Sheet on phone,
 * and a Sheet may not open over a Sheet
 * (docs/ui/foundations/mobile/layout.md → Stacking). A form that is itself presented
 * in a Sheet therefore cannot host `MultiSelect`; it renders this inline instead.
 */
export function MultiSelectList({
  options,
  selected,
  onChange,
  disabled,
  insideSheet = false,
  scroll,
  className,
}: MultiSelectListProps) {
  const normalized = useMemo(() => normalizeSelection(selected, options), [selected, options])
  const state = useMemo(() => computeSelectionState(normalized, options), [normalized, options])

  const handleSelectAll = useCallback(() => {
    emitSelection(selectAll(options), options, onChange)
  }, [options, onChange])
  const handleClearAll = useCallback(() => {
    emitSelection(clearAll(), options, onChange)
  }, [options, onChange])
  const handleToggle = useCallback(
    (value: string) => {
      emitSelection(toggleValue(normalized, value), options, onChange)
    },
    [normalized, options, onChange],
  )

  // Bulk actions are gated with the rows: clearing mid-save leaves the form showing a
  // failure over a selection that no longer matches what was submitted. Gated on the
  // controls rather than by swapping the handlers for no-ops — an inert control that
  // still takes focus and announces itself as enabled is a trap for keyboard and
  // screen-reader users, who get no feedback that the press did nothing.
  const inert = disabled === true
  return (
    <View
      className={cn(
        'overflow-hidden rounded-md border border-border',
        inert && 'opacity-50',
        className,
      )}
    >
      <Overlay
        options={options}
        selected={normalized}
        state={state}
        onSelectAll={handleSelectAll}
        onClearAll={handleClearAll}
        onToggle={handleToggle}
        disabled={inert}
        insideSheet={insideSheet}
        scroll={scroll ?? (insideSheet ? 'none' : 'bounded')}
      />
    </View>
  )
}

type OverlayProps = {
  options: readonly MultiSelectOption[]
  selected: ReadonlySet<string>
  state: ReturnType<typeof computeSelectionState>
  onSelectAll: () => void
  onClearAll: () => void
  onToggle: (value: string) => void
  /** Whole-list disable — gates the bulk actions and every row. */
  disabled: boolean
  /** Inside a gorhom bottom sheet — drives the touch row height. */
  insideSheet: boolean
  /** Which scroll host wraps the rows. `'none'` when an ancestor already scrolls. */
  scroll: 'sheet' | 'bounded' | 'none'
}

const SCROLL_MAX_HEIGHT: ViewStyle = { maxHeight: 320 }

function Overlay({
  options,
  selected,
  state,
  onSelectAll,
  onClearAll,
  onToggle,
  disabled,
  insideSheet,
  scroll,
}: OverlayProps) {
  const header = (
    <View className="flex-row items-center gap-3 border-b border-border px-row-x-md py-row-y-sm">
      <Pressable
        accessibilityRole="button"
        onPress={onSelectAll}
        disabled={disabled || state.kind === 'all'}
        className={cn('h-control-xs justify-center px-2', state.kind === 'all' && 'opacity-50')}
      >
        <Text size="xs" className="text-fg-primary">
          Select all
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onClearAll}
        disabled={disabled || state.kind === 'none'}
        className={cn('h-control-xs justify-center px-2', state.kind === 'none' && 'opacity-50')}
      >
        <Text size="xs" className="text-fg-primary">
          Clear all
        </Text>
      </Pressable>
    </View>
  )

  const rows = options.map((option) => (
    <OptionRow
      key={option.value}
      option={option}
      checked={selected.has(option.value)}
      onPress={onToggle}
      disabled={disabled || option.disabled === true}
      insideSheet={insideSheet}
    />
  ))

  if (scroll === 'sheet') {
    // BottomSheetScrollView registers with gorhom's sheet gesture system;
    // a plain ScrollView's touches conflict with the sheet drag and its
    // scroll region doesn't claim available space inside the sheet.
    // flex-1 lets the body fill the remaining sheet height below the header.
    return (
      <View className="flex-1">
        {header}
        <BottomSheetScrollView>{rows}</BottomSheetScrollView>
      </View>
    )
  }

  // An ancestor already owns the scroll. Nesting another scrollable here would
  // fight it for the gesture and collapse to zero height inside a flex parent.
  if (scroll === 'none') {
    return (
      <View>
        {header}
        {rows}
      </View>
    )
  }

  return (
    <View>
      {header}
      {/* Inline style — NativeWind's `max-h-*` doesn't compile through to
          the gesture-handler ScrollView's web wrapper (RN-Web nests divs
          and the className lands on a wrapper that doesn't constrain the
          scrollable inner). Explicit style avoids the class pipeline. */}
      <ScrollView style={SCROLL_MAX_HEIGHT} nestedScrollEnabled>
        {rows}
      </ScrollView>
    </View>
  )
}

type OptionRowProps = {
  option: MultiSelectOption
  checked: boolean
  onPress: (value: string) => void
  /** The option's own gate already folded in with the whole list's. */
  disabled: boolean
  insideSheet: boolean
}

// Native popover width has no CSS-var equivalent to web's
// `--radix-popover-trigger-width`. Read the measured trigger from rn-primitives
// root context and apply a minWidth style so the popover matches (or exceeds)
// the trigger width.
function NativeWidthSync({ children }: { children: React.ReactNode }) {
  const { triggerPosition } = PopoverPrimitive.useRootContext()
  const triggerWidth = triggerPosition?.width
  const style = useMemo<ViewStyle | undefined>(() => {
    if (Platform.OS === 'web' || triggerWidth == null) return undefined
    return { minWidth: triggerWidth }
  }, [triggerWidth])
  return <View style={style}>{children}</View>
}

function OptionRow({ option, checked, onPress, disabled, insideSheet }: OptionRowProps) {
  const handlePress = useCallback(() => onPress(option.value), [onPress, option.value])

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      onPress={handlePress}
      disabled={disabled}
      className={cn(
        'flex-row items-center gap-3 px-row-x-md py-row-y-md',
        insideSheet && 'min-h-control-lg',
        Platform.select({ web: 'hover:bg-bg-raised' }),
        'active:bg-bg-raised',
        // The whole-list dim lives on the wrapper; only the per-option gate dims a row.
        option.disabled && 'opacity-50',
      )}
    >
      <Checkbox checked={checked} onCheckedChange={handlePress} disabled={disabled} />
      <Text size="sm" className="flex-1 text-fg-primary">
        {option.label ?? option.value}
      </Text>
    </Pressable>
  )
}

export type { MultiSelectProps }
