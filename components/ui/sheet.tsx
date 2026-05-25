import * as DialogPrimitive from '@rn-primitives/dialog'
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ComponentProps,
} from 'react'
import {
  KeyboardAvoidingView,
  Platform,
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
  SlideInRight,
  SlideOutDown,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'
import { runOnJS } from 'react-native-worklets'

import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type AutoFocusHandler = (event: Event) => void

type SheetA11yValue = {
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
}

const SheetA11yContext = createContext<SheetA11yValue | null>(null)

function useSheetA11y(): SheetA11yValue {
  const value = useContext(SheetA11yContext)
  if (!value) {
    throw new Error('Sheet subcomponents must be rendered inside <Sheet>.')
  }
  return value
}

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : Fragment

type SheetAnchor = 'bottom' | 'right'
type SheetSize = 'short' | 'medium' | 'tall' | 'auto'

// `auto` opts out of a fixed height — content drives the panel, capped at 95vh.
const BOTTOM_HEIGHT_CLASS_WEB: Record<SheetSize, string> = {
  short: 'h-[33vh]',
  medium: 'h-[60vh]',
  tall: 'h-[95vh]',
  auto: 'max-h-[95vh]',
}

const BOTTOM_HEIGHT_PCT: Record<Exclude<SheetSize, 'auto'>, `${number}%`> = {
  short: '33%',
  medium: '60%',
  tall: '95%',
}

const RIGHT_WIDTH_PX = 440
const SAFE_AREA_GAP_PX = 8
const DRAG_DISMISS_THRESHOLD_PX = 100

const FLEX_1_STYLE: ViewStyle = { flex: 1 }

function getNativePanelStyle(
  anchor: SheetAnchor,
  size: SheetSize,
  insetTop: number,
  screenHeight: number,
): ViewStyle {
  // Cap the panel so it never extends above the OS status bar / notch.
  const maxHeight = Math.max(screenHeight - insetTop - SAFE_AREA_GAP_PX, 0)
  if (anchor === 'bottom') {
    const base: ViewStyle = {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight,
    }
    if (size === 'auto') return base
    return { ...base, height: BOTTOM_HEIGHT_PCT[size] }
  }
  return {
    position: 'absolute',
    top: insetTop + SAFE_AREA_GAP_PX,
    bottom: 0,
    right: 0,
    width: RIGHT_WIDTH_PX,
  }
}

type LayoutAnimation = ComponentProps<typeof NativeOnlyAnimatedView>['entering']

type SheetPanelProps = ComponentProps<typeof DialogPrimitive.Content> & {
  isBottom: boolean
  size: SheetSize
  slideEnter: LayoutAnimation
  slideExit: LayoutAnimation
  nativePanelStyle: ViewStyle
  avoidKeyboard: boolean
  // ARIA values are captured by the parent (SheetContent) before the rn-primitives
  // Portal and passed in as props — rn-primitives' native Portal doesn't propagate
  // arbitrary React contexts, so calling useSheetA11y() inside the portaled tree fails.
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
}

function SheetPanel({
  className,
  children,
  isBottom,
  size,
  slideEnter,
  slideExit,
  nativePanelStyle,
  avoidKeyboard,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...contentProps
}: SheetPanelProps) {
  const { onOpenChange } = DialogPrimitive.useRootContext()
  const { height: screenHeight } = useWindowDimensions()

  const dragOffset = useSharedValue(0)
  const animatedDragStyle = useAnimatedStyle(
    () =>
      isBottom
        ? { transform: [{ translateY: dragOffset.value }] }
        : { transform: [{ translateX: dragOffset.value }] },
    [isBottom],
  )
  const closeFromGesture = useCallback(() => onOpenChange(false), [onOpenChange])
  const panGesture = useMemo(() => {
    const base = Gesture.Pan()
    const directional = isBottom
      ? base.activeOffsetY([10, Number.POSITIVE_INFINITY])
      : base.activeOffsetX([10, Number.POSITIVE_INFINITY])
    return directional
      .onUpdate((event) => {
        'worklet'
        const delta = isBottom ? event.translationY : event.translationX
        dragOffset.value = Math.max(0, delta)
      })
      .onEnd((event) => {
        'worklet'
        const delta = isBottom ? event.translationY : event.translationX
        if (delta > DRAG_DISMISS_THRESHOLD_PX) {
          const target = (isBottom ? screenHeight : screenHeight) + 200
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
  }, [isBottom, dragOffset, closeFromGesture, screenHeight])

  const handleVisible = <View className="mx-auto h-1 w-10 rounded-full bg-fg-muted opacity-40" />
  const handle = isBottom ? (
    Platform.OS === 'web' ? (
      <View className="mb-4">{handleVisible}</View>
    ) : (
      <GestureDetector gesture={panGesture}>
        <View className="-mx-6 -mt-6 mb-2 items-center px-6 py-6">{handleVisible}</View>
      </GestureDetector>
    )
  ) : null

  // aria-describedby and onCloseAutoFocus are web-only — absent from the native API surface.
  const webExtras =
    Platform.OS === 'web'
      ? ({ 'aria-describedby': ariaDescribedBy, onCloseAutoFocus } as object)
      : null

  // RN's built-in KeyboardAvoidingView — `react-native-keyboard-controller` is the
  // spec target but needs an Expo config plugin + dev-client rebuild; followups.md.
  const body = avoidKeyboard ? (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={FLEX_1_STYLE}
    >
      {children}
    </KeyboardAvoidingView>
  ) : (
    children
  )

  return (
    <NativeOnlyAnimatedView
      entering={slideEnter}
      exiting={slideExit}
      style={Platform.select({ native: [nativePanelStyle, animatedDragStyle] })}
    >
      <TextClassContext.Provider value="text-fg-primary">
        <DialogPrimitive.Content
          role="dialog"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          onOpenAutoFocus={onOpenAutoFocus}
          {...webExtras}
          className={cn(
            'border border-border-strong bg-bg-overlay p-6 outline-none',
            Platform.select({
              web: cn(
                'absolute z-50',
                isBottom ? 'animate-slide-in-from-bottom' : 'animate-slide-in-from-right',
                isBottom
                  ? cn(
                      'bottom-0 left-0 right-0 rounded-t-lg border-b-0',
                      BOTTOM_HEIGHT_CLASS_WEB[size],
                    )
                  : 'bottom-0 right-0 top-0 w-[440px] rounded-l-lg border-r-0',
              ),
              default: cn(
                'flex-1',
                isBottom ? 'rounded-t-lg border-b-0' : 'rounded-l-lg border-r-0',
              ),
            }),
            className,
          )}
          onStartShouldSetResponder={() => false}
          {...contentProps}
        >
          {handle}
          {body}
        </DialogPrimitive.Content>
      </TextClassContext.Provider>
    </NativeOnlyAnimatedView>
  )
}

type SheetContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  anchor?: SheetAnchor
  size?: SheetSize
  portalHost?: string
  title?: string
  avoidKeyboard?: boolean
}

function SheetContent({
  className,
  anchor = 'bottom',
  size = 'medium',
  portalHost,
  title = 'Sheet',
  avoidKeyboard,
  children,
  ...props
}: SheetContentProps) {
  const isBottom = anchor === 'bottom'
  const slideEnter = isBottom ? SlideInDown.duration(250) : SlideInRight.duration(250)
  const slideExit = isBottom ? SlideOutDown : SlideOutRight
  const insets = useSafeAreaInsets()
  const { height: screenHeight } = useWindowDimensions()
  const nativePanelStyle = getNativePanelStyle(anchor, size, insets.top, screenHeight)
  // Default true for bottom; ignored entirely for right (desktop, no soft keyboard).
  const effectiveAvoidKeyboard = isBottom && (avoidKeyboard ?? true)
  // Resolved BEFORE the portal — rn-primitives' native Portal drops custom contexts.
  const { ariaLabel, ariaLabelledBy, ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus } =
    useSheetA11y()

  return (
    <DialogPrimitive.Portal hostName={portalHost}>
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
            <DialogPrimitive.Overlay
              className={cn(
                'absolute inset-0 bg-black/40',
                // Web fade-in — native uses reanimated FadeIn.
                Platform.select({ web: 'animate-fade-in' }),
              )}
              style={Platform.select({ native: StyleSheet.absoluteFill })}
            />
          </NativeOnlyAnimatedView>
          <SheetPanel
            isBottom={isBottom}
            size={size}
            slideEnter={slideEnter}
            slideExit={slideExit}
            nativePanelStyle={nativePanelStyle}
            avoidKeyboard={effectiveAvoidKeyboard}
            ariaLabel={ariaLabel}
            ariaLabelledBy={ariaLabelledBy}
            ariaDescribedBy={ariaDescribedBy}
            onOpenAutoFocus={onOpenAutoFocus}
            onCloseAutoFocus={onCloseAutoFocus}
            className={className}
            {...props}
          >
            {Platform.OS === 'web' ? (
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
            ) : null}
            {children}
          </SheetPanel>
        </View>
      </FullWindowOverlay>
    </DialogPrimitive.Portal>
  )
}

type SheetProps = ComponentProps<typeof DialogPrimitive.Root> & SheetA11yValue

function Sheet({
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  onOpenAutoFocus,
  onCloseAutoFocus,
  children,
  ...rootProps
}: SheetProps) {
  useEffect(() => {
    if (__DEV__ && ariaLabel === undefined && ariaLabelledBy === undefined) {
      console.warn(
        'Sheet: pass `ariaLabel` or `ariaLabelledBy` for an accessible name, or `ariaLabel=""` to opt out.',
      )
    }
  }, [ariaLabel, ariaLabelledBy])

  const value = useMemo<SheetA11yValue>(
    () => ({ ariaLabel, ariaLabelledBy, ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus }),
    [ariaLabel, ariaLabelledBy, ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus],
  )

  return (
    <SheetA11yContext.Provider value={value}>
      <DialogPrimitive.Root {...rootProps}>{children}</DialogPrimitive.Root>
    </SheetA11yContext.Provider>
  )
}

function SheetTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  const { open } = DialogPrimitive.useRootContext()
  // aria-haspopup is a web-only DOM attribute; RN's prop types don't model it.
  const webProps =
    Platform.OS === 'web'
      ? ({ 'aria-haspopup': 'dialog' as const, 'aria-expanded': open } as object)
      : null
  return <DialogPrimitive.Trigger {...webProps} {...props} />
}

export { Sheet, SheetContent, SheetTrigger }
export type { SheetAnchor, SheetSize }
