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
import { Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { FadeIn, FadeOut, SlideInRight, SlideOutRight } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { InputComponentContext } from '@/components/ui/input'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
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

type SheetAnchor = 'bottom' | 'right'
type SheetSize = 'short' | 'medium' | 'tall' | 'auto'

const RIGHT_WIDTH_PX = 440
const SAFE_AREA_GAP_PX = 8

const BOTTOM_SNAP_PCT: Record<Exclude<SheetSize, 'auto'>, `${number}%`> = {
  short: '33%',
  medium: '60%',
  tall: '95%',
}

type SheetContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  anchor?: SheetAnchor
  size?: SheetSize
  title?: string
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
  // portalHost is right-anchor only — the gorhom path uses BottomSheetModalProvider's portal.
  portalHost: _portalHost,
  ...contentProps
}: Omit<SheetContentProps, 'anchor'>) {
  const { open, onOpenChange } = DialogPrimitive.useRootContext()
  const { ariaLabel, ariaLabelledBy } = useSheetA11y()
  const { theme } = useTheme()

  const sheetRef = useRef<BottomSheetModal>(null)
  // gorhom's dismiss() on an already-dismissed modal corrupts internal state
  // and subsequent present() becomes a silent no-op. Track actual modal state
  // so dismiss() is only called when the modal is presented.
  const isPresentedRef = useRef(false)

  useEffect(() => {
    // gorhom's BottomSheetModal must register with the provider's stack before
    // present() succeeds; that registration happens in the modal's own mount
    // effects, which run after this one. Defer to the next tick.
    const handle = setTimeout(() => {
      if (open && !isPresentedRef.current) {
        isPresentedRef.current = true
        sheetRef.current?.present()
      } else if (!open && isPresentedRef.current) {
        isPresentedRef.current = false
        sheetRef.current?.dismiss()
      }
    }, 0)
    return () => clearTimeout(handle)
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
      // 'interactive' (gorhom default) translates the sheet up by keyboard height,
      // overshooting the max detent for tall sheets. 'extend' snaps to the max
      // detent and lets the content reflow within — the right shape for picker /
      // search surfaces that are already at 95%.
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      backgroundStyle={backgroundStyle}
      handleIndicatorStyle={handleIndicatorStyle}
      accessibilityLabel={ariaLabel ?? (ariaLabelledBy ? undefined : title)}
      onDismiss={() => {
        isPresentedRef.current = false
        onOpenChange(false)
      }}
    >
      <TextClassContext.Provider value="text-fg-primary">
        {/* Swap Input's underlying TextInput with gorhom's keyboard-aware variant
            so focusing an Input inside a sheet triggers gorhom's translate-up
            behavior. Plain TextInput isn't tracked by the sheet's keyboard system. */}
        <InputComponentContext.Provider value={BottomSheetTextInput}>
          {/* size='auto' needs BottomSheetView for gorhom's intrinsic measurement
              (dynamic sizing measures BottomSheetView's content height). Fixed-detent
              sizes skip BottomSheetView because it captures vertical pan gestures and
              blocks nested scrollables (e.g. BottomSheetSectionList in
              SearchableOverlayList) from claiming them. */}
          {size === 'auto' ? (
            <BottomSheetView>
              <View
                className={cn('p-6', className)}
                {...(contentProps as ComponentProps<typeof View>)}
              >
                {children}
              </View>
            </BottomSheetView>
          ) : (
            <View
              className={cn('flex-1 p-6', className)}
              {...(contentProps as ComponentProps<typeof View>)}
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
