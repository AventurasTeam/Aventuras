import { useCallback, useLayoutEffect, useRef } from 'react'
import { AccessibilityInfo, Platform, type ScrollView, type View } from 'react-native'

/** A fresh object per request, so revealing the same row twice scrolls twice. */
export type RevealRequest = { id: string }

type NodeRef = (node: View) => () => void

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

// A reveal is a go-to, so focus follows it; the collapsed-tier badge that asks for one unmounts
// on expand. Web moves keyboard focus (preventScroll leaves the animated scroll in charge);
// native moves the screen reader's.
function focusRow(target: View): void {
  if (Platform.OS === 'web') {
    ;(target as unknown as Partial<HTMLElement>).focus?.({ preventScroll: true })
    return
  }
  AccessibilityInfo.sendAccessibilityEvent(target, 'focus')
}

// One callback per id: a fresh one each render would detach and reattach every row.
function useNodeRefs() {
  const nodes = useRef(new Map<string, View>())
  const refs = useRef(new Map<string, NodeRef>())
  const refFor = useCallback((id: string): NodeRef => {
    const cached = refs.current.get(id)
    if (cached != null) return cached
    const ref: NodeRef = (node) => {
      nodes.current.set(id, node)
      return () => {
        if (nodes.current.get(id) === node) nodes.current.delete(id)
        if (refs.current.get(id) === ref) refs.current.delete(id)
      }
    }
    refs.current.set(id, ref)
    return ref
  }, [])
  return { nodes, refFor }
}

/**
 * Scrolls to the row a reveal names and moves focus to it, or back to top when `resetKey` changes
 * without one. The caller must mount the row — expanding its group, widening the view — in the
 * same update, and hand `focusRef` to the row's pressable.
 */
export function useRevealScroll(reveal: RevealRequest | null, resetKey: string) {
  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<View>(null)
  const { nodes: rowNodes, refFor: rowRef } = useNodeRefs()
  const { nodes: focusNodes, refFor: focusRef } = useNodeRefs()
  const committed = useRef({ reveal, resetKey })

  // A layout effect, so a reset never paints a frame at the old offset. A row
  // absent from this commit never scrolls — no stale request outlives it.
  useLayoutEffect(() => {
    const previous = committed.current
    committed.current = { reveal, resetKey }
    const revealed = reveal != null && reveal !== previous.reveal ? reveal.id : null
    const row = revealed != null ? rowNodes.current.get(revealed) : undefined
    const focusTarget = revealed != null ? focusNodes.current.get(revealed) : undefined
    const content = contentRef.current
    if (row != null && content != null) {
      let cancelled = false
      void accordionSettled(content).then(() => {
        if (cancelled) return
        row.measureLayout(content, (_x, y) => {
          if (cancelled) return
          scrollRef.current?.scrollTo({ y, animated: true })
          if (focusTarget != null) focusRow(focusTarget)
        })
      })
      return () => {
        cancelled = true
      }
    }
    if (resetKey !== previous.resetKey) scrollRef.current?.scrollTo({ y: 0, animated: false })
    return undefined
  }, [reveal, resetKey, rowNodes, focusNodes])

  return { scrollRef, contentRef, rowRef, focusRef }
}
