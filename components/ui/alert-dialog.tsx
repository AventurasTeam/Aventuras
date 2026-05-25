import * as AlertDialogPrimitive from '@rn-primitives/alert-dialog'
import { Fragment, type ComponentProps, type ReactNode } from 'react'
import { Platform, View, type ViewProps } from 'react-native'
import { FadeIn, FadeOut } from 'react-native-reanimated'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { buttonTextVariants, buttonVariants } from '@/components/ui/button'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : Fragment

function AlertDialogOverlay({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof AlertDialogPrimitive.Overlay>, 'asChild'> & {
  children?: ReactNode
}) {
  return (
    <FullWindowOverlay>
      <AlertDialogPrimitive.Overlay
        className={cn(
          'absolute bottom-0 left-0 right-0 top-0 z-50 flex items-center justify-center bg-black/50 p-2',
          Platform.select({ web: 'fixed animate-fade-in' }),
          className,
        )}
        {...props}
      >
        <NativeOnlyAnimatedView
          entering={FadeIn.duration(200).delay(50)}
          exiting={FadeOut.duration(150)}
        >
          <>{children}</>
        </NativeOnlyAnimatedView>
      </AlertDialogPrimitive.Overlay>
    </FullWindowOverlay>
  )
}

function AlertDialogContent({
  className,
  portalHost,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content> & {
  portalHost?: string
}) {
  return (
    <AlertDialogPortal hostName={portalHost}>
      <AlertDialogOverlay>
        <AlertDialogPrimitive.Content
          className={cn(
            'z-50 flex w-full max-w-[calc(100%-2rem)] flex-col gap-4 rounded-lg border border-border bg-bg-overlay p-6 shadow-lg shadow-black/5 sm:max-w-lg',
            Platform.select({ web: 'animate-fade-in' }),
            className,
          )}
          {...props}
        />
      </AlertDialogOverlay>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: ViewProps) {
  return (
    <TextClassContext.Provider value="text-left">
      <View className={cn('flex flex-col gap-2', className)} {...props} />
    </TextClassContext.Provider>
  )
}

function AlertDialogFooter({ className, ...props }: ViewProps) {
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

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('text-lg font-semibold text-fg-primary', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-sm text-fg-muted', className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  asChild,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  if (asChild) {
    return <AlertDialogPrimitive.Action asChild {...props} />
  }
  return (
    <TextClassContext.Provider value={buttonTextVariants({ className })}>
      <AlertDialogPrimitive.Action className={cn(buttonVariants(), className)} {...props} />
    </TextClassContext.Provider>
  )
}

function AlertDialogCancel({
  className,
  asChild,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  if (asChild) {
    return <AlertDialogPrimitive.Cancel asChild {...props} />
  }
  return (
    <TextClassContext.Provider value={buttonTextVariants({ className, variant: 'secondary' })}>
      <AlertDialogPrimitive.Cancel
        className={cn(buttonVariants({ variant: 'secondary' }), className)}
        {...props}
      />
    </TextClassContext.Provider>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
