import { BottomSheetModal, BottomSheetTextInput, BottomSheetView } from '@gorhom/bottom-sheet'
import * as DialogPrimitive from '@rn-primitives/dialog'
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
} from 'react'
import {
  Platform,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
import { FadeIn, FadeOut, SlideInRight, SlideOutRight } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { InputComponentContext, type InputComponent } from '@/components/ui/input'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { dismissKeyboard } from '@/lib/keyboard'
import { useTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'

type AutoFocusHandler = (event: Event) => void

type SheetA11yValue = {
  ariaLabel?: string
  ariaLabelledBy?: string
  /** Right-anchor only — forwarded to the Radix dialog as aria-describedby on web. */
  ariaDescribedBy?: string
  /** Right-anchor only — forwarded to the Radix dialog's focus-on-open hook. */
  onOpenAutoFocus?: AutoFocusHandler
  /** Right-anchor only, web only — forwarded to the Radix dialog's focus-on-close hook. */
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

// Native-only swap: gorhom's BottomSheetTextInput feeds the sheet's
// keyboard-translate system, which is inert on web — and its blur handler
// calls TextInput.State.currentlyFocusedInput(), which react-native-web never
// implemented, so every blur of a sheet-hosted field on web throws.
// Cast: gorhom types its forwarded ref `TextInput | undefined` (it maps null
// to undefined); the instance is RN's TextInput, only the ref's empty channel
// differs.
const SheetInputComponent = (
  Platform.OS === 'web' ? TextInput : BottomSheetTextInput
) as InputComponent

type SheetAnchor = 'bottom' | 'right'
type SheetSize = 'short' | 'medium' | 'tall' | 'auto'

const RIGHT_WIDTH_PX = 440
const SAFE_AREA_GAP_PX = 8

// p-6 already pads the content; the inset is added on top of it so the padding
// reads the same above the nav bar as it does on a device without one.
const SHEET_PADDING_PX = 24

function safeBottomStyle(bottomInset: number): ViewStyle | undefined {
  return bottomInset > 0 ? { paddingBottom: SHEET_PADDING_PX + bottomInset } : undefined
}

const BOTTOM_SNAP_PCT: Record<Exclude<SheetSize, 'auto'>, `${number}%`> = {
  short: '33%',
  medium: '60%',
  tall: '95%',
}

type SheetContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  anchor?: SheetAnchor
  size?: SheetSize
  title?: string
  /** Bottom-anchor only — allows a pending action to block swipe dismissal. */
  enablePanDownToClose?: boolean
  /** Right-anchor only — names the rn-primitives Portal host to render into. */
  portalHost?: string
}

function SheetContent({ anchor = 'bottom', ...props }: SheetContentProps) {
  if (anchor === 'bottom') {
    return <BottomSheetContent {...props} />
  }
  return <RightSheetContent {...props} />
}

function BottomSheetContent({
  className,
  size = 'medium',
  title = 'Sheet',
  children,
  // Pulled out of the rest bag so it can be merged with the safe-area padding
  // below rather than spread over it — a caller's `style` would otherwise drop
  // the bottom inset and put the sheet's last controls under the nav bar.
  style,
  // portalHost is right-anchor only — the gorhom path uses BottomSheetModalProvider's portal.
  portalHost: _portalHost,
  enablePanDownToClose = true,
  ...contentProps
}: Omit<SheetContentProps, 'anchor'>) {
  const { open, onOpenChange } = DialogPrimitive.useRootContext()
  const { ariaLabel, ariaLabelledBy } = useSheetA11y()
  const { theme } = useTheme()
  const insets = useSafeAreaInsets()

  const sheetRef = useRef<BottomSheetModal>(null)
  // gorhom's dismiss() on an already-dismissed modal corrupts internal state
  // and subsequent present() becomes a silent no-op. Track actual modal state
  // so dismiss() is only called when the modal is presented.
  const isPresentedRef = useRef(false)
  // gorhom keeps a modal unmounted-while-presented alive until its dismiss
  // animation completes, then still fires onDismiss; that late callback must
  // not write the dead open state back through onOpenChange.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const present = () => {
      // Only claim presented at the moment we actually present, so an `open`
      // that flips back while we wait below can't leave dismiss() firing
      // against a modal that never opened.
      isPresentedRef.current = true
      sheetRef.current?.present()
    }

    // gorhom's BottomSheetModal must register with the provider's stack before
    // present() succeeds; that registration happens in the modal's own mount
    // effects, which run after this one. Defer to the next tick.
    const handle = setTimeout(() => {
      if (open && !isPresentedRef.current) {
        // gorhom's keyboard state is built purely from show/hide events
        // (useAnimatedKeyboard subscribes; it never reads Keyboard.metrics), so
        // it starts at height 0 and a sheet opened while the keyboard is
        // already up is never told about it — it lands underneath. Close the
        // keyboard first; focusing a field inside the sheet then fires a show
        // event it can see, which is the path that already works.
        if (Platform.OS !== 'web') {
          void dismissKeyboard().then(() => {
            if (!cancelled) present()
          })
          return
        }
        present()
      } else if (!open && isPresentedRef.current) {
        isPresentedRef.current = false
        sheetRef.current?.dismiss()
      }
    }, 0)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [open])

  const snapPoints = useMemo(() => {
    if (size === 'auto') return undefined
    return [BOTTOM_SNAP_PCT[size]]
  }, [size])

  // gorhom v5 defaults enableDynamicSizing=true and silently ignores snapPoints
  // when dynamic sizing is on. Derive from snapPoints presence.
  const enableDynamicSizing = snapPoints == null

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
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={enableDynamicSizing}
      enablePanDownToClose={enablePanDownToClose}
      // 'extend' resolves to the sheet's own tallest detent. Every size here has
      // exactly one ('auto' has none), so it never grows anything — it earns its
      // keep only on 'tall', which at 95% already clears the keyboard and just
      // reflows content inside height it was going to occupy. Shorter sheets need
      // 'interactive', which lifts by the keyboard height and keeps their resting size.
      keyboardBehavior={size === 'tall' ? 'extend' : 'interactive'}
      keyboardBlurBehavior="restore"
      // Explicitly 'adjustPan', which is also gorhom's default: 'adjustResize'
      // makes it zero out `heightWithinContainer` and wait for a container shrink
      // that never arrives under edge-to-edge, putting every sheet under the
      // keyboard. Verified on-device both ways; gorhom keeps translating itself.
      android_keyboardInputMode="adjustPan"
      backgroundStyle={backgroundStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      accessibilityLabel={ariaLabel ?? (ariaLabelledBy ? undefined : title)}
      onDismiss={() => {
        if (!isMountedRef.current) return
        isPresentedRef.current = false
        onOpenChange(false)
      }}
    >
      <TextClassContext.Provider value="text-fg-primary">
        {/* Swap Input's underlying TextInput with gorhom's keyboard-aware variant
            so focusing an Input inside a sheet triggers gorhom's translate-up
            behavior. Plain TextInput isn't tracked by the sheet's keyboard system. */}
        <InputComponentContext.Provider value={SheetInputComponent}>
          {/* size='auto' needs BottomSheetView for gorhom's intrinsic measurement
              (dynamic sizing measures BottomSheetView's content height). Fixed-detent
              sizes skip BottomSheetView because it captures vertical pan gestures and
              blocks nested scrollables (e.g. BottomSheetSectionList in
              SearchableOverlayList) from claiming them. */}
          {/* Edge-to-edge draws the sheet under the system navigation bar, so
              without this the last rows of a tall sheet sit behind it —
              unreachable, and a scrollable reports itself fully scrolled. */}
          {size === 'auto' ? (
            <BottomSheetView>
              <View
                className={cn('p-6', className)}
                {...(contentProps as ComponentProps<typeof View>)}
                style={[safeBottomStyle(insets.bottom), style]}
              >
                {children}
              </View>
            </BottomSheetView>
          ) : (
            <View
              className={cn('flex-1 p-6', className)}
              {...(contentProps as ComponentProps<typeof View>)}
              style={[safeBottomStyle(insets.bottom), style]}
            >
              {children}
            </View>
          )}
        </InputComponentContext.Provider>
      </TextClassContext.Provider>
    </BottomSheetModal>
  )
}

function RightSheetContent({
  className,
  portalHost,
  title = 'Sheet',
  children,
  enablePanDownToClose: _enablePanDownToClose,
  ...contentProps
}: Omit<SheetContentProps, 'anchor'>) {
  const insets = useSafeAreaInsets()
  const { height: screenHeight } = useWindowDimensions()
  const maxHeight = Math.max(screenHeight - insets.top - SAFE_AREA_GAP_PX, 0)
  const nativePanelStyle: ViewStyle = {
    position: 'absolute',
    top: insets.top + SAFE_AREA_GAP_PX,
    bottom: 0,
    right: 0,
    width: RIGHT_WIDTH_PX,
    maxHeight,
  }
  const { ariaLabel, ariaLabelledBy, ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus } =
    useSheetA11y()

  // aria-describedby and onCloseAutoFocus are web-only — absent from the native API surface.
  const webExtras =
    Platform.OS === 'web'
      ? ({ 'aria-describedby': ariaDescribedBy, onCloseAutoFocus } as object)
      : null

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
                Platform.select({ web: 'animate-fade-in' }),
              )}
              style={Platform.select({ native: StyleSheet.absoluteFill })}
            />
          </NativeOnlyAnimatedView>
          <NativeOnlyAnimatedView
            entering={SlideInRight.duration(250)}
            exiting={SlideOutRight}
            style={Platform.select({ native: nativePanelStyle })}
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
                    web: 'absolute bottom-0 right-0 top-0 z-50 w-[440px] animate-slide-in-from-right rounded-l-lg border-r-0',
                    default: 'flex-1 rounded-l-lg border-r-0',
                  }),
                  className,
                )}
                {...contentProps}
              >
                {Platform.OS === 'web' ? (
                  <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
                ) : null}
                {children}
              </DialogPrimitive.Content>
            </TextClassContext.Provider>
          </NativeOnlyAnimatedView>
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
      // eslint-disable-next-line no-console -- __DEV__ a11y warning; must fire regardless of the diagnostics master gate, so the logger is the wrong channel.
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
