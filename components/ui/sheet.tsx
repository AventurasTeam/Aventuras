// Aventuras Sheet primitive — built directly from @rn-primitives/dialog.
//
// react-native-reusables doesn't ship a Sheet component (verified via CLI),
// so this primitive is built from the rn-primitives layer using the same
// slot-first reshape discipline as the Popover scaffold per
// docs/ui/components.md. Implements the contract in patterns/overlays.md.
//
// What this primitive owns vs. delegates:
//
// - DELEGATES to @rn-primitives/dialog: open/close lifecycle, controlled
//   state (open / defaultOpen / onOpenChange), focus trap, scrim dismissal,
//   Portal hosting, Trigger composition.
// - OWNS: anchor (bottom / right) presentation, size scale (short / medium /
//   tall) for bottom anchor, drag-handle visual, drag-to-dismiss gesture
//   on native, slot-token wiring (bg-overlay, border-strong, scrim color,
//   radii on the open edge, padding), native slide animation via reanimated.
//
// What's NOT here yet:
//
// - **Web entry / exit animations.** Match Popover's gap; pair with the
//   post-phase-2 animation pass. Sheet appears instantly on Electron until
//   then.
// - **Per-theme scrim color.** Uses `bg-black/40` matching the light-mode
//   value; dark-mode would prefer 0.6 but Aventuras doesn't currently ship
//   a `--scrim` slot per the parked decision in
//   docs/ui/foundations/spacing.md.
//
// Native layout note: an outer absoluteFill wrapper inside the Portal is
// required so the absolute scrim and panel have a sized positioned
// ancestor on RN (the Animated.View wrappers alone collapse to 0×0
// because their absolute children are out of layout flow). The wrapper
// uses `pointerEvents="box-none"` so taps fall through to the scrim and
// panel children rather than being captured by the empty wrapper.
//
// Drag state lives in the SheetPanel sub-component INSIDE the Portal.
// SheetContent itself is a sibling of SheetTrigger and never unmounts
// between opens; only the Portal contents do. Putting `useSharedValue`
// in SheetPanel guarantees a fresh dragOffset per open — no persistence
// across open/close cycles, no leaked off-screen translation breaking
// the entry layout animation on reopen.

import * as DialogPrimitive from '@rn-primitives/dialog'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import * as React from 'react'
import { Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
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
import { runOnJS } from 'react-native-worklets'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment

type SheetAnchor = 'bottom' | 'right'
type SheetSize = 'short' | 'medium' | 'tall'

const BOTTOM_HEIGHT_CLASS_WEB: Record<SheetSize, string> = {
  short: 'h-[33vh]',
  medium: 'h-[60vh]',
  tall: 'h-[95vh]',
}

const BOTTOM_HEIGHT_PCT: Record<SheetSize, `${number}%`> = {
  short: '33%',
  medium: '60%',
  tall: '95%',
}

const RIGHT_WIDTH_PX = 440
const SAFE_AREA_GAP_PX = 8
const DRAG_DISMISS_THRESHOLD_PX = 100

function getNativePanelStyle(
  anchor: SheetAnchor,
  size: SheetSize,
  insetTop: number,
  screenHeight: number,
): ViewStyle {
  // Cap the panel so it never extends above the OS status bar / notch.
  // Aventuras has no top-bar chrome yet, so without this clamp the dev
  // pages render the sheet as if the screen extends edge-to-edge.
  const maxHeight = Math.max(screenHeight - insetTop - SAFE_AREA_GAP_PX, 0)
  if (anchor === 'bottom') {
    return {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: BOTTOM_HEIGHT_PCT[size],
      maxHeight,
    }
  }
  return {
    position: 'absolute',
    top: insetTop + SAFE_AREA_GAP_PX,
    bottom: 0,
    right: 0,
    width: RIGHT_WIDTH_PX,
  }
}

type LayoutAnimation = React.ComponentProps<typeof NativeOnlyAnimatedView>['entering']

type SheetPanelProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  isBottom: boolean
  size: SheetSize
  slideEnter: LayoutAnimation
  slideExit: LayoutAnimation
  nativePanelStyle: ViewStyle
}

function SheetPanel({
  className,
  children,
  isBottom,
  size,
  slideEnter,
  slideExit,
  nativePanelStyle,
  ...contentProps
}: SheetPanelProps) {
  const { onOpenChange } = DialogPrimitive.useRootContext()
  const { height: screenHeight } = useWindowDimensions()

  // Lives only while the panel is open: this component mounts when the
  // Dialog Portal renders and unmounts when it closes. Each open gives a
  // fresh dragOffset, so off-screen state from the previous drag-dismiss
  // can't leak into the next entry animation.
  const dragOffset = useSharedValue(0)
  // Explicit dep array: the worklets babel plugin auto-injects this
  // on native (RN babel pipeline) but Storybook web's Vite bundler
  // doesn't run that plugin, so we declare it manually.
  const animatedDragStyle = useAnimatedStyle(
    () =>
      isBottom
        ? { transform: [{ translateY: dragOffset.value }] }
        : { transform: [{ translateX: dragOffset.value }] },
    [isBottom],
  )
  const closeFromGesture = React.useCallback(() => onOpenChange(false), [onOpenChange])
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          'worklet'
          const delta = isBottom ? event.translationY : event.translationX
          // Clamp to the dismiss direction; spring resistance for the wrong
          // direction is overkill for v1.
          dragOffset.value = Math.max(0, delta)
        })
        .onEnd((event) => {
          'worklet'
          const delta = isBottom ? event.translationY : event.translationX
          if (delta > DRAG_DISMISS_THRESHOLD_PX) {
            // Continue the gesture motion smoothly off-screen, then close
            // once the panel is visually gone.
            const target = (isBottom ? screenHeight : screenHeight) + 200
            dragOffset.value = withTiming(target, { duration: 180 }, (finished?: boolean) => {
              'worklet'
              if (finished) runOnJS(closeFromGesture)()
            })
            return
          }
          // overshootClamping prevents the spring from oscillating past 0,
          // which would raise the panel above its rest position and expose
          // the system nav-bar area below it.
          dragOffset.value = withSpring(0, {
            damping: 18,
            stiffness: 220,
            overshootClamping: true,
          })
        }),
    [isBottom, dragOffset, closeFromGesture, screenHeight],
  )

  const inner = (
    <NativeOnlyAnimatedView
      entering={slideEnter}
      exiting={slideExit}
      style={Platform.select({ native: [nativePanelStyle, animatedDragStyle] })}
    >
      <TextClassContext.Provider value="text-fg-primary">
        <DialogPrimitive.Content
          className={cn(
            'border border-border-strong bg-bg-overlay p-6 outline-none',
            Platform.select({
              web: cn(
                'absolute z-50',
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
          {...contentProps}
        >
          {isBottom ? (
            <View className="mx-auto mb-4 h-1 w-10 rounded-full bg-fg-muted opacity-40" />
          ) : null}
          {children}
        </DialogPrimitive.Content>
      </TextClassContext.Provider>
    </NativeOnlyAnimatedView>
  )

  return Platform.OS === 'web' ? (
    inner
  ) : (
    <GestureDetector gesture={panGesture}>{inner}</GestureDetector>
  )
}

function SheetContent({
  className,
  anchor = 'bottom',
  size = 'medium',
  portalHost,
  title = 'Sheet',
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  anchor?: SheetAnchor
  size?: SheetSize
  portalHost?: string
  // Accessible name for the sheet. Defaults to a generic "Sheet"
  // and renders inside a sr-only DialogPrimitive.Title on web —
  // radix's DialogContent demands a Title for screen readers
  // (otherwise emits "DialogContent requires a DialogTitle"). On
  // native the warning doesn't apply; the Title is omitted there.
  title?: string
}) {
  const isBottom = anchor === 'bottom'
  const slideEnter = isBottom ? SlideInDown.duration(250) : SlideInRight.duration(250)
  const slideExit = isBottom ? SlideOutDown : SlideOutRight
  const insets = useSafeAreaInsets()
  const { height: screenHeight } = useWindowDimensions()
  const nativePanelStyle = getNativePanelStyle(anchor, size, insets.top, screenHeight)

  return (
    <DialogPrimitive.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <View style={Platform.select({ native: StyleSheet.absoluteFill })} pointerEvents="box-none">
          <NativeOnlyAnimatedView
            entering={FadeIn.duration(200)}
            exiting={FadeOut}
            style={Platform.select({ native: StyleSheet.absoluteFill })}
          >
            <DialogPrimitive.Overlay
              className="absolute inset-0 bg-black/40"
              style={Platform.select({ native: StyleSheet.absoluteFill })}
            />
          </NativeOnlyAnimatedView>
          <SheetPanel
            isBottom={isBottom}
            size={size}
            slideEnter={slideEnter}
            slideExit={slideExit}
            nativePanelStyle={nativePanelStyle}
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

export { Sheet, SheetContent, SheetTrigger }
export type { SheetAnchor, SheetSize }
