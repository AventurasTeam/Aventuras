import * as AlertDialogPrimitive from '@rn-primitives/alert-dialog'
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react'
import {
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native'
import { FadeIn, FadeOut } from 'react-native-reanimated'
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens'

import { buttonTextVariants, buttonVariants } from '@/components/ui/button'
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view'
import { TextClassContext } from '@/components/ui/text'
import { useRegisteredOverlay } from '@/lib/stores'
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

// The overlay is `position: fixed` and never scrolls, so a panel taller than the
// viewport escapes past both edges — title above it, actions below it, neither
// reachable. Cap the panel and scroll its body instead.
const MAX_HEIGHT_RATIO = 0.9

/**
 * Splits the actions row out of the scrolling body. A consent gate is answered by
 * its actions, so they stay pinned however long the body runs. Unlike Dialog, this
 * primitive can partition on its consumers' behalf: every one renders the footer as
 * a direct child (docs/ui/patterns/alert-dialog.md → Rich content via composition). A
 * footer returned from inside a body component is invisible here and scrolls with it.
 */
function partitionActions(children: ReactNode): { body: ReactNode[]; actions: ReactNode[] } {
  const body: ReactNode[] = []
  const actions: ReactNode[] = []
  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === AlertDialogFooter) actions.push(child)
    else body.push(child)
  }
  return { body, actions }
}

function AlertDialogContent({
  className,
  portalHost,
  style,
  children,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content> & {
  portalHost?: string
}) {
  // Keyed on `open`, not mount-scoped: the Portal unmounts its children while
  // closed, but this renders the Portal rather than living inside one, so it
  // stays mounted with the consumer for the life of the surface.
  const { open } = AlertDialogPrimitive.useRootContext()
  useRegisteredOverlay(open)
  const { height } = useWindowDimensions()
  const { body, actions } = partitionActions(children)
  return (
    <AlertDialogPortal hostName={portalHost}>
      <AlertDialogOverlay>
        <AlertDialogPrimitive.Content
          className={cn(
            'z-50 flex w-full max-w-[calc(100%-2rem)] flex-col gap-4 rounded-lg border border-border bg-bg-overlay p-6 shadow-lg shadow-black/5 sm:max-w-lg',
            Platform.select({ web: 'animate-fade-in' }),
            className,
          )}
          // Flattened, not an array: Radix's AlertDialogContent slots its children
          // through an extra Slottable layer that spreads style, turning an array into
          // indexed keys the DOM rejects. Dialog's content has no such layer.
          style={StyleSheet.flatten([{ maxHeight: height * MAX_HEIGHT_RATIO }, style])}
          {...props}
        >
          <ScrollView className="shrink" contentContainerClassName="gap-4">
            {body}
          </ScrollView>
          {actions}
        </AlertDialogPrimitive.Content>
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
