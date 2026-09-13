import type { TriggerRef } from '@rn-primitives/popover'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, Pressable, View, type LayoutChangeEvent, type ViewStyle } from 'react-native'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Text, type TextProps } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type TextStyleProps = Pick<TextProps, 'className' | 'size' | 'variant'>

type TruncatedTextProps = TextStyleProps & {
  children: string
  /**
   * The box around the text, and the tap target once it truncates: flex-item sizing, padding and
   * any touch floor belong here.
   */
  containerClassName?: string
  testID?: string
}

type Truncation = {
  truncated: boolean
  onTextLayout: (event: LayoutChangeEvent) => void
  probe: ReactNode
}

// touch.md → Tap-to-tooltip on inert chrome text: the popover dismisses after a brief idle.
const IDLE_DISMISS_MS = 4000

const PROBE_CLIP: ViewStyle = {
  position: 'absolute',
  width: 0,
  height: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
}
const PROBE_ROW: ViewStyle = {
  position: 'absolute',
  width: 10000,
  flexDirection: 'row',
  alignItems: 'flex-start',
}

const overflows = (node: HTMLElement) => node.scrollWidth > node.clientWidth

// RN Web's layout event carries the DOM node; an ellipsized node's scrollWidth still spans the
// whole string.
function useWebTruncation(children: string): Truncation {
  const node = useRef<HTMLElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  // A new string in a box that keeps its size fires no layout event.
  useLayoutEffect(() => {
    if (node.current != null) setTruncated(overflows(node.current))
  }, [children])
  return {
    truncated,
    onTextLayout: (event) => {
      node.current = (event.nativeEvent as unknown as { target: HTMLElement }).target
      setTruncated(overflows(node.current))
    },
    probe: null,
  }
}

// Native has no scrollWidth, so a hidden, unconstrained copy measures the natural width.
function useNativeTruncation(children: string, style: TextStyleProps): Truncation {
  const [boxWidth, setBoxWidth] = useState(0)
  const [fullWidth, setFullWidth] = useState(0)
  return {
    // A pixel of slack absorbs layout rounding between the two copies.
    truncated: fullWidth - boxWidth > 1,
    onTextLayout: (event) => setBoxWidth(event.nativeEvent.layout.width),
    probe: (
      <View aria-hidden style={PROBE_CLIP}>
        <View style={PROBE_ROW}>
          <Text {...style} onLayout={(event) => setFullWidth(event.nativeEvent.layout.width)}>
            {children}
          </Text>
        </View>
      </View>
    ),
  }
}

const useTruncation: (children: string, style: TextStyleProps) => Truncation =
  Platform.OS === 'web' ? useWebTruncation : useNativeTruncation

/**
 * One line of inert chrome text. While it truncates, a tap or click shows the whole string in a
 * popover; while it fits, it is plain text with no affordance (touch.md → Tap-to-tooltip on inert
 * chrome text).
 */
export function TruncatedText({
  children,
  containerClassName,
  testID,
  ...style
}: TruncatedTextProps) {
  const { truncated, onTextLayout, probe } = useTruncation(children, style)
  const box = cn('min-w-0 shrink', containerClassName)
  const text = (
    <Text
      {...style}
      numberOfLines={1}
      onLayout={onTextLayout}
      // The trigger carries the same string as its name.
      aria-hidden={truncated}
      testID={testID}
    >
      {children}
    </Text>
  )
  if (!truncated) {
    return (
      <View className={box}>
        {text}
        {probe}
      </View>
    )
  }
  return (
    <FullTextPopover fullText={children} className={box}>
      {text}
      {probe}
    </FullTextPopover>
  )
}

// Mounted only while the text truncates, so open state and the idle timer reset with it.
function FullTextPopover({
  fullText,
  className,
  children,
}: {
  fullText: string
  className: string
  children: ReactNode
}) {
  const trigger = useRef<TriggerRef>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => trigger.current?.close(), IDLE_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [open])
  return (
    <Popover asChild onOpenChange={setOpen} ariaLabel={t('chrome.fullText')}>
      <View className={className}>
        {children}
        {/* An overlay rather than a wrapper: the whole box is the target, padding and floor
            included, and the portaled content isn't a child of the button. */}
        <PopoverTrigger ref={trigger} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={fullText}
            className={cn(
              'absolute inset-0 rounded-sm',
              Platform.select({
                web: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              }),
            )}
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-72 px-3 py-2">
          <Text size="sm">{fullText}</Text>
        </PopoverContent>
      </View>
    </Popover>
  )
}

export type { TruncatedTextProps }
