// Aventuras Select primitive — reshaped from react-native-reusables
// baseline (which itself wraps @rn-primitives/select). Implements the
// contract in docs/explorations/2026-05-03-select-primitive.md and
// the canonical pattern in docs/ui/patterns/forms.md.
//
// Two layers exported:
// - `<Select>` — options-driven dispatcher resolving the
//   forms.md auto-derivation cascade (segment / radio / dropdown).
// - `SelectPrimitive` namespace — reshaped baseline pieces (Root,
//   Trigger, Value, Content, Item, Group, Label, Separator, ItemText,
//   ItemIndicator, ScrollUpButton, ScrollDownButton, Viewport,
//   useRootContext). Used by power consumers (calendar picker,
//   future rich-row pickers) when the dispatcher's API doesn't fit.
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: color tokens (popover/popover-foreground/background/
//   border-input/foreground/muted-foreground/accent/accent-foreground/
//   border → bg-bg-overlay/text-fg-primary/bg-bg-base/border-border-strong/
//   text-fg-primary/text-fg-muted/bg-bg-raised/text-fg-primary/border-border).
//   Shadow classes stripped (Aventuras flat-depth principle). Web
//   entry/exit animations stripped pending the NativeWind transition
//   followup. Dark-mode opacity tweaks (dark:bg-input/30 etc.) stripped
//   — the theme registry handles light/dark per-theme. aria-invalid
//   ring tokens deferred to error-state design pass.
// - AUGMENTED (per components.md augmentation policy): `<Select>`
//   dispatcher consumes options-driven API and resolves the
//   forms.md cascade at runtime; phone-tier dropdown branch
//   composes SelectBase.Portal + SelectBase.Overlay + SelectBase.Content
//   (with `disablePositioningStyle`) inside a bottom-anchored
//   sheet-style shell — see the State bridge note above for why
//   our Sheet primitive can't host this branch directly.
// - ACCEPTED: rn-primitives composition (Root, Trigger, Content,
//   Portal, Overlay, Item, ItemText, ItemIndicator, Group, Label,
//   Separator), focus-trap mechanics, anchor-positioning math, iOS
//   FullWindowOverlay z-index handling, ScrollUp/Down buttons.
// - SUBTRACTED: nothing material; baseline maps cleanly.
//
// Native scroll wrap: rn-primitives Viewport is a Fragment; on the
// dropdown render mode's tablet/desktop branch we wrap it in a
// ScrollView with viewport-fraction max-height. Web inherits the
// baseline `max-h-52 overflow-y-auto` plus ScrollUpButton /
// ScrollDownButton.
//
// Phone-tier Sheet bridge: rn-primitives select's RootContext is
// internal — only `useRootContext` is exported. Items inside an
// `@rn-primitives/dialog` Portal (our Sheet primitive) lose the
// SelectBase RootContext because Dialog's Portal bridges Dialog's
// context, not Select's. Items render → useRootContext throws
// "Select compound components cannot be rendered outside the
// Select component".
//
// Resolution: use SelectBase.Portal directly (which DOES bridge
// SelectBase RootContext through the portal boundary) and render
// Sheet-style chrome inside it, with SelectBase.Content marked
// `disablePositioningStyle` so we provide our own bottom-anchored
// layout instead of anchor-positioning math.
//
// Trade-off: no drag-to-dismiss on phone Select v1 — tap-outside
// (via SelectBase.Overlay's closeOnPress) and back-press handle
// dismissal. Drag-to-dismiss would require duplicating Sheet's
// gesture-handler integration here, deferred until a Sheet refactor
// exposes a portal-less shell both Sheet and Select can compose.

import { Icon } from '@/components/ui/icon'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { Text, TextClassContext } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'
import * as SelectBase from '@rn-primitives/select'
import { Check, ChevronDown, ChevronDownIcon, ChevronUpIcon } from 'lucide-react-native'
import * as React from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
import { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment

// ---------------------------------------------------------------------------
// SelectPrimitive namespace — reshaped baseline pieces.
// ---------------------------------------------------------------------------

const Root = SelectBase.Root
const Group = SelectBase.Group

function Value({
  className,
  placeholder,
  children,
}: {
  className?: string
  placeholder?: string
  children?: React.ReactNode
}) {
  // The reusables baseline wraps rn-primitives Value (which on web
  // delegates to radix's Select.Value via Slot) with className. The
  // Slot/Radix indirection swallows our color className on web in
  // some configurations, leaving the trigger label rendering with
  // RN's default text color (black) — invisible on dark themes.
  // Bypassing rn-primitives Value with our themed Text guarantees
  // the color slot resolves correctly. We read selection state from
  // SelectBase.useRootContext directly.
  const { value } = SelectBase.useRootContext()
  const display = value?.label ?? children ?? placeholder ?? ''
  const empty = !value
  return (
    <Text
      size="sm"
      variant={empty ? 'muted' : 'default'}
      className={cn('flex-1', className)}
      numberOfLines={1}
    >
      {display}
    </Text>
  )
}

type TriggerSize = 'default' | 'sm'

function Trigger({
  className,
  children,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SelectBase.Trigger> & {
  children?: React.ReactNode
  size?: TriggerSize
}) {
  return (
    <SelectBase.Trigger
      className={cn(
        'flex h-10 flex-row items-center justify-between gap-2 rounded-md border border-border bg-bg-base px-3 py-2 active:bg-bg-raised',
        Platform.select({
          web: 'whitespace-nowrap outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:pointer-events-none [&_svg]:shrink-0',
        }),
        size === 'sm' && 'h-8 py-1.5',
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <>{children}</>
      <Icon as={ChevronDown} aria-hidden className="size-4 text-fg-muted" />
    </SelectBase.Trigger>
  )
}

// Sheet-size scale — short / medium for v1. `tall` is reserved for
// Autocomplete's future input-at-top sheet shape; Select's dropdown
// doesn't host that pattern.
type ContentSheetSize = 'short' | 'medium'

const SHEET_HEIGHT_PCT: Record<ContentSheetSize, `${number}%`> = {
  short: '33%',
  medium: '60%',
}

const SAFE_AREA_GAP_PX = 8

function PhoneSheetContent({
  className,
  children,
  sheetSize = 'short',
  portalHost,
}: {
  className?: string
  children?: React.ReactNode
  sheetSize?: ContentSheetSize
  portalHost?: string
}) {
  const insets = useSafeAreaInsets()
  const { height: screenHeight } = useWindowDimensions()
  // Cap so the panel never extends above the OS status bar / notch
  // when there's no top-bar chrome above it.
  const maxHeight = Math.max(screenHeight - insets.top - SAFE_AREA_GAP_PX, 0)
  const panelStyle: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT_PCT[sheetSize],
    maxHeight,
  }
  return (
    <SelectBase.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <View style={Platform.select({ native: StyleSheet.absoluteFill })} pointerEvents="box-none">
          <NativeOnlyAnimatedView
            entering={FadeIn.duration(200)}
            exiting={FadeOut}
            style={Platform.select({ native: StyleSheet.absoluteFill })}
          >
            <SelectBase.Overlay
              className="absolute inset-0 bg-black/40"
              style={Platform.select({ native: StyleSheet.absoluteFill })}
            />
          </NativeOnlyAnimatedView>
          <NativeOnlyAnimatedView
            entering={SlideInDown.duration(250)}
            exiting={SlideOutDown}
            style={Platform.select({ native: panelStyle })}
          >
            <TextClassContext.Provider value="text-fg-primary">
              <SelectBase.Content
                disablePositioningStyle
                position="popper"
                className={cn(
                  'flex-1 rounded-t-lg border border-b-0 border-border-strong bg-bg-overlay p-6 outline-none',
                  className,
                )}
              >
                <View className="mx-auto mb-4 h-1 w-10 rounded-full bg-fg-muted opacity-40" />
                <ScrollView className="flex-1">
                  <SelectBase.Viewport>{children}</SelectBase.Viewport>
                </ScrollView>
              </SelectBase.Content>
            </TextClassContext.Provider>
          </NativeOnlyAnimatedView>
        </View>
      </FullWindowOverlay>
    </SelectBase.Portal>
  )
}

function PopoverContent({
  className,
  children,
  position = 'popper',
  portalHost,
  ...props
}: React.ComponentProps<typeof SelectBase.Content> & {
  className?: string
  portalHost?: string
}) {
  const { height: screenHeight } = useWindowDimensions()
  // Native viewport gets a ScrollView clamp so long lists scroll instead
  // of overflowing offscreen. ~50% of screen height is comfortable on
  // tablet without crowding any keyboard area.
  const nativeMaxHeight = Math.floor(screenHeight * 0.5)
  return (
    <SelectBase.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <SelectBase.Overlay style={Platform.select({ native: StyleSheet.absoluteFill })}>
          <TextClassContext.Provider value="text-fg-primary">
            <NativeOnlyAnimatedView className="z-50" entering={FadeIn} exiting={FadeOut}>
              <SelectBase.Content
                className={cn(
                  'relative z-50 min-w-[8rem] rounded-md border border-border bg-bg-overlay',
                  Platform.select({
                    web: 'max-h-52 overflow-y-auto overflow-x-hidden',
                    native: 'p-1',
                  }),
                  className,
                )}
                position={position}
                {...props}
              >
                <ScrollUpButton />
                <SelectBase.Viewport
                  className={cn(
                    'p-1',
                    position === 'popper' &&
                      cn(
                        'w-full',
                        Platform.select({
                          web: 'h-[var(--radix-select-trigger-height)] min-w-[var(--radix-select-trigger-width)]',
                        }),
                      ),
                  )}
                >
                  {Platform.OS === 'web' ? (
                    children
                  ) : (
                    <ScrollView style={{ maxHeight: nativeMaxHeight }}>{children}</ScrollView>
                  )}
                </SelectBase.Viewport>
                <ScrollDownButton />
              </SelectBase.Content>
            </NativeOnlyAnimatedView>
          </TextClassContext.Provider>
        </SelectBase.Overlay>
      </FullWindowOverlay>
    </SelectBase.Portal>
  )
}

function Content({
  sheetSize,
  ...props
}: React.ComponentProps<typeof SelectBase.Content> & {
  className?: string
  portalHost?: string
  sheetSize?: ContentSheetSize
}) {
  const tier = useTier()
  if (tier === 'phone') {
    return (
      <PhoneSheetContent className={props.className} sheetSize={sheetSize}>
        {props.children}
      </PhoneSheetContent>
    )
  }
  return <PopoverContent {...props} />
}

function Label({ className, ...props }: React.ComponentProps<typeof SelectBase.Label>) {
  return (
    <SelectBase.Label
      className={cn('px-2 py-2 text-xs text-fg-muted sm:py-1.5', className)}
      {...props}
    />
  )
}

function Item({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectBase.Item> & { children?: React.ReactNode }) {
  return (
    <SelectBase.Item
      className={cn(
        // bg-bg-sunken (not bg-bg-raised) for hover/focus highlight:
        // overlay → raised has zero contrast on the default light
        // theme (both #ffffff), making the highlight invisible.
        // Sunken is consistently darker than overlay across themes.
        'group relative flex w-full flex-row items-center gap-2 rounded-sm py-2 pl-2 pr-8 active:bg-bg-sunken sm:py-1.5',
        Platform.select({
          web: 'cursor-default outline-none hover:bg-bg-sunken focus:bg-bg-sunken data-[disabled]:pointer-events-none [&_svg]:pointer-events-none',
        }),
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <View className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectBase.ItemIndicator>
          <Icon as={Check} className="size-4 shrink-0 text-fg-primary" />
        </SelectBase.ItemIndicator>
      </View>
      <SelectBase.ItemText className="select-none text-sm text-fg-primary" />
      {children as React.ReactNode}
    </SelectBase.Item>
  )
}

function Separator({ className, ...props }: React.ComponentProps<typeof SelectBase.Separator>) {
  return (
    <SelectBase.Separator
      className={cn(
        '-mx-1 my-1 h-px bg-border',
        Platform.select({ web: 'pointer-events-none' }),
        className,
      )}
      {...props}
    />
  )
}

// Web-only — null on native, where rn-primitives delegates scroll to
// our ScrollView wrapper above.
function ScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectBase.ScrollUpButton>) {
  if (Platform.OS !== 'web') return null
  return (
    <SelectBase.ScrollUpButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <Icon as={ChevronUpIcon} className="size-4" />
    </SelectBase.ScrollUpButton>
  )
}

function ScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectBase.ScrollDownButton>) {
  if (Platform.OS !== 'web') return null
  return (
    <SelectBase.ScrollDownButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <Icon as={ChevronDownIcon} className="size-4" />
    </SelectBase.ScrollDownButton>
  )
}

export const SelectPrimitive = {
  Root,
  Group,
  Value,
  Trigger,
  Content,
  Label,
  Item,
  ItemText: SelectBase.ItemText,
  ItemIndicator: SelectBase.ItemIndicator,
  Separator,
  ScrollUpButton,
  ScrollDownButton,
  Viewport: SelectBase.Viewport,
  useRootContext: SelectBase.useRootContext,
}

// ---------------------------------------------------------------------------
// Dispatcher — options-driven, resolves the forms.md cascade at runtime.
// ---------------------------------------------------------------------------

export type SelectOption = {
  value: string
  label: string
  description?: string
  group?: string
  disabled?: boolean
}

export type SelectMode = 'segment' | 'radio' | 'dropdown'

type SelectSheetSize = 'short' | 'medium' | 'auto'

export type SelectProps = {
  options: SelectOption[]
  value: string | undefined
  onValueChange: (value: string) => void
  mode?: SelectMode
  sheetSize?: SelectSheetSize
  placeholder?: string
  disabled?: boolean
  className?: string
}

function resolveMode(
  options: SelectOption[],
  explicit: SelectMode | undefined,
  tier: ReturnType<typeof useTier>,
): SelectMode {
  if (explicit) return explicit
  if (options.some((o) => o.description)) return 'radio'
  const segmentMax = tier === 'phone' ? 2 : 3
  if (options.length <= segmentMax) return 'segment'
  return 'dropdown'
}

function autoSheetSize(options: SelectOption[]): ContentSheetSize {
  if (options.some((o) => o.group)) return 'medium'
  if (options.length > 6) return 'medium'
  return 'short'
}

function SegmentBranch({ options, value, onValueChange, disabled, className }: SelectProps) {
  return (
    <View
      accessibilityRole="radiogroup"
      className={cn('flex-row rounded-md border border-border-strong bg-bg-base', className)}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value
        const optDisabled = disabled || opt.disabled
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!optDisabled }}
            disabled={optDisabled ?? undefined}
            onPress={() => onValueChange(opt.value)}
            className={cn(
              'flex-1 px-3 py-2',
              i > 0 && 'border-l border-border-strong',
              selected ? 'bg-accent' : 'active:bg-bg-raised',
              Platform.select({ web: !selected && 'hover:bg-bg-raised' }),
              optDisabled && 'opacity-50',
            )}
          >
            <Text size="sm" className={cn('text-center', selected && 'text-accent-fg')}>
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function RadioBranch({ options, value, onValueChange, disabled, className }: SelectProps) {
  return (
    <View accessibilityRole="radiogroup" className={cn('flex-col gap-2', className)}>
      {options.map((opt) => {
        const selected = opt.value === value
        const optDisabled = disabled || opt.disabled
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!optDisabled }}
            disabled={optDisabled ?? undefined}
            onPress={() => onValueChange(opt.value)}
            className={cn(
              'flex-row items-start gap-3 rounded-md border bg-bg-base p-3',
              selected ? 'border-accent' : 'border-border active:bg-bg-raised',
              Platform.select({ web: !selected && 'hover:bg-bg-raised' }),
              optDisabled && 'opacity-50',
            )}
          >
            <View
              className={cn(
                'mt-0.5 size-4 items-center justify-center rounded-full border-2',
                selected ? 'border-accent bg-accent' : 'border-border-strong bg-bg-base',
              )}
            >
              {selected ? <View className="size-1.5 rounded-full bg-accent-fg" /> : null}
            </View>
            <View className="flex-1">
              <Text size="sm" className="font-medium">
                {opt.label}
              </Text>
              {opt.description ? (
                <Text size="xs" variant="muted" className="mt-1">
                  {opt.description}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function DropdownBranch({
  options,
  value,
  onValueChange,
  disabled,
  sheetSize,
  placeholder,
  className,
}: SelectProps) {
  const selected = options.find((o) => o.value === value)
  const resolvedSheetSize: ContentSheetSize =
    sheetSize === undefined || sheetSize === 'auto' ? autoSheetSize(options) : sheetSize
  return (
    <Root
      value={selected ? { value: selected.value, label: selected.label } : undefined}
      onValueChange={(opt) => {
        if (opt) onValueChange(opt.value)
      }}
      disabled={disabled}
    >
      <Trigger className={className}>
        <Value placeholder={placeholder} />
      </Trigger>
      <Content sheetSize={resolvedSheetSize}>
        <Group>
          {options.map((opt) => (
            <Item key={opt.value} value={opt.value} label={opt.label} disabled={opt.disabled} />
          ))}
        </Group>
      </Content>
    </Root>
  )
}

export function Select(props: SelectProps) {
  const tier = useTier()
  const mode = resolveMode(props.options, props.mode, tier)
  if (mode === 'segment') return <SegmentBranch {...props} />
  if (mode === 'radio') return <RadioBranch {...props} />
  return <DropdownBranch {...props} />
}
