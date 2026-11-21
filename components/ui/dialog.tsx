import * as DialogPrimitive from '@rn-primitives/dialog'
import { X } from 'lucide-react-native'
import {
  Fragment,
  useEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import { Platform, ScrollView, useWindowDimensions, View, type ViewProps } from 'react-native'
import { FadeIn, FadeOut } from 'react-native-reanimated'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { FocusOrigin, useDialogFocusReturn } from '@/components/ui/focus-return'
import { Icon } from '@/components/ui/icon'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { useScrimClass } from '@/components/ui/scrim'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { useRegisteredOverlay } from '@/lib/stores'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : Fragment

function DialogOverlay({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Overlay>, 'asChild'> & {
  children?: ReactNode
}) {
  const scrimClass = useScrimClass()
  return (
    <FullWindowOverlay>
      <DialogPrimitive.Overlay
        className={cn(
          'absolute bottom-0 left-0 right-0 top-0 z-50 flex items-center justify-center p-2',
          scrimClass,
          Platform.select({
            web: 'fixed animate-fade-in cursor-default [&>*]:cursor-auto',
          }),
          className,
        )}
        {...props}
        asChild={Platform.OS !== 'web'}
      >
        <NativeOnlyAnimatedView
          entering={FadeIn.duration(200).delay(50)}
          exiting={FadeOut.duration(150)}
        >
          <>{children}</>
        </NativeOnlyAnimatedView>
      </DialogPrimitive.Overlay>
    </FullWindowOverlay>
  )
}

// The overlay is `position: fixed` and never scrolls, so a panel taller than the
// viewport escapes past both edges — header above it, actions below it, neither
// reachable. Cap the panel and scroll inside it instead.
const MAX_HEIGHT_RATIO = 0.9

function DialogContent({
  className,
  portalHost,
  hideCloseButton,
  scrollable = true,
  busy = false,
  returnFocusTo,
  onOpenAutoFocus,
  onCloseAutoFocus,
  style,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'ref'> & {
  portalHost?: string
  /** Where focus goes as it closes, ahead of what held focus when it opened (overlays.md → Close focus). */
  returnFocusTo?: RefObject<unknown>
  /** Hosts whose every state carries an explicit affordance can drop the ×. */
  hideCloseButton?: boolean
  /**
   * Opt out when the dialog already owns a bounded scroll region with chrome
   * around it: two scrollables nested fight for the gesture on Android. The
   * height cap applies either way.
   */
  scrollable?: boolean
  /** Its actions are disabling (a save in flight, a gate): focus stays in the dialog. */
  busy?: boolean
}) {
  // Keyed on `open` like AlertDialogContent: the reader's undo / End keys and the Actions
  // menu stand down only for a registered overlay.
  const { open } = DialogPrimitive.useRootContext()
  useRegisteredOverlay(open)
  const contentRef = useRef<View>(null)
  const focusReturn = useDialogFocusReturn({ returnFocusTo, onOpenAutoFocus, onCloseAutoFocus })
  // Chromium blurs a button the moment it disables (lessons-learned/rnweb-disabled-under-focus-blurs.md).
  useEffect(() => {
    if (Platform.OS !== 'web' || !open || !busy) return
    // The ref lands on the styled View inside Radix's focusable role=dialog element.
    const dialog = (contentRef.current as unknown as HTMLElement | null)?.closest<HTMLElement>(
      '[role="dialog"]',
    )
    if (dialog != null && !dialog.contains(document.activeElement)) dialog.focus()
  }, [open, busy])
  const { height } = useWindowDimensions()
  return (
    <DialogPortal hostName={portalHost}>
      <DialogOverlay>
        <DialogPrimitive.Content
          ref={contentRef}
          // A width override needs the `sm:` variant (`sm:max-w-xl`): tailwind-merge replaces
          // only the same variant, so a bare `max-w-*` leaves the 32rem cap from `sm` up.
          className={cn(
            'relative z-50 mx-auto flex w-full max-w-[calc(100%-2rem)] flex-col rounded-lg border border-border bg-bg-overlay p-6 shadow-lg shadow-black/5 sm:max-w-lg',
            !scrollable && 'gap-4',
            Platform.select({ web: 'animate-fade-in' }),
            className,
          )}
          style={[{ maxHeight: height * MAX_HEIGHT_RATIO }, style]}
          {...props}
          {...focusReturn}
          // The primitive claims the JS responder for every touch inside the
          // dialog (its guard against a close-on-press overlay). Our native
          // overlay is an Animated.View slot that ignores onPress, so the
          // guard protects nothing — and the claim races native scroll
          // interception on Android, making ScrollView gestures flaky to
          // start. Drop it.
          onStartShouldSetResponder={undefined}
        >
          <FocusOrigin />
          {scrollable ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              className="shrink"
              contentContainerClassName="gap-4"
            >
              {children}
            </ScrollView>
          ) : (
            <>{children}</>
          )}
          {hideCloseButton ? null : (
            <DialogPrimitive.Close
              className={cn(
                'absolute right-4 top-4 rounded opacity-70 active:bg-tint-press active:opacity-100',
                Platform.select({
                  web: 'outline-none transition-colors hover:bg-tint-hover hover:opacity-100 focus-visible:ring-2 focus-visible:ring-focus-ring',
                }),
              )}
              hitSlop={12}
            >
              <Icon as={X} className="size-4 shrink-0 text-fg-primary web:pointer-events-none" />
              <Text className="sr-only">{t('close')}</Text>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  hasCloseButton = true,
  ...props
}: ViewProps & { hasCloseButton?: boolean }) {
  // pr-8 keeps full-width titles clear of the absolutely-positioned ×; without
  // one it is just dead space on every title in the app.
  return (
    <View className={cn('flex flex-col gap-2', hasCloseButton && 'pr-8', className)} {...props} />
  )
}

function DialogFooter({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn(
        'flex flex-col-reverse gap-2',
        Platform.select({ web: 'sm:flex-row sm:justify-end' }),
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold text-fg-primary', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description className={cn('text-sm text-fg-muted', className)} {...props} />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
