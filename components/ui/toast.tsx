// Toast primitive — top-anchored, auto-dismissing notification
// surface. See [`docs/ui/patterns/toast.md`](../../docs/ui/patterns/toast.md)
// for the full contract (placement, severity, queue, dismiss).
//
// Mount <Toaster /> once at the app root; fire toasts via the
// imperative API in `lib/toast`.
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { toastStore, type ToastItem, type ToastSeverity } from '@/lib/toast/store'
import { cn } from '@/lib/utils'
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react-native'
import * as React from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import {
  FadeOut,
  LinearTransition,
  SlideInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { runOnJS } from 'react-native-worklets'
import { NativeOnlyAnimatedView } from './native-only-animated-view'

const DURATION_MS: Record<ToastSeverity, number> = {
  success: 3000,
  info: 5000,
  error: 7000,
}

const ARIA_LIVE: Record<ToastSeverity, 'polite' | 'assertive'> = {
  success: 'polite',
  info: 'polite',
  error: 'assertive',
}

const ICON_BY_SEVERITY = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const

const BG_BY_SEVERITY: Record<ToastSeverity, string> = {
  success: 'bg-success',
  error: 'bg-danger',
  info: 'bg-info',
}

const FG_BY_SEVERITY: Record<ToastSeverity, string> = {
  success: 'text-success-fg',
  error: 'text-danger-fg',
  info: 'text-info-fg',
}

const DRAG_DISMISS_THRESHOLD_PX = 50

type ToastProps = {
  item: ToastItem
}

function Toast({ item }: ToastProps) {
  const dismiss = React.useCallback(() => toastStore.dismiss(item.id), [item.id])

  // Auto-dismiss timer. Cleared on manual dismiss / unmount.
  React.useEffect(() => {
    const timer = setTimeout(dismiss, DURATION_MS[item.severity])
    return () => clearTimeout(timer)
  }, [dismiss, item.severity])

  // Native swipe-up gesture — pan with dismiss threshold + spring
  // back below it. Reuses the Sheet primitive's drag pattern.
  const dragOffset = useSharedValue(0)
  const animatedDragStyle = useAnimatedStyle(
    () => ({ transform: [{ translateY: dragOffset.value }] }),
    [],
  )
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          'worklet'
          // Only follow upward drags (negative translationY).
          dragOffset.value = Math.min(0, event.translationY)
        })
        .onEnd((event) => {
          'worklet'
          if (event.translationY < -DRAG_DISMISS_THRESHOLD_PX) {
            dragOffset.value = withTiming(-200, { duration: 150 }, (finished?: boolean) => {
              'worklet'
              if (finished) runOnJS(dismiss)()
            })
            return
          }
          dragOffset.value = withSpring(0, {
            damping: 18,
            stiffness: 220,
            overshootClamping: true,
          })
        }),
    [dragOffset, dismiss],
  )

  const SeverityIcon = ICON_BY_SEVERITY[item.severity]
  const bg = BG_BY_SEVERITY[item.severity]
  const fg = FG_BY_SEVERITY[item.severity]

  const inner = (
    <NativeOnlyAnimatedView
      entering={SlideInUp.duration(250)}
      exiting={FadeOut.duration(200)}
      layout={LinearTransition.duration(200)}
      style={Platform.select({ native: animatedDragStyle as ViewStyle })}
    >
      <View
        // role="status" + aria-live route the announcement through
        // assistive tech; on native, RN announces via accessible
        // description, so the visible text suffices.
        aria-live={ARIA_LIVE[item.severity]}
        role="status"
        className={cn(
          'flex-row items-center gap-3 rounded-md px-4 py-3 shadow-lg shadow-black/10',
          bg,
          Platform.select({ web: 'animate-slide-in-from-top' }),
        )}
      >
        <Icon as={SeverityIcon} size="sm" className={cn('shrink-0', fg)} />
        <Text size="sm" className={cn('flex-1', fg)}>
          {item.message}
        </Text>
        <Pressable
          accessibilityRole="button"
          aria-label="Dismiss"
          onPress={dismiss}
          hitSlop={8}
          className={cn(
            'shrink-0 rounded-full p-1',
            Platform.select({
              web: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            }),
          )}
        >
          <Icon as={X} size="sm" className={fg} />
        </Pressable>
      </View>
    </NativeOnlyAnimatedView>
  )

  return Platform.OS === 'web' ? (
    inner
  ) : (
    <GestureDetector gesture={panGesture}>{inner}</GestureDetector>
  )
}

/**
 * Mount once at the app root. Subscribes to the toast store and
 * renders the visible queue, top-center, above all surfaces.
 */
export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([])
  React.useEffect(() => toastStore.subscribe(setItems), [])

  if (items.length === 0) return null

  return (
    <View
      // Top-center, full-width-with-gutters on phone, max-w-[400px]
      // on desktop. z-100 sits above Sheet (z-50) and AlertDialog
      // (z-50). pointerEvents="box-none" so the wrapper doesn't
      // block clicks below it.
      pointerEvents="box-none"
      className={cn(
        'absolute left-0 right-0 top-4 z-[100] mx-4 items-center gap-2',
        Platform.select({ web: 'fixed' }),
      )}
    >
      <View pointerEvents="box-none" className="w-full max-w-[400px] gap-2">
        {items.map((item) => (
          <Toast key={item.id} item={item} />
        ))}
      </View>
    </View>
  )
}

export { Toast }
export type { ToastProps }
