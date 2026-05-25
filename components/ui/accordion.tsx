import * as AccordionPrimitive from '@rn-primitives/accordion'
import { ChevronDown } from 'lucide-react-native'
import { type ComponentProps, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'
import Animated, {
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated'

import { Icon } from '@/components/ui/icon'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'

function Accordion({
  children,
  ...props
}: Omit<ComponentProps<typeof AccordionPrimitive.Root>, 'asChild'>) {
  return (
    <LayoutAnimationConfig skipEntering>
      <AccordionPrimitive.Root
        {...(props as AccordionPrimitive.RootProps)}
        asChild={Platform.OS !== 'web'}
      >
        <Animated.View layout={LinearTransition.duration(200)}>{children}</Animated.View>
      </AccordionPrimitive.Root>
    </LayoutAnimationConfig>
  )
}

function AccordionItem({
  children,
  className,
  value,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn('border-b border-border', className)}
      value={value}
      asChild={Platform.OS !== 'web'}
      {...props}
    >
      <Animated.View
        className="native:overflow-hidden"
        layout={Platform.select({ native: LinearTransition.duration(200) })}
      >
        {children}
      </Animated.View>
    </AccordionPrimitive.Item>
  )
}

const Trigger = Platform.OS === 'web' ? View : Pressable

function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger> & {
  children?: ReactNode
}) {
  const { isExpanded } = AccordionPrimitive.useItemContext()

  const progress = useDerivedValue(
    () => (isExpanded ? withTiming(1, { duration: 250 }) : withTiming(0, { duration: 200 })),
    [isExpanded],
  )
  const chevronStyle = useAnimatedStyle(
    () => ({ transform: [{ rotate: `${progress.value * 90 - 90}deg` }] }),
    [progress],
  )

  return (
    <TextClassContext.Provider value="text-left text-sm font-medium text-fg-primary">
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger {...props} asChild>
          <Trigger
            style={
              Platform.OS === 'web' && props.disabled
                ? ({ pointerEvents: 'none' } as never)
                : undefined
            }
            className={cn(
              'flex-row items-start justify-between gap-4 rounded-md py-row-y-lg',
              props.disabled && 'opacity-50',
              Platform.select({
                web: cn(
                  'flex flex-1 cursor-pointer outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-focus-ring',
                ),
              }),
              className,
            )}
          >
            <>{children}</>
            <Animated.View style={chevronStyle}>
              <Icon
                as={ChevronDown}
                size="sm"
                className={cn(
                  'shrink-0 text-fg-muted',
                  Platform.select({ web: 'pointer-events-none' }),
                )}
              />
            </Animated.View>
          </Trigger>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
    </TextClassContext.Provider>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  const { isExpanded } = AccordionPrimitive.useItemContext()
  return (
    <TextClassContext.Provider value="text-sm text-fg-primary">
      <AccordionPrimitive.Content
        className={cn(
          'overflow-hidden',
          Platform.select({
            web: isExpanded ? 'animate-accordion-down' : 'animate-accordion-up',
          }),
        )}
        {...props}
      >
        <Animated.View
          exiting={Platform.select({ native: FadeOutUp.duration(200) })}
          className={cn('pb-row-y-lg', className)}
        >
          {children}
        </Animated.View>
      </AccordionPrimitive.Content>
    </TextClassContext.Provider>
  )
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
