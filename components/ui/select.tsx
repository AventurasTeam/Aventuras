import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { Text, TextClassContext } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'
import * as RadioGroupBase from '@rn-primitives/radio-group'
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'
import { runOnJS } from 'react-native-worklets'

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment

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
        'flex h-control-md flex-row items-center justify-between gap-2 rounded-md border border-border bg-bg-base px-3 active:bg-tint-hover',
        Platform.select({
          web: 'whitespace-nowrap outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-focus-ring [&_svg]:pointer-events-none [&_svg]:shrink-0',
        }),
        size === 'sm' && 'h-control-sm',
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

const SAFE_AREA_GAP_PX = 8
const DRAG_DISMISS_THRESHOLD_PX = 100

function PhoneSheetPanel({
  className,
  children,
  sheetSize,
  label,
  tailAction,
}: {
  className?: string
  children?: React.ReactNode
  sheetSize: ContentSheetSize
  label?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  const { onOpenChange } = SelectBase.useRootContext()
  const insets = useSafeAreaInsets()
  const { height: screenHeight } = useWindowDimensions()
  const maxHeight = Math.max(screenHeight - insets.top - SAFE_AREA_GAP_PX, 0)
  const panelStyle: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT_PCT[sheetSize],
    maxHeight,
  }

  const dragOffset = useSharedValue(0)
  const animatedDragStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: dragOffset.value }] }),
    [],
  )
  const closeFromGesture = React.useCallback(() => onOpenChange(false), [onOpenChange])
  const panGesture = React.useMemo(() => {
    const base = Gesture.Pan()
    return base
      .activeOffsetY([10, Number.POSITIVE_INFINITY])
      .onUpdate((event) => {
        'worklet'
        dragOffset.value = Math.max(0, event.translationY)
      })
      .onEnd((event) => {
        'worklet'
        if (event.translationY > DRAG_DISMISS_THRESHOLD_PX) {
          const target = screenHeight + 200
          dragOffset.value = withTiming(target, { duration: 180 }, (finished?: boolean) => {
            'worklet'
            if (finished) runOnJS(closeFromGesture)()
          })
          return
        }
        dragOffset.value = withSpring(0, {
          damping: 18,
          stiffness: 220,
          overshootClamping: true,
        })
      })
  }, [dragOffset, closeFromGesture, screenHeight])

  // Drag handle: gesture wrapper covers ONLY the handle (matching
  // Sheet primitive's pattern — see sheet.tsx for the full
  // rationale). Web gets no gesture; the panel uses backdrop +
  // Escape. Hit area is `py-6` (~52 px tall, full panel width via
  // `-mx-4 px-4`) so the handle is comfortably grabbable while the
  // visible bar stays at the iOS-standard 4 × 40.
  const handleVisible = <View className="mx-auto h-1 w-10 rounded-full bg-fg-muted opacity-40" />
  const handle =
    Platform.OS === 'web' ? (
      <View className="mb-3">{handleVisible}</View>
    ) : (
      <GestureDetector gesture={panGesture}>
        <View className="-mx-4 -mt-4 mb-2 items-center px-4 py-6">{handleVisible}</View>
      </GestureDetector>
    )

  return (
    <NativeOnlyAnimatedView
      entering={SlideInDown.duration(250)}
      exiting={SlideOutDown}
      style={Platform.select({ native: [panelStyle, animatedDragStyle] })}
    >
      <TextClassContext.Provider value="text-fg-primary">
        <SelectBase.Content
          disablePositioningStyle
          position="popper"
          className={cn(
            'flex-1 rounded-t-lg border border-b-0 border-border-strong bg-bg-overlay p-4 outline-none',
            // Web entry animation — native uses reanimated SlideInDown.
            Platform.select({ web: 'animate-slide-in-from-bottom' }),
            className,
          )}
        >
          {handle}
          {label != null && label.length > 0 && (
            <Heading level={2} className="mb-3">
              {label}
            </Heading>
          )}
          <ScrollView className="flex-1">
            <SelectBase.Viewport>{children}</SelectBase.Viewport>
          </ScrollView>
          {tailAction != null ? (
            <>
              <View className="-mx-4 h-px bg-border" />
              <TailActionRow label={tailAction.label} onPress={tailAction.onPress} />
            </>
          ) : null}
        </SelectBase.Content>
      </TextClassContext.Provider>
    </NativeOnlyAnimatedView>
  )
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
  children?: React.ReactNode
  sheetSize?: ContentSheetSize
  portalHost?: string
  label?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  return (
    <SelectBase.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <View
          className={Platform.OS === 'web' ? 'fixed inset-0' : ''}
          style={Platform.select({ native: StyleSheet.absoluteFill })}
          pointerEvents="box-none"
        >
          <NativeOnlyAnimatedView
            entering={FadeIn.duration(200)}
            exiting={FadeOut}
            style={Platform.select({ native: StyleSheet.absoluteFill })}
          >
            <SelectBase.Overlay
              className={cn(
                'absolute inset-0 bg-black/40',
                Platform.select({ web: 'animate-fade-in' }),
              )}
              style={Platform.select({ native: StyleSheet.absoluteFill })}
            />
          </NativeOnlyAnimatedView>
          <PhoneSheetPanel
            className={className}
            sheetSize={sheetSize}
            label={label}
            tailAction={tailAction}
          >
            {children}
          </PhoneSheetPanel>
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
  tailAction,
  ...props
}: React.ComponentProps<typeof SelectBase.Content> & {
  className?: string
  portalHost?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  const { height: screenHeight } = useWindowDimensions()
  const nativeMaxHeight = Math.floor(screenHeight * 0.5)
  return (
    <SelectBase.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <SelectBase.Overlay style={Platform.select({ native: StyleSheet.absoluteFill })}>
          <TextClassContext.Provider value="text-fg-primary">
            <NativeOnlyAnimatedView className="z-[100]" entering={FadeIn} exiting={FadeOut}>
              <SelectBase.Content
                // z-[100] (matches Toast convention) sits above modal
                // primitives (Dialog / AlertDialog / Sheet all at z-50) so a
                // Select inside a modal renders its popover above the modal
                // panel. Inline style mirrors the class — guards against
                // Tailwind purging the arbitrary value or HMR not picking up
                // the new class.
                style={Platform.select({ web: { zIndex: 100 } })}
                className={cn(
                  'relative z-[100] min-w-[8rem] rounded-md border border-border bg-bg-overlay',
                  Platform.select({
                    web: 'max-h-52 animate-fade-in overflow-y-auto overflow-x-hidden',
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
                        // Lock viewport width to the trigger so rich
                        // content (chips, multi-line rows) can't
                        // overflow past the anchor and overlap
                        // adjacent layout (e.g. summary panels in
                        // side-by-side hosts). Plain-label Select
                        // usage was already content-narrower than
                        // trigger, so this is a no-op there.
                        Platform.select({
                          web: 'h-[var(--radix-select-trigger-height)] w-[var(--radix-select-trigger-width)]',
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
}: React.ComponentProps<typeof SelectBase.Content> & {
  className?: string
  portalHost?: string
  sheetSize?: ContentSheetSize
  label?: string
  tailAction?: { label: string; onPress: () => void }
}) {
  const tier = useTier()
  // Sheet shape is a touch idiom (large pull-down picker on a small
  // touchscreen). On web, even at narrow widths (Electron resized
  // small), the user is still on mouse — popover is the appropriate
  // idiom there. Gate sheet dispatch on native-only.
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

// Pressable row pinned at the bottom of the popover / sheet — the
// `Manage in Vault →` style escape hatch surfaced via Select's
// `tailAction` prop. Closes the dropdown on press in addition to
// firing the caller's handler so navigation can take over without
// the popover lingering.
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
  customContent,
  ...props
}: React.ComponentProps<typeof SelectBase.Item> & {
  children?: React.ReactNode
  /**
   * When true, the default `<ItemText />` is suppressed and the
   * selection-indicator wrapper repositions to the LEFT of the row
   * (`absolute left-2`) so caller-rendered content can occupy the
   * trailing edge for chips, badges, etc. Caller is responsible for
   * the visible text — Item's `label` prop still drives the
   * accessible-name + value semantics.
   */
  customContent?: boolean
}) {
  // Tier-conditional row treatment: phone-tier Sheet rows need
  // touch-sized min-height (`control-lg`) and a top border on the
  // first row so the list visually anchors against the Sheet chrome.
  // Both phone and tablet/desktop variants render INSET inside the
  // panel — no `-mx-4` edge-to-edge bleed. The earlier bleed pattern
  // forced `pl-8` / `pr-10` gymnastics to keep content off the panel
  // edges, and broke down for `customContent` rows where rich content
  // wanted the trailing edge for chips. Inset rows leave the panel's
  // padding cushion intact, the selected-bg reads as a clean inset
  // highlight rather than fighting the rounded corners, and the row
  // contract no longer differs between phone and other tiers.
  const tier = useTier()
  const isPhone = Platform.OS !== 'web' && tier === 'phone'
  return (
    <SelectBase.Item
      className={cn(
        'group relative flex w-full flex-row items-center gap-2 rounded-sm border-b border-b-border py-row-y-md active:bg-bg-sunken',
        // Reserve gutter only on the default-content path: the
        // selected check sits at `right-3` and needs `pr-10` to keep
        // text from overlapping. `customContent` rows drop the check
        // entirely (bg-tint signals selection — see below) so the
        // row uses standard horizontal padding on both sides.
        customContent ? 'px-row-x-md' : 'pl-row-x-md pr-10',
        isPhone ? 'min-h-control-lg first:border-t first:border-t-border' : 'last:border-b-0',
        // Selected-row affordance:
        // - Default content: the absolute Check icon is the signal.
        // - Custom content: rich rows often carry their own
        //   trailing chips/badges; an extra check competes for the
        //   left edge, and surface tint reads cleaner. Use Radix's
        //   `data-state="checked"` attribute (web) /
        //   `accessibilityState.selected` mapping (native) — which
        //   the rn-primitives wrapper drives — to drop the bg tint
        //   on the selected row.
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
      <Icon as={ChevronUpIcon} size="sm" />
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
   * `'dropdown'` (8+, or mobile, or grouped). Set explicitly to
   * lock a specific shape regardless of count. See
   * [`forms.md → Auto-derivation cascade`](../../docs/ui/patterns/forms.md#auto-derivation-cascade).
   */
  mode?: SelectMode
  /**
   * Mobile sheet height: `'short'` (33 %), `'medium'` (60 %), or
   * `'auto'` (sized by option count). Only applies when `mode`
   * resolves to `'dropdown'` on the phone tier.
   */
  sheetSize?: SelectSheetSize
  placeholder?: string
  /**
   * Field label. On phone (when `mode` resolves to `'dropdown'`),
   * surfaces as the visible title at the top of the bottom Sheet —
   * the Sheet is the entire editing context and any surrounding
   * FormRow label isn't visible inside it. Optional; falls through
   * to no title when omitted. Desktop / tablet popover doesn't
   * render the label (the surrounding FormRow handles that).
   */
  label?: string
  disabled?: boolean
  className?: string

  /**
   * Custom row renderer for `dropdown` mode. When provided, replaces
   * the default `<ItemText />` rendering for each option — used by
   * compounds (e.g. `CalendarPicker`) that need rich two-line rows
   * with chips, sub-line tier paths, etc. Selection indicator
   * automatically flips to the row's left edge so caller-supplied
   * trailing content (chips, badges) doesn't clash. Ignored for
   * `segment` and `radio` modes.
   */
  renderRow?: (args: { option: SelectOption; selected: boolean }) => React.ReactNode

  /**
   * Custom trigger content for `dropdown` mode. Replaces the
   * default `<Value placeholder=… />` rendering. Used by compounds
   * that need to display the selected option with auxiliary content
   * (chips, badges, secondary labels). The chevron remains at the
   * right edge regardless. Ignored for `segment` and `radio` modes.
   */
  renderTrigger?: (args: {
    selected: SelectOption | undefined
    placeholder: string | undefined
  }) => React.ReactNode

  /**
   * Optional fixed action surfaced at the bottom of the popover /
   * sheet, after the option list. Closes the dropdown on press in
   * addition to firing the caller's handler. Used for
   * `Manage in Vault →` style escape hatches that route the user
   * out of selection. Ignored for `segment` and `radio` modes.
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

// Bucket options into ordered groups, preserving first-seen order
// of group names and option order within each group. Ungrouped
// options collect under a `null` key and surface without a Label
// in the rendered list.
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
      <Trigger className={className} disabled={disabled}>
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
        // Rich custom rows are roughly twice the height of label-only
        // rows; the default `max-h-52` (208 px) clips at ~3 rows on
        // the popover. Lift to `max-h-96` (384 px) when `renderRow`
        // is set. **Web only** — native phone takes the Sheet branch
        // where `sheetSize` controls height; passing a max-h here
        // would cap the sheet panel below `sheetSize` and leave a
        // visible gap below it on the screen.
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
