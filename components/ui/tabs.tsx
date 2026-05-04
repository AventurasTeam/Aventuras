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
        !active && Platform.select({ web: 'transition-colors group-hover:text-fg-primary' }),
      )}
    >
      <TabsPrimitive.Trigger
        style={
          Platform.OS === 'web' && props.disabled ? ({ pointerEvents: 'none' } as never) : undefined
        }
        className={cn(
          'group flex-row items-center gap-1 border-b-2 py-row-y-sm',
          active ? 'border-fg-primary' : 'border-transparent',
          Platform.select({
            web: cn(
              'cursor-pointer outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-focus-ring',
            ),
          }),
          props.disabled && 'opacity-50',
          className,
        )}
        {...props}
      >
        {typeof children === 'string' ? <Text>{children}</Text> : children}
        {count != null ? (
          <Text size="xs" className="font-normal">
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
