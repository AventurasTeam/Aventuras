import { ChevronDown, ChevronRight, Copy } from 'lucide-react-native'
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Platform, Pressable, View, type Text as RNText } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import type { Tier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const QUOTE_LINES = 2

// EntryCard renders only inside a web document, where an RN-Web host ref is its DOM node.
function domNode(ref: RefObject<unknown>): HTMLElement | null {
  const node = ref.current
  return node instanceof HTMLElement ? node : null
}

/**
 * Whether the text runs past `lines` lines, re-measured as the width changes. Measured against the
 * line height rather than the clamped box, so it holds while the text is open too.
 */
function useOverflowsLines(ref: RefObject<RNText | null>, lines: number, text: string): boolean {
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const node = domNode(ref)
    if (node == null) return
    const measure = () => {
      const style = getComputedStyle(node)
      const declared = Number.parseFloat(style.lineHeight)
      // `normal` doesn't parse; browsers render it near 1.2 em.
      const lineHeight = Number.isFinite(declared)
        ? declared
        : 1.2 * Number.parseFloat(style.fontSize)
      setOverflows(node.scrollHeight > lines * lineHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, lines, text])
  return overflows
}

// The entry sits at the branch tail, so an opened block can land below the fold. Open state only
// changes on a tap, so the write never lands mid-gesture.
function useRevealOnOpen(ref: RefObject<unknown>, open: boolean): void {
  useLayoutEffect(() => {
    if (open) domNode(ref)?.scrollIntoView({ block: 'nearest' })
  }, [ref, open])
}

function TextToggle({
  expanded,
  onPress,
  tapClassName,
  children,
}: {
  expanded: boolean
  onPress: () => void
  /** Phone-only padding to the 44 px tap floor, cancelled by margins so nothing moves. */
  tapClassName: string | false
  children: ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      onPress={onPress}
      className={cn(
        'group/system-toggle flex-row items-center gap-1 self-start',
        tapClassName,
        Platform.select({ web: 'cursor-pointer outline-none' }),
      )}
    >
      {children}
    </Pressable>
  )
}

const toggleTextClass = Platform.select({
  web: 'rounded-sm group-hover/system-toggle:text-fg-primary group-focus-visible/system-toggle:ring-2 group-focus-visible/system-toggle:ring-focus-ring',
})

export function HeldTextQuote({
  text,
  onCopy,
  tier,
}: {
  text: string
  onCopy?: (text: string) => void
  tier: Tier
}) {
  const [open, setOpen] = useState(false)
  const quoteRef = useRef<RNText>(null)
  const overflows = useOverflowsLines(quoteRef, QUOTE_LINES, text)
  useRevealOnOpen(quoteRef, open)

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <Text size="xs" variant="muted" className="font-medium">
          {t('reader:systemEntry.heldTextLabel')}
        </Text>
        {onCopy != null ? (
          <IconAction
            icon={Copy}
            label={t('reader:systemEntry.copyHeldText')}
            size="sm"
            onPress={() => onCopy(text)}
          />
        ) : null}
      </View>
      {/* A text node, never the markdown pipeline: the text as Dismiss would put it back. */}
      <Text
        ref={quoteRef}
        size="sm"
        variant="muted"
        numberOfLines={open ? undefined : QUOTE_LINES}
        className="border-l-2 border-border pl-2"
      >
        {text}
      </Text>
      {overflows ? (
        <TextToggle
          expanded={open}
          onPress={() => setOpen((v) => !v)}
          // z-10: the custody line follows and would otherwise win the overlapping tap zone.
          tapClassName={tier === 'phone' && 'z-10 -my-3.5 py-3.5'}
        >
          <Text size="xs" variant="muted" className={cn('underline', toggleTextClass)}>
            {t(open ? 'reader:systemEntry.showLess' : 'reader:systemEntry.showAll')}
          </Text>
        </TextToggle>
      ) : null}
      <Text size="xs" variant="muted">
        {t('reader:systemEntry.heldTextCustody')}
      </Text>
    </View>
  )
}

export function DetailsDisclosure({
  detail,
  onCopy,
  tier,
}: {
  detail: string
  onCopy?: (text: string) => void
  tier: Tier
}) {
  const [open, setOpen] = useState(false)
  const bodyRef = useRef<View>(null)
  useRevealOnOpen(bodyRef, open)

  return (
    <View className="gap-1">
      <TextToggle
        expanded={open}
        onPress={() => setOpen((v) => !v)}
        // Top fills the gap above, so the buttons keep their own tap zones. Bottom overhangs the
        // card's padding, or once open the detail, which z-10 keeps from winning that strip.
        tapClassName={tier === 'phone' && 'z-10 -mb-4 -mt-3 pb-4 pt-3'}
      >
        <Icon as={open ? ChevronDown : ChevronRight} size={12} className="text-fg-muted" />
        <Text size="xs" variant="muted" className={toggleTextClass}>
          {t('reader:systemEntry.details')}
        </Text>
      </TextToggle>
      {open ? (
        <View ref={bodyRef} className="flex-row items-start gap-2">
          <Text
            size="xs"
            variant="muted"
            className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]"
          >
            {detail}
          </Text>
          {onCopy != null ? (
            <IconAction
              icon={Copy}
              label={t('reader:systemEntry.copyDetails')}
              size="sm"
              onPress={() => onCopy(detail)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
