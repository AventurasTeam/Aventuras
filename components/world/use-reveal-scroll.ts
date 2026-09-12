import { useCallback, useLayoutEffect, useRef } from 'react'
import type { ScrollView, View } from 'react-native'

/** A fresh object per request, so revealing the same row twice scrolls twice. */
export type RevealRequest = { id: string }

type RowRef = (node: View) => () => void

// Two passes seen in practice — Radix cancels and restarts the expand once — plus slack.
const MAX_SETTLE_PASSES = 4

// The accordion-down / accordion-up keyframes in tailwind.config.
function isAccordionAnimation(animation: Animation): boolean {
  return animation instanceof CSSAnimation && animation.animationName.startsWith('accordion-')
}

// Scrolling while a tier's web expand animation runs clamps short of the row. Only the
// accordion's keyframes are awaited, so an unrelated row animation never delays a reveal.
async function accordionSettled(node: View): Promise<void> {
  const el = node as unknown as Partial<Pick<Element, 'getAnimations'>>
  if (typeof el.getAnimations !== 'function') return
  for (let pass = 0; pass < MAX_SETTLE_PASSES; pass++) {
    const running = el
      .getAnimations({ subtree: true })
      .filter((a) => a.playState === 'running' && isAccordionAnimation(a))
    if (running.length === 0) return
    await Promise.allSettled(running.map((a) => a.finished))
  }
}

/**
 * Scrolls to the row a reveal names, or back to top when `resetKey` changes without one. The
 * caller must mount the row — expanding its group, widening the view — in the same update.
 */
export function useRevealScroll(reveal: RevealRequest | null, resetKey: string) {
  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<View>(null)
  const rowNodes = useRef(new Map<string, View>())
  const rowRefs = useRef(new Map<string, RowRef>())
  const committed = useRef({ reveal, resetKey })

  // A layout effect, so a reset never paints a frame at the old offset. A row
  // absent from this commit never scrolls — no stale request outlives it.
  useLayoutEffect(() => {
    const previous = committed.current
    committed.current = { reveal, resetKey }
    const row =
      reveal != null && reveal !== previous.reveal ? rowNodes.current.get(reveal.id) : undefined
    const content = contentRef.current
    if (row != null && content != null) {
      let cancelled = false
      void accordionSettled(content).then(() => {
        if (cancelled) return
        row.measureLayout(content, (_x, y) => {
          if (!cancelled) scrollRef.current?.scrollTo({ y, animated: true })
        })
      })
      return () => {
        cancelled = true
      }
    }
    // Skipped when a reveal already lands this update — that branch returns above.
    if (resetKey !== previous.resetKey) scrollRef.current?.scrollTo({ y: 0, animated: false })
    return undefined
  }, [reveal, resetKey])

  // One callback per id: a fresh one each render would detach and reattach every row.
  const rowRef = useCallback((id: string): RowRef => {
    const cached = rowRefs.current.get(id)
    if (cached != null) return cached
    const ref: RowRef = (node) => {
      rowNodes.current.set(id, node)
      return () => {
        if (rowNodes.current.get(id) === node) rowNodes.current.delete(id)
        if (rowRefs.current.get(id) === ref) rowRefs.current.delete(id)
      }
    }
    rowRefs.current.set(id, ref)
    return ref
  }, [])

  return { scrollRef, contentRef, rowRef }
}
