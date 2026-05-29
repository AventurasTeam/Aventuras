import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import * as RadioGroupBase from '@rn-primitives/radio-group'
import * as SelectBase from '@rn-primitives/select'
import { Check, ChevronDown, ChevronDownIcon, ChevronUpIcon } from 'lucide-react-native'
import { Fragment, useMemo, useRef, type ComponentProps, type ReactNode } from 'react'
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
// rn-primitives Content stamps onStartShouldSetResponder={() => true},
// which competes with RN's JS-side ScrollView pan claim. Gesture-handler's
// ScrollView uses native gesture handling and bypasses the JS responder.
import { ScrollView } from 'react-native-gesture-handler'
import { FadeIn, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { Text, TextClassContext } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { useTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : Fragment

const Root = SelectBase.Root
const Group = SelectBase.Group

function Value({
  className,
  placeholder,
  children,
}: {
  className?: string
  placeholder?: string
  children?: ReactNode
}) {
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

type TriggerSize = 'xs' | 'sm' | 'md'

const TRIGGER_SIZE_HEIGHT: Record<TriggerSize, string> = {
  xs: 'h-control-xs',
  sm: 'h-control-sm',
  md: 'h-control-md',
}

function Trigger({
  className,
  children,
  size = 'md',
  ...props
}: ComponentProps<typeof SelectBase.Trigger> & {
  children?: ReactNode
  size?: TriggerSize
}) {
  return (
    <SelectBase.Trigger
      className={cn(
        'flex flex-row items-center justify-between gap-2 rounded-md border border-border bg-bg-base px-3 active:bg-tint-hover',
        TRIGGER_SIZE_HEIGHT[size],
        Platform.select({
          web: 'whitespace-nowrap outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:pointer-events-none [&_svg]:shrink-0',
        }),
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      <>{children}</>
      <Icon as={ChevronDown} aria-hidden size="md" className="text-fg-muted" />
    </SelectBase.Trigger>
  )
}

type ContentSheetSize = 'short' | 'medium'

const SHEET_HEIGHT_PCT: Record<ContentSheetSize, `${number}%`> = {
  short: '33%',
  medium: '60%',
}

function PhoneSheetContent({
  className,
  children,
  sheetSize = 'short',
  portalHost,
  label,
  tailAction,
}: {
  className?: string
  children?: ReactNode
  sheetSize?: ContentSheetSize
  portalHost?: string
  label?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  const { open, onOpenChange } = SelectBase.useRootContext()
  const { theme } = useTheme()

  const sheetRef = useRef<BottomSheet>(null)
  const snapPoints = useMemo(() => [SHEET_HEIGHT_PCT[sheetSize]], [sheetSize])

  const backgroundStyle = useMemo<ViewStyle>(
    () => ({
      backgroundColor: theme.colors['--bg-overlay'],
      borderColor: theme.colors['--border-strong'],
      borderWidth: StyleSheet.hairlineWidth,
    }),
    [theme],
  )

  const handleIndicatorStyle = useMemo<ViewStyle>(
    () => ({ backgroundColor: theme.colors['--fg-muted'], opacity: 0.4 }),
    [theme],
  )

  return (
    // SelectBase.Portal re-wraps children with Select.Root context at its render
    // location. We use gorhom's inline BottomSheet (not BottomSheetModal) so the
    // sheet renders in-tree inside that re-wrap, keeping SelectBase.Content's
    // Root context lookup happy. BottomSheetModal would portal again and lose it.
    <SelectBase.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'box-none' : 'none'}>
          <BottomSheet
            ref={sheetRef}
            index={open ? 0 : -1}
            snapPoints={snapPoints}
            enableDynamicSizing={false}
            enablePanDownToClose
            keyboardBehavior="extend"
            keyboardBlurBehavior="restore"
            backgroundStyle={backgroundStyle}
            handleIndicatorStyle={handleIndicatorStyle}
            onClose={() => onOpenChange(false)}
          >
            <TextClassContext.Provider value="text-fg-primary">
              <View className={cn('flex-1 p-4', className)}>
                <SelectBase.Content
                  disablePositioningStyle
                  position="popper"
                  className="flex-1 outline-none"
                >
                  {label != null && label.length > 0 && (
                    <Heading level={2} className="mb-3">
                      {label}
                    </Heading>
                  )}
                  <BottomSheetScrollView className="flex-1">
                    <SelectBase.Viewport>{children}</SelectBase.Viewport>
                  </BottomSheetScrollView>
                  {tailAction != null ? (
                    <>
                      <View className="-mx-4 h-px bg-border" />
                      <TailActionRow label={tailAction.label} onPress={tailAction.onPress} />
                    </>
                  ) : null}
                </SelectBase.Content>
              </View>
            </TextClassContext.Provider>
          </BottomSheet>
        </View>
      </FullWindowOverlay>
    </SelectBase.Portal>
  )
}

const POPOVER_EDGE_GAP_PX = 8

function PopoverContent({
  className,
  children,
  position = 'popper',
  portalHost,
  tailAction,
  ...props
}: ComponentProps<typeof SelectBase.Content> & {
  className?: string
  portalHost?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  // Web stretches the popover to the trigger via --radix-select-trigger-width
  // and clamps height via max-h-52; native has no equivalent so we derive both
  // from the measured trigger + window + insets. avoidCollisions in the native
  // primitive only clamps the top against screen bounds, leaving content to
  // overflow without scrolling — drive maxHeight ourselves so the inner
  // ScrollView clamps and actually scrolls.
  const { triggerPosition } = SelectBase.useRootContext()
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const triggerBottom = (triggerPosition?.pageY ?? 0) + (triggerPosition?.height ?? 0)
  const spaceBelow = Math.max(windowHeight - insets.bottom - triggerBottom - POPOVER_EDGE_GAP_PX, 0)
  const spaceAbove = Math.max((triggerPosition?.pageY ?? 0) - insets.top - POPOVER_EDGE_GAP_PX, 0)
  const flipUp = spaceAbove > spaceBelow
  const nativeSide: 'top' | 'bottom' = flipUp ? 'top' : 'bottom'
  const nativeMaxHeight = Math.floor(Math.max(spaceBelow, spaceAbove))

  const contentStyle = useMemo<ViewStyle>(
    () => ({
      ...(Platform.OS === 'web' ? { zIndex: 100 } : null),
      ...(Platform.OS !== 'web' && triggerPosition?.width != null
        ? { width: triggerPosition.width, maxHeight: nativeMaxHeight }
        : null),
    }),
    [triggerPosition?.width, nativeMaxHeight],
  )
  return (
    <SelectBase.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <SelectBase.Overlay style={Platform.select({ native: StyleSheet.absoluteFill })}>
          <TextClassContext.Provider value="text-fg-primary">
            <NativeOnlyAnimatedView className="z-[100]" entering={FadeIn} exiting={FadeOut}>
              <SelectBase.Content
                style={contentStyle}
                className={cn(
                  'relative z-[100] min-w-[8rem] rounded-md border border-border bg-bg-overlay',
                  Platform.select({
                    web: 'max-h-52 animate-fade-in overflow-y-auto overflow-x-hidden',
                    native: 'p-1',
                  }),
                  className,
                )}
                position={position}
                side={Platform.OS !== 'web' ? nativeSide : undefined}
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
                          web: 'h-[var(--radix-select-trigger-height)] w-[var(--radix-select-trigger-width)]',
                        }),
                      ),
                  )}
                >
                  {Platform.OS === 'web' ? (
                    children
                  ) : (
                    <ScrollView
                      className="flex-1"
                      contentContainerClassName="flex-grow"
                      nestedScrollEnabled
                    >
                      {children}
                    </ScrollView>
                  )}
                </SelectBase.Viewport>
                <ScrollDownButton />
                {tailAction != null ? (
                  <>
                    <View className="h-px bg-border" />
                    <TailActionRow label={tailAction.label} onPress={tailAction.onPress} />
                  </>
                ) : null}
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
  label,
  tailAction,
  ...props
}: ComponentProps<typeof SelectBase.Content> & {
  className?: string
  portalHost?: string
  sheetSize?: ContentSheetSize
  label?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  const tier = useTier()
  const usesSheet = Platform.OS !== 'web' && tier === 'phone'
  if (usesSheet) {
    return (
      <PhoneSheetContent
        className={props.className}
        sheetSize={sheetSize}
        label={label}
        tailAction={tailAction}
      >
        {props.children}
      </PhoneSheetContent>
    )
  }
  return <PopoverContent tailAction={tailAction} {...props} />
}

function TailActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { onOpenChange } = SelectBase.useRootContext()
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        onOpenChange(false)
        onPress()
      }}
      className={cn(
        'flex-row items-center justify-between px-row-x-md py-row-y-md active:bg-tint-press',
        Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }) ?? '',
      )}
    >
      <Text size="sm" className="font-medium">
        {label}
      </Text>
    </Pressable>
  )
}

function Label({ className, ...props }: ComponentProps<typeof SelectBase.Label>) {
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
  customContent,
  ...props
}: ComponentProps<typeof SelectBase.Item> & {
  children?: ReactNode
  customContent?: boolean
}) {
  const tier = useTier()
  const isPhone = Platform.OS !== 'web' && tier === 'phone'
  return (
    <SelectBase.Item
      className={cn(
        'group relative flex w-full flex-row items-center gap-2 rounded-sm border-b border-b-border py-row-y-md active:bg-bg-sunken',
        customContent ? 'px-row-x-md' : 'pl-row-x-md pr-10',
        isPhone ? 'min-h-control-lg first:border-t first:border-t-border' : 'last:border-b-0',
        customContent && 'data-[state=checked]:bg-bg-sunken',
        Platform.select({
          web: 'cursor-default outline-none hover:bg-bg-sunken focus:bg-bg-sunken data-[disabled]:pointer-events-none [&_svg]:pointer-events-none',
        }),
        props.disabled && 'opacity-50',
        className,
      )}
      {...props}
    >
      {customContent ? null : (
        <>
          <View className="absolute right-3 flex size-5 items-center justify-center">
            <SelectBase.ItemIndicator>
              <Icon as={Check} size="md" className="shrink-0" />
            </SelectBase.ItemIndicator>
          </View>
          <SelectBase.ItemText className="select-none text-base text-fg-primary" />
        </>
      )}
      {children as ReactNode}
    </SelectBase.Item>
  )
}

function Separator({ className, ...props }: ComponentProps<typeof SelectBase.Separator>) {
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

function ScrollUpButton({ className, ...props }: ComponentProps<typeof SelectBase.ScrollUpButton>) {
  if (Platform.OS !== 'web') return null
  return (
    <SelectBase.ScrollUpButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <Icon as={ChevronUpIcon} size="sm" />
    </SelectBase.ScrollUpButton>
  )
}

function ScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectBase.ScrollDownButton>) {
  if (Platform.OS !== 'web') return null
  return (
    <SelectBase.ScrollDownButton
      className={cn('flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <Icon as={ChevronDownIcon} size="sm" />
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
  /**
   * Override the auto-derivation cascade: by default Select picks
   * `'segment'` (≤3 short options, no descriptions, desktop tier),
   * `'radio'` (4–7 options or any have descriptions), or
   * `'dropdown'` (8+, or mobile, or grouped).
   */
  mode?: SelectMode
  /**
   * Mobile sheet height: `'short'` (33 %), `'medium'` (60 %), or
   * `'auto'` (sized by option count). Only applies when `mode`
   * resolves to `'dropdown'` on the phone.
   */
  sheetSize?: SelectSheetSize
  placeholder?: string
  /**
   * Field label. On phone (when `mode` resolves to `'dropdown'`),
   * it's a visible title at the top of the bottom Sheet.
   */
  label?: string
  disabled?: boolean
  className?: string

  /**
   * Trigger height tier — `'xs'` (`h-control-xs`, dense controls),
   * `'sm'` (`h-control-sm`, compact form), or `'md'` (`h-control-md`,
   * default form row). Only affects the trigger button on every
   * tier; Sheet sizing on phone is unaffected (driven by option
   * count via `sheetSize`). Ignored for `segment` and `radio` modes.
   */
  size?: TriggerSize

  /**
   * Custom row renderer for `dropdown` mode.
   */
  renderRow?: (args: { option: SelectOption; selected: boolean }) => ReactNode

  /**
   * Custom trigger content for `dropdown` mode.
   */
  renderTrigger?: (args: {
    selected: SelectOption | undefined
    placeholder: string | undefined
  }) => ReactNode

  /**
   * Optional fixed action surfaced at the bottom of the popover /
   * sheet, after the option list. Closes the dropdown on press in
   * addition to firing the caller's handler.
   */
  tailAction?: { label: string; onPress: () => void }
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

function groupOptions(options: SelectOption[]): {
  name: string | null
  options: SelectOption[]
}[] {
  const groups: { name: string | null; options: SelectOption[] }[] = []
  const byName = new Map<string | null, SelectOption[]>()
  for (const opt of options) {
    const key = opt.group ?? null
    let bucket = byName.get(key)
    if (!bucket) {
      bucket = []
      byName.set(key, bucket)
      groups.push({ name: key, options: bucket })
    }
    bucket.push(opt)
  }
  return groups
}

function SegmentBranch({ options, value, onValueChange, disabled, className }: SelectProps) {
  return (
    <RadioGroupBase.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      className={cn(
        'h-control-md flex-row overflow-hidden rounded-md border border-border-strong bg-bg-base',
        className,
      )}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value
        const optDisabled = disabled || opt.disabled
        return (
          <RadioGroupBase.Item
            key={opt.value}
            value={opt.value}
            disabled={optDisabled ?? undefined}
            className={cn(
              'flex-1 items-center justify-center px-3',
              i > 0 && 'border-l border-l-border-strong',
              selected ? 'bg-accent' : 'active:bg-tint-press',
              Platform.select({
                web: cn(
                  !selected && 'hover:bg-tint-hover',
                  'focus-visible:ring-focus-ring/50 cursor-pointer outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed',
                ),
              }),
              optDisabled && 'opacity-50',
            )}
          >
            <Text size="sm" className={cn('text-center', selected && 'text-accent-fg')}>
              {opt.label}
            </Text>
          </RadioGroupBase.Item>
        )
      })}
    </RadioGroupBase.Root>
  )
}

function RadioBranch({ options, value, onValueChange, disabled, className }: SelectProps) {
  return (
    <RadioGroupBase.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      className={cn('flex-col gap-2', className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value
        const optDisabled = disabled || opt.disabled
        return (
          <RadioGroupBase.Item
            key={opt.value}
            value={opt.value}
            disabled={optDisabled ?? undefined}
            className={cn(
              'flex-row items-start gap-3 rounded-md border bg-bg-base px-row-x-md py-row-y-md',
              selected ? 'border-accent' : 'border-border active:bg-tint-press',
              Platform.select({
                web: cn(
                  !selected && 'hover:bg-tint-hover',
                  'focus-visible:ring-focus-ring/50 cursor-pointer outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed',
                ),
              }),
              optDisabled && 'opacity-50',
            )}
          >
            <View
              className={cn(
                'mt-0.5 size-4 items-center justify-center rounded-full border-2',
                selected ? 'border-accent bg-accent' : 'border-border-strong bg-bg-base',
              )}
            >
              <RadioGroupBase.Indicator className="size-1.5 rounded-full bg-accent-fg" />
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
          </RadioGroupBase.Item>
        )
      })}
    </RadioGroupBase.Root>
  )
}

function DropdownBranch({
  options,
  value,
  onValueChange,
  disabled,
  sheetSize,
  placeholder,
  label,
  className,
  size,
  renderRow,
  renderTrigger,
  tailAction,
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
      <Trigger className={className} disabled={disabled} size={size}>
        {renderTrigger != null ? (
          renderTrigger({ selected, placeholder })
        ) : (
          <Value placeholder={placeholder} />
        )}
      </Trigger>
      <Content
        sheetSize={resolvedSheetSize}
        label={label}
        tailAction={tailAction}
        className={
          renderRow != null ? (Platform.select({ web: 'max-h-96' }) ?? undefined) : undefined
        }
      >
        {groupOptions(options).map((group) => (
          <Group key={group.name ?? '__ungrouped__'}>
            {group.name != null ? <Label>{group.name}</Label> : null}
            {group.options.map((opt) =>
              renderRow != null ? (
                <Item
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  disabled={opt.disabled}
                  customContent
                >
                  {renderRow({ option: opt, selected: opt.value === value })}
                </Item>
              ) : (
                <Item key={opt.value} value={opt.value} label={opt.label} disabled={opt.disabled} />
              ),
            )}
          </Group>
        ))}
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
