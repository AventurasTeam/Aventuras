import * as PopoverPrimitive from '@rn-primitives/popover'
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from 'react'
import { Platform, StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native'
import { FadeIn, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type PopoverRole = 'dialog' | 'menu'
type AutoFocusHandler = (event: Event) => void

type PopoverA11yValue = {
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
  role: PopoverRole
  setRole: (role: PopoverRole) => void
}

const PopoverA11yContext = createContext<PopoverA11yValue | null>(null)

function usePopoverA11y(): PopoverA11yValue {
  const value = useContext(PopoverA11yContext)
  if (!value) {
    throw new Error('Popover subcomponents must be rendered inside <Popover>.')
  }
  return value
}

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : Fragment

type PopoverProps = ComponentProps<typeof PopoverPrimitive.Root> & {
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
}

function Popover({
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  onOpenAutoFocus,
  onCloseAutoFocus,
  children,
  ...rootProps
}: PopoverProps) {
  const [role, setRole] = useState<PopoverRole>('dialog')

  useEffect(() => {
    if (__DEV__ && ariaLabel === undefined && ariaLabelledBy === undefined) {
      // eslint-disable-next-line no-console -- __DEV__ a11y warning; must fire regardless of the diagnostics master gate, so the logger is the wrong channel.
      console.warn(
        'Popover: pass `ariaLabel` or `ariaLabelledBy` for an accessible name, or `ariaLabel=""` to opt out.',
      )
    }
  }, [ariaLabel, ariaLabelledBy])

  const value = useMemo<PopoverA11yValue>(
    () => ({
      ariaLabel,
      ariaLabelledBy,
      ariaDescribedBy,
      onOpenAutoFocus,
      onCloseAutoFocus,
      role,
      setRole,
    }),
    [ariaLabel, ariaLabelledBy, ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus, role],
  )

  return (
    <PopoverA11yContext.Provider value={value}>
      <PopoverPrimitive.Root {...rootProps}>{children}</PopoverPrimitive.Root>
    </PopoverA11yContext.Provider>
  )
}

function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const { role } = usePopoverA11y()
  // aria-haspopup is a web-only DOM attribute; RN's prop types don't model it.
  const webProps = Platform.OS === 'web' ? ({ 'aria-haspopup': role } as object) : null
  return <PopoverPrimitive.Trigger {...webProps} {...props} />
}

type PopoverContentProps = Omit<
  ComponentProps<typeof PopoverPrimitive.Content>,
  'accessibilityRole' | 'role'
> & {
  portalHost?: string
  accessibilityRole?: PopoverRole
}

const POPOVER_EDGE_GAP_PX = 8

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  portalHost,
  accessibilityRole = 'dialog',
  ...props
}: PopoverContentProps) {
  const { ariaLabel, ariaLabelledBy, ariaDescribedBy, onOpenAutoFocus, onCloseAutoFocus, setRole } =
    usePopoverA11y()

  useEffect(() => {
    setRole(accessibilityRole)
  }, [accessibilityRole, setRole])

  // aria-describedby and onCloseAutoFocus are web-only — absent from the native API surface.
  const webProps =
    Platform.OS === 'web'
      ? ({ 'aria-describedby': ariaDescribedBy, onCloseAutoFocus } as object)
      : null

  return (
    <PopoverPrimitive.Portal hostName={portalHost}>
      <FullWindowOverlay>
        {/* RN-Web Views are position:relative with z-index:0, so each is a stacking
            context that caps its popper below Dialog's z-50 whatever the content sets
            — lifting the overlay is the only thing that raises it
            (lessons-learned/rnweb-view-stacking-context.md). */}
        <PopoverPrimitive.Overlay
          style={
            Platform.OS === 'web'
              ? ({ zIndex: 100 } as ViewStyle)
              : (StyleSheet.absoluteFill as ViewStyle)
          }
        >
          <NativeOnlyAnimatedView entering={FadeIn.duration(200)} exiting={FadeOut}>
            <TextClassContext.Provider value="text-fg-primary">
              <NativeAwareContent
                align={align}
                sideOffset={sideOffset}
                role={accessibilityRole}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                onOpenAutoFocus={onOpenAutoFocus}
                {...webProps}
                className={cn(
                  'z-50 w-72 rounded-md border border-border bg-bg-overlay p-4 outline-none',
                  // Web fade-in — native uses reanimated FadeIn.
                  Platform.select({ web: 'animate-fade-in' }),
                  className,
                )}
                {...props}
              />
            </TextClassContext.Provider>
          </NativeOnlyAnimatedView>
        </PopoverPrimitive.Overlay>
      </FullWindowOverlay>
    </PopoverPrimitive.Portal>
  )
}

// Wraps PopoverPrimitive.Content with native-only screen-position awareness:
// flips above the trigger when there's more room up than down, and caps height
// to the larger of (space below, space above). rn-primitives/popover's built-in
// avoidCollisions only clamps top against the screen — it does NOT flip side
// nor cap content height, so tall content under a low trigger spills offscreen.
function NativeAwareContent(props: ComponentProps<typeof PopoverPrimitive.Content>) {
  const { triggerPosition } = PopoverPrimitive.useRootContext()
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const triggerY = triggerPosition?.pageY ?? 0
  const triggerHeight = triggerPosition?.height ?? 0
  const spaceBelow = Math.max(
    windowHeight - insets.bottom - (triggerY + triggerHeight) - POPOVER_EDGE_GAP_PX,
    0,
  )
  const spaceAbove = Math.max(triggerY - insets.top - POPOVER_EDGE_GAP_PX, 0)
  const flipUp = spaceAbove > spaceBelow
  const nativeMaxHeight = Math.floor(Math.max(spaceBelow, spaceAbove))

  const mergedStyle = useMemo<ViewStyle | undefined>(() => {
    if (Platform.OS === 'web') return props.style as ViewStyle | undefined
    return { maxHeight: nativeMaxHeight, ...(props.style as ViewStyle | undefined) }
  }, [nativeMaxHeight, props.style])

  return (
    <PopoverPrimitive.Content
      {...props}
      side={Platform.OS !== 'web' ? (flipUp ? 'top' : 'bottom') : props.side}
      style={mergedStyle}
    />
  )
}

export { Popover, PopoverContent, PopoverTrigger }
export type { PopoverRole }
