// components/reader/reader-surface.tsx
// Plain web React: renders on the web page and inside the reader document's
// DOM bundle — never on Hermes.
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type UIEvent,
  type WheelEvent,
} from 'react'

import { EntryCard } from '@/components/compounds/entry-card'
import { JumpButtons } from '@/components/reader/jump-buttons'
import { Skeleton } from '@/components/ui/skeleton'
import type { StoryEntry } from '@/lib/db'
import { computeScrollMetrics, createAutoscrollMachine } from '@/lib/reader-scroll'

import type { ReaderSurfaceHandle, ReaderSurfaceProps } from './reader-document-types'

const NEAR_BOTTOM_THRESHOLD_PX = 20
const JUMP_TO_BOTTOM_SETTLE_MS = 500
const NEAR_TOP_IDLE_MS = 150

// No content-visibility culling on rows: placeholder-height settle shifted
// content under the user's finger on every first upward pass (device-observed,
// worst on rich rows), and browser scroll anchoring doesn't fire for this
// tree. The loaded-set window (~50, far-end trim cap as the growth lever) is
// small enough to keep fully laid out — real heights make landing, prepend
// compensation, and scrolling exact.
const ROW_FRAME_CLASS = 'mx-auto w-full max-w-[860px] px-7 py-2'

type ReaderRowProps = {
  row: StoryEntry
  editing: boolean
  editContent: string | null
  editBlocked: boolean
  systemFixLabel?: string
  onStartEdit: (row: StoryEntry) => void
  onContentChange: (text: string) => void
  onCommitEdit: () => void | Promise<void>
  onCancelEdit: () => void
  onRequestRollback: (entryId: string) => Promise<void>
  onFixSystemEntry: () => Promise<void>
  onRetrySystemEntry: () => Promise<void>
  onDismissSystemEntry: () => Promise<void>
}

// Memoized so a stream chunk (which re-renders the surface) doesn't reconcile
// the whole loaded window: a committed row's props are all referentially stable
// (row identity, stable callbacks, null editContent), so only the editing row
// and the live streaming card re-render.
const ReaderRow = memo(function ReaderRow({
  row,
  editing,
  editContent,
  editBlocked,
  systemFixLabel,
  onStartEdit,
  onContentChange,
  onCommitEdit,
  onCancelEdit,
  onRequestRollback,
  onFixSystemEntry,
  onRetrySystemEntry,
  onDismissSystemEntry,
}: ReaderRowProps) {
  const isSystem = row.kind === 'system'
  return (
    <EntryCard
      kind={row.kind}
      content={editing ? (editContent ?? '') : row.content}
      meta={row.metadata ?? undefined}
      reasoning={row.metadata?.reasoning}
      disabled={editBlocked}
      editing={editing}
      onEdit={isSystem ? undefined : () => onStartEdit(row)}
      onContentChange={onContentChange}
      onCommitEdit={() => void onCommitEdit()}
      onCancelEdit={onCancelEdit}
      onDelete={
        isSystem || row.kind === 'opening' ? undefined : () => void onRequestRollback(row.id)
      }
      detail={isSystem ? row.metadata?.systemFailure?.detail : undefined}
      fixAction={
        isSystem && systemFixLabel != null
          ? { label: systemFixLabel, onPress: () => void onFixSystemEntry() }
          : undefined
      }
      onRetry={isSystem ? () => void onRetrySystemEntry() : undefined}
      onDismiss={isSystem ? () => void onDismissSystemEntry() : undefined}
    />
  )
})

export function ReaderSurface({
  rows,
  streaming,
  branchKey,
  hasOlder,
  editBlocked,
  jumpButtonEnabled,
  systemFixLabel,
  onNearTop,
  onCommitEdit,
  onRequestRollback,
  onRetrySystemEntry,
  onDismissSystemEntry,
  onFixSystemEntry,
  ref,
}: ReaderSurfaceProps & { ref?: Ref<ReaderSurfaceHandle> }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoscrollRef = useRef(createAutoscrollMachine())
  const lastDistanceRef = useRef(0)
  const pendingJumpAtRef = useRef(0)
  const nearTopRef = useRef(false)
  const streamActiveRef = useRef(false)
  const touchInterruptedRef = useRef(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  // Mirror edit state into refs so commitEdit stays referentially stable across
  // keystrokes — a changing commit callback would defeat the row memo.
  const editingIdRef = useRef<string | null>(null)
  const editDraftRef = useRef('')
  editingIdRef.current = editingId
  editDraftRef.current = editDraft

  // Branch switch: new window, scrolled to bottom, edit state dropped
  // (reader-composer.md → Loaded-set model → Branch switch).
  const landedBranchRef = useRef<string | null>(null)
  const pinActiveRef = useRef(false)
  useEffect(() => {
    setEditingId(null)
    setEditDraft('')
  }, [branchKey])
  // Open-at-bottom is a pin, not a one-shot: late layout (font swaps, image
  // decode) can still grow content after the first scrollTop write. Re-assert
  // per frame until the scroll height settles; the user's first gesture
  // breaks the pin. Keyed on hasRows (not rows) so prepends don't cancel a
  // running pin.
  const hasRows = rows.length > 0
  useLayoutEffect(() => {
    if (!hasRows || landedBranchRef.current === branchKey) return
    landedBranchRef.current = branchKey
    const el = scrollRef.current
    if (el == null) return
    pinActiveRef.current = true
    let stableFrames = 0
    let lastHeight = -1
    let raf = 0
    const assertBottom = () => {
      if (!pinActiveRef.current) return
      el.scrollTop = el.scrollHeight
      stableFrames = el.scrollHeight === lastHeight ? stableFrames + 1 : 0
      lastHeight = el.scrollHeight
      if (stableFrames >= 10) {
        pinActiveRef.current = false
        return
      }
      raf = requestAnimationFrame(assertBottom)
    }
    assertBottom()
    return () => {
      pinActiveRef.current = false
      cancelAnimationFrame(raf)
    }
  }, [branchKey, hasRows])

  // Everything that changes height above the reading position — a prepended
  // block, the boundary shimmer mounting or unmounting, or both in one
  // commit — funnels through one anchor rule: the row that led the window
  // last commit has its content-offset delta applied to scrollTop. Chrome's
  // scroll anchoring skips this tree (desktop-observed), so the scroller
  // opts out via overflow-anchor:none and this rule is the sole authority —
  // split per-cause compensations fought each other here (a hold target
  // captured before a sibling compensation ran re-asserted the stale
  // position). The short hold loop absorbs late layout of inserted content;
  // a branch switch never finds the memoized row, so landing stays untouched.
  const anchorMemoRef = useRef<{ id: string; offsetTop: number } | null>(null)
  const anchorHoldActiveRef = useRef(false)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const firstId = rows[0]?.id
    const memo = anchorMemoRef.current
    const firstEl =
      el != null && firstId != null
        ? el.querySelector(`[data-entry-row="${CSS.escape(firstId)}"]`)
        : null
    const recordCurrent = () => {
      anchorMemoRef.current =
        firstId != null && firstEl instanceof HTMLElement
          ? { id: firstId, offsetTop: firstEl.offsetTop }
          : null
    }
    if (el == null || memo == null) {
      recordCurrent()
      return
    }
    const anchorEl = el.querySelector(`[data-entry-row="${CSS.escape(memo.id)}"]`)
    if (!(anchorEl instanceof HTMLElement)) {
      recordCurrent()
      return
    }
    const deltaPx = anchorEl.offsetTop - memo.offsetTop
    recordCurrent()
    if (deltaPx === 0) return
    el.scrollTop = Math.max(0, el.scrollTop + deltaPx)
    const targetTop = anchorEl.getBoundingClientRect().top
    anchorHoldActiveRef.current = true
    let stableFrames = 0
    let totalFrames = 0
    let raf = 0
    const hold = () => {
      if (!anchorHoldActiveRef.current || !anchorEl.isConnected) return
      // Sub-pixel tolerance: scrollTop writes round, so a fractional drift
      // can never fully clear — without it this loop would spin to the cap.
      const drift = anchorEl.getBoundingClientRect().top - targetTop
      if (Math.abs(drift) >= 1) {
        el.scrollTop += drift
        stableFrames = 0
      } else {
        stableFrames += 1
      }
      totalFrames += 1
      if (stableFrames >= 10 || totalFrames >= 120) {
        anchorHoldActiveRef.current = false
        return
      }
      raf = requestAnimationFrame(hold)
    }
    raf = requestAnimationFrame(hold)
    return () => {
      anchorHoldActiveRef.current = false
      cancelAnimationFrame(raf)
    }
  }, [rows, hasOlder])

  // The near-top load fires only at scroll rest: prepending (and the
  // compensating scrollTop write) mid-drag or mid-fling fights the
  // compositor-owned scroll and reads as a jump — the same pathology that
  // disqualified JS virtualizers. Latch the boundary signal, fire it once
  // scroll events go quiet and no finger is down; a stationary prepend with
  // real heights compensates exactly, so the viewport never moves.
  const gestureActiveRef = useRef(false)
  const nearTopPendingRef = useRef(false)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armNearTopIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null
      if (gestureActiveRef.current || !nearTopPendingRef.current) return
      nearTopPendingRef.current = false
      void onNearTop()
    }, NEAR_TOP_IDLE_MS)
  }, [onNearTop])
  useEffect(
    () => () => {
      if (idleTimerRef.current != null) clearTimeout(idleTimerRef.current)
    },
    [],
  )
  useEffect(() => {
    if (!hasOlder) nearTopPendingRef.current = false
  }, [hasOlder])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const metrics = computeScrollMetrics(event.currentTarget)
      lastDistanceRef.current = metrics.distanceFromBottomPx
      autoscrollRef.current.userScrolled({ distanceFromBottomPx: metrics.distanceFromBottomPx })
      if (hasOlder && metrics.withinTopViewport && !nearTopRef.current)
        nearTopPendingRef.current = true
      nearTopRef.current = metrics.withinTopViewport
      if (nearTopPendingRef.current) armNearTopIdleTimer()
      setShowJumpToBottom(metrics.distanceFromBottomPx > NEAR_BOTTOM_THRESHOLD_PX)
    },
    [armNearTopIdleTimer, hasOlder],
  )

  // Upward only: wheel-down toward the live edge should let the positional
  // rule re-engage autoscroll, not interrupt it. Any wheel breaks the
  // open-at-bottom pin — the user has taken over.
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    pinActiveRef.current = false
    anchorHoldActiveRef.current = false
    if (event.deltaY < 0) autoscrollRef.current.userInterrupted()
  }, [])

  // Touch drags interrupt like native drag-begin did — keyed off the first
  // touchmove, not touchstart, so plain taps can't disengage a pinned stream.
  const handleTouchStart = useCallback(() => {
    gestureActiveRef.current = true
  }, [])
  const handleTouchMove = useCallback(() => {
    pinActiveRef.current = false
    anchorHoldActiveRef.current = false
    if (touchInterruptedRef.current) return
    touchInterruptedRef.current = true
    autoscrollRef.current.userInterrupted()
  }, [])
  const handleTouchEnd = useCallback(() => {
    touchInterruptedRef.current = false
    gestureActiveRef.current = false
    // Momentum scroll events re-arm the timer; a still-finger release with a
    // pending boundary load needs this kick or the load never fires.
    if (nearTopPendingRef.current) armNearTopIdleTimer()
  }, [armNearTopIdleTimer])

  // Stream lifecycle + pin. Layout effect so the pin targets the row height
  // the just-arrived chunk actually produced.
  useLayoutEffect(() => {
    const machine = autoscrollRef.current
    if (streaming == null) {
      if (streamActiveRef.current) {
        streamActiveRef.current = false
        machine.streamEnded()
      }
      return
    }
    if (!streamActiveRef.current) {
      streamActiveRef.current = true
      const jumpedRecently = Date.now() - pendingJumpAtRef.current < JUMP_TO_BOTTOM_SETTLE_MS
      machine.streamStarted({
        distanceFromBottomPx: jumpedRecently ? 0 : lastDistanceRef.current,
      })
    }
    if (machine.state === 'engaged') {
      const el = scrollRef.current
      if (el != null) el.scrollTop = el.scrollHeight
      machine.autoscrollApplied({ distanceFromBottomPx: 0 })
    }
  }, [streaming])

  const jumpToBottom = useCallback(() => {
    // Cancel any active landing pin / anchor-hold loop first: otherwise a hold
    // spawned by a just-fired boundary prepend keeps yanking scrollTop toward
    // the top anchor while this animates to the bottom, and they fight.
    pinActiveRef.current = false
    anchorHoldActiveRef.current = false
    const el = scrollRef.current
    if (el != null) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    lastDistanceRef.current = 0
    if (streamActiveRef.current) {
      autoscrollRef.current.streamStarted({ distanceFromBottomPx: 0 })
    } else {
      autoscrollRef.current.autoscrollApplied({ distanceFromBottomPx: 0 })
      pendingJumpAtRef.current = Date.now()
    }
  }, [])
  useImperativeHandle(ref, () => ({ jumpToBottom }), [jumpToBottom])

  const startEdit = useCallback((row: StoryEntry) => {
    setEditingId(row.id)
    setEditDraft(row.content)
  }, [])
  const commitEdit = useCallback(async () => {
    const id = editingIdRef.current
    if (id == null) return
    // A rejected commit keeps the draft open so typing isn't silently lost;
    // the host owns the error toast.
    const result = await onCommitEdit(id, editDraftRef.current)
    if (result?.ok) {
      setEditingId(null)
      setEditDraft('')
    }
  }, [onCommitEdit])
  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto [overflow-anchor:none]"
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {hasOlder && rows.length > 0 ? (
          <div aria-hidden className={ROW_FRAME_CLASS}>
            <div className="rounded-lg border border-border bg-bg-raised p-4">
              <Skeleton className="mb-3 h-4 w-24" />
              <Skeleton className="mb-2 h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ) : null}
        {rows.map((row) => (
          <div key={row.id} data-entry-row={row.id} className={ROW_FRAME_CLASS}>
            <ReaderRow
              row={row}
              editing={editingId === row.id}
              editContent={editingId === row.id ? editDraft : null}
              editBlocked={editBlocked}
              systemFixLabel={systemFixLabel}
              onStartEdit={startEdit}
              onContentChange={setEditDraft}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onRequestRollback={onRequestRollback}
              onFixSystemEntry={onFixSystemEntry}
              onRetrySystemEntry={onRetrySystemEntry}
              onDismissSystemEntry={onDismissSystemEntry}
            />
          </div>
        ))}
        {streaming != null ? (
          <div className={ROW_FRAME_CLASS}>
            <EntryCard
              kind="streaming"
              content={streaming.content}
              reasoning={streaming.reasoning.length > 0 ? streaming.reasoning : undefined}
              streamingPhase={
                streaming.reasoning.length > 0 && streaming.content.length === 0
                  ? 'reasoning'
                  : 'reply'
              }
            />
          </div>
        ) : null}
      </div>
      <JumpButtons
        showJumpToBottom={jumpButtonEnabled && rows.length > 0 && showJumpToBottom}
        onJumpToBottom={jumpToBottom}
      />
    </div>
  )
}
