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
//   forms.md cascade at runtime; phone-tier dropdown branch swaps
//   the rn-primitives Portal/Overlay/Content for our Sheet via the
//   useRootContext bridge.
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
// Phone-tier Sheet bridge: SelectContent reads useRootContext for
// `{ open, onOpenChange }` and plumbs them into Sheet's controlled
// API. SelectPrimitive.Item works inside Sheet because Item only
// depends on Root context, not on Content.

import { Icon } from '@/components/ui/icon'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { Sheet, SheetContent, type SheetSize } from '@/components/ui/sheet'
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
} from 'react-native'
import { FadeIn, FadeOut } from 'react-native-reanimated'
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

// SheetSize is a sister type to the sheetSize prop on SelectContent /
// the dispatcher; redeclared as the optional override on the primitive
// branch (auto-derived in the dispatcher when not supplied).
type ContentSheetSize = SheetSize

function PhoneSheetContent({
  className,
  children,
  sheetSize = 'short',
}: {
  className?: string
  children?: React.ReactNode
  sheetSize?: ContentSheetSize
}) {
  const { open, onOpenChange } = SelectBase.useRootContext()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent anchor="bottom" size={sheetSize} className={className}>
        <ScrollView className="flex-1">
          <TextClassContext.Provider value="text-fg-primary">{children}</TextClassContext.Provider>
        </ScrollView>
      </SheetContent>
    </Sheet>
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
