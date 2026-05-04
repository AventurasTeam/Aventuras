import { Text, TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import * as TabsPrimitive from '@rn-primitives/tabs'
import * as React from 'react'
import { Platform } from 'react-native'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cn('flex flex-col gap-4', className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex-row items-end gap-4 border-b border-border',
        Platform.select({ web: 'inline-flex w-full' }),
        className,
      )}
      {...props}
    />
  )
}

type TabsTriggerProps = React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  /**
   * Optional count rendered as muted small text after the label
   * (e.g. `Connections 3`). Consumers format `99+` themselves if
   * they want clamping; the primitive renders the value as-is.
   */
  count?: number
  children?: React.ReactNode
}

function TabsTrigger({ className, count, children, ...props }: TabsTriggerProps) {
  const { value } = TabsPrimitive.useRootContext()
  const active = props.value === value
  return (
    <TextClassContext.Provider
      value={cn(
        'text-sm',
        active ? 'text-fg-primary font-medium' : 'text-fg-muted',
        // group-hover lifts the inactive label color on web —
        // direct hover: on the Pressable doesn't cascade through
        // the inherited TextClassContext, so we hook the Pressable
        // as a `group` and target the text via group-hover here.
        !active && Platform.select({ web: 'transition-colors group-hover:text-fg-primary' }),
      )}
    >
      <TabsPrimitive.Trigger
        // Inline `pointerEvents` on disabled web triggers — the
        // rn-primitives Trigger2 wrapper drops `disabled` before
        // forwarding to radix Tabs.Trigger, so radix's own
        // onClick (which fires onValueChange) doesn't see the
        // disabled state and runs anyway. Pressable.disabled
        // blocks its own onPress but not the radix-side onClick
        // attached via Slot. Inline `pointer-events: none` is
        // the foolproof gate at the DOM level — kills both.
        // className-side `pointer-events-none` doesn't work
        // reliably here (NativeWind/inline-style ordering).
        style={
          Platform.OS === 'web' && props.disabled ? ({ pointerEvents: 'none' } as never) : undefined
        }
        className={cn(
          'group flex-row items-center gap-1 border-b-2 pb-2 pt-1',
          active ? 'border-fg-primary' : 'border-transparent',
          Platform.select({
            web: cn(
              'cursor-pointer outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-focus-ring',
            ),
          }),
          // No `cursor-not-allowed` — `pointer-events: none` (set
          // inline above) prevents hover state, which means CSS
          // `cursor` doesn't apply either. Matches Button's
          // `disabled:pointer-events-none` precedent. Visual
          // disabled cue is `opacity-50`.
          props.disabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        {typeof children === 'string' ? <Text>{children}</Text> : children}
        {count != null ? (
          <Text size="xs" variant="muted">
            {count}
          </Text>
        ) : null}
      </TabsPrimitive.Trigger>
    </TextClassContext.Provider>
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(Platform.select({ web: 'flex-1 outline-none' }), className)}
      {...props}
    />
  )
}

// Re-export for cases where consumers need raw View access on the
// list (e.g. wrapping tabs with sticky positioning chrome).
export { Tabs, TabsContent, TabsList, TabsTrigger }
export type { TabsTriggerProps }
