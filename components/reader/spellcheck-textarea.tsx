import type { Lint } from 'harper.js'
import { useRef, useState } from 'react'
import { Platform, View, type TextInputScrollEvent } from 'react-native'

import { Text, TextClassContext } from '@/components/ui/text'
import { Textarea, type TextareaProps } from '@/components/ui/textarea'
import {
  POINTER_EVENTS_AUTO,
  POINTER_EVENTS_BOX_NONE,
  POINTER_EVENTS_NONE,
} from '@/constants/styles'
import { t } from '@/lib/i18n'
import { buildTextSegments } from '@/lib/spellcheck'
import { toast } from '@/lib/toast'

type SpellcheckTextareaProps = TextareaProps & {
  value: string
  lints: readonly Lint[]
}

type TooltipPosition = { left?: number; right?: number; top?: number; bottom?: number }
type TooltipState = { key: string; lint: Lint; position: TooltipPosition }

// Mirrors the tooltip's max-w-60 (240px); used to decide horizontal clamping
// before the tooltip has rendered.
const TOOLTIP_MAX_WIDTH = 240
// Rough two-line-tooltip height for the flip decision only — the flipped
// placement anchors via CSS `bottom`, so the real content height never
// needs measuring.
const TOOLTIP_EST_HEIGHT = 84

const OVERLAY_TEXT_CLASS =
  'w-full rounded-md border border-transparent px-row-x-md py-row-y-md text-sm text-transparent'

const LINT_UNDERLINE_CLASS = Platform.select({
  web: 'underline decoration-wavy decoration-danger',
  default: 'underline decoration-dotted decoration-danger',
})

function boundingRectOf(node: unknown): DOMRect | null {
  const el = node as { getBoundingClientRect?: () => DOMRect } | null
  return el?.getBoundingClientRect ? el.getBoundingClientRect() : null
}

export function SpellcheckTextarea({
  value,
  lints,
  onScroll,
  ...textareaProps
}: SpellcheckTextareaProps) {
  const containerRef = useRef<View>(null)
  const [scrollOffsetY, setScrollOffsetY] = useState(0)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  // The overlay's only job is carrying underlines, so with no lints it is a
  // transparent full-text duplicate of the input that can never draw anything.
  // Native is always in that state — harper needs WebAssembly, which Hermes
  // lacks, so `lintNarrativeText` there returns no lints by construction.
  const hasLints = lints.length > 0
  const segments = hasLints
    ? buildTextSegments(
        value,
        lints.map((lint) => lint.span()),
      )
    : []

  const handleScroll = (event: TextInputScrollEvent) => {
    setScrollOffsetY(event.nativeEvent.contentOffset.y)
    onScroll?.(event)
  }

  // Flip/clamp against the viewport: the composer sits at the bottom of the
  // screen, so the natural below-the-word placement usually clips off-screen,
  // and a lint near the window's right edge clips right.
  const showTooltip = (key: string, lint: Lint, wordRect: DOMRect | null) => {
    const containerRect = boundingRectOf(containerRef.current)
    if (!wordRect || !containerRect) return
    const position: TooltipPosition = {}
    if (wordRect.left + TOOLTIP_MAX_WIDTH > window.innerWidth) {
      position.right = Math.max(0, containerRect.right - wordRect.right)
    } else {
      position.left = wordRect.left - containerRect.left
    }
    if (wordRect.bottom + TOOLTIP_EST_HEIGHT > window.innerHeight) {
      position.bottom = containerRect.bottom - wordRect.top + 4
    } else {
      position.top = wordRect.bottom - containerRect.top + 4
    }
    setTooltip({ key, lint, position })
  }

  const hideTooltip = () => setTooltip(null)

  // Native has no reliable hover surface, so tap falls back to a toast
  // instead of the web's anchored tooltip.
  const handlePress = (lint: Lint) => {
    if (Platform.OS === 'web') return
    const suggestion = lint.suggestions()[0]?.get_replacement_text()
    const message =
      suggestion != null && suggestion.length > 0
        ? `${lint.message()} ${t('reader:spellcheckSuggestion', { text: suggestion })}`
        : lint.message()
    toast.info(message)
  }

  // Web-only DOM hover events — react-native-web forwards them as raw
  // MouseEvents, but RN's cross-platform Text types don't model them. Cast,
  // same pattern as components/ui/popover.tsx's web-only aria-haspopup prop.
  const hoverProps = (key: string, lint: Lint): object | undefined => {
    if (Platform.OS !== 'web') return undefined
    return {
      onMouseEnter: (event: unknown) => {
        const target = (event as { currentTarget?: unknown })?.currentTarget
        showTooltip(key, lint, boundingRectOf(target))
      },
      onMouseLeave: hideTooltip,
    }
  }

  return (
    <View ref={containerRef} className="relative">
      <Textarea value={value} onScroll={handleScroll} {...textareaProps} />

      {/* box-none restores pointer-events on the direct child only, so the root Text opts back
          out and the lint spans opt back in — otherwise the block eats clicks meant for the
          Textarea underneath. */}
      {hasLints ? (
        <View style={POINTER_EVENTS_BOX_NONE} className="absolute inset-0 overflow-hidden">
          <TextClassContext.Provider value="text-transparent">
            <Text
              className={OVERLAY_TEXT_CLASS}
              style={[POINTER_EVENTS_NONE, { transform: [{ translateY: -scrollOffsetY }] }]}
            >
              {segments.map((segment, i) => {
                if (segment.kind === 'plain') return <Text key={`p-${i}`}>{segment.text}</Text>
                const lint = lints[segment.index]
                return (
                  <Text
                    key={segment.key}
                    className={LINT_UNDERLINE_CLASS}
                    style={POINTER_EVENTS_AUTO}
                    onPress={() => handlePress(lint)}
                    {...hoverProps(segment.key, lint)}
                  >
                    {segment.text}
                  </Text>
                )
              })}
            </Text>
          </TextClassContext.Provider>
        </View>
      ) : null}

      {tooltip ? (
        <View
          className="absolute z-10 max-w-60 gap-1 rounded-md border border-border bg-bg-overlay p-2"
          style={[tooltip.position, POINTER_EVENTS_NONE]}
        >
          <Text size="xs">{tooltip.lint.message()}</Text>
          {(() => {
            const suggestion = tooltip.lint.suggestions()[0]?.get_replacement_text()
            return suggestion != null && suggestion.length > 0 ? (
              <Text size="xs" variant="muted">
                {t('reader:spellcheckSuggestion', { text: suggestion })}
              </Text>
            ) : null
          })()}
        </View>
      ) : null}
    </View>
  )
}

export type { SpellcheckTextareaProps }
