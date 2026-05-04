import { Icon } from '@/components/ui/icon'
import { TextClassContext } from '@/components/ui/text'
import { cn } from '@/lib/utils'
import * as AccordionPrimitive from '@rn-primitives/accordion'
import { ChevronDown } from 'lucide-react-native'
import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'
import Animated, {
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated'

function Accordion({
  children,
  ...props
}: Omit<React.ComponentProps<typeof AccordionPrimitive.Root>, 'asChild'>) {
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
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      className={cn(
        'border-b border-border',
        Platform.select({ web: 'last:border-b-0' }),
        className,
      )}
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
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  children?: React.ReactNode
}) {
  const { isExpanded } = AccordionPrimitive.useItemContext()

  // Wireframe convention: ChevronDown reads as ChevronRight when
  // collapsed (-90°), rotates to natural ChevronDown (0°) when
  // expanded. Reads as "expand → reveal content below" — inverts
  // the rn-reusables baseline's 0°→180° rotation.
  const progress = useDerivedValue(
    () => (isExpanded ? withTiming(1, { duration: 250 }) : withTiming(0, { duration: 200 })),
    [isExpanded],
  )
  const chevronStyle = useAnimatedStyle(
    () => ({ transform: [{ rotate: `${progress.value * 90 - 90}deg` }] }),
    [progress],
  )

  return (
    <TextClassContext.Provider value="text-left text-sm font-medium">
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger {...props} asChild>
          <Trigger
            className={cn(
              'flex-row items-start justify-between gap-4 rounded-md py-4 disabled:opacity-50',
              Platform.select({
                web: cn(
                  'flex flex-1 cursor-pointer outline-none transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-focus-ring',
                  'disabled:pointer-events-none',
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
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  const { isExpanded } = AccordionPrimitive.useItemContext()
  return (
    <TextClassContext.Provider value="text-sm">
      <AccordionPrimitive.Content
        className={cn(
          'overflow-hidden',
          // Web entry/exit driven by radix's data-state +
          // `--radix-accordion-content-height` CSS var. Native
          // gets the same animation via reanimated layout
          // transitions on the wrapping Animated.View.
          Platform.select({
            web: isExpanded ? 'animate-accordion-down' : 'animate-accordion-up',
          }),
        )}
        {...props}
      >
        <Animated.View
          exiting={Platform.select({ native: FadeOutUp.duration(200) })}
          className={cn('pb-4', className)}
        >
          {children}
        </Animated.View>
      </AccordionPrimitive.Content>
    </TextClassContext.Provider>
  )
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
