// components/reader/reader-surface.tsx
// Plain web React: renders on the web page and inside the reader document's
// DOM bundle — never on Hermes.
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type Ref,
  type UIEvent,
  type WheelEvent,
} from 'react'

import { EntryCard } from '@/components/compounds/entry-card'
import type { SceneEdit, SceneOptions } from '@/components/compounds/scene-edit-form'
import { resolveContentEditNotice } from '@/components/reader/content-edit-notice'
import { cutOffNoticeText, offersProfileFix } from '@/components/reader/cut-off-copy'
import { JumpButtons } from '@/components/reader/jump-buttons'
import { Skeleton } from '@/components/ui/skeleton'
import { useTier } from '@/hooks/use-tier'
import type { Tier } from '@/hooks/use-tier'
import type { CalendarFrame } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  computeScrollMetrics,
  createAutoscrollMachine,
  isDownwardScrollKey,
  isScrollbarPress,
  isUpwardScrollKey,
} from '@/lib/reader-scroll'

import type { ChapterBreak } from './chapter-breaks'
import { keptSubmissionText } from './composer-draft'
import type { EditResult, ReaderSurfaceHandle, ReaderSurfaceProps } from './reader-document-types'
import { headTurnIdsOf, rowReversalFlags } from './row-reversal-flags'
import { resolveSaveAndRegenTurn } from './save-and-regen'
import type { ResolvedEntity } from './scene-editing'

const NEAR_BOTTOM_THRESHOLD_PX = 20
const JUMP_TO_BOTTOM_SETTLE_MS = 500
const NEAR_TOP_IDLE_MS = 150
const JUMP_LANDING_GAP_PX = 12
const LANDED_HIGHLIGHT_MS = 1_500
const LANDING_SETTLED_FRAMES = 10
const LANDING_MAX_FRAMES = 600
// A trackpad's momentum arrives as wheel events about a frame apart; a longer gap is a new gesture.
const WHEEL_CHAIN_GAP_MS = 100
// Trackpad momentum runs 1-3 s; a chain held longer is the user's own scrolling through the press.
const WHEEL_HOLD_MAX_MS = 3_000
// Custom properties inherit; the card's animation can't read the wrapper's animation-duration.
const LANDED_ROW_STYLE = { '--reader-landed-ms': `${LANDED_HIGHLIGHT_MS}ms` } as CSSProperties

// No content-visibility culling on rows: placeholder-height settle shifted
// content under the user's finger on every first upward pass (device-observed,
// worst on rich rows), and browser scroll anchoring doesn't fire for this
// tree. The loaded-set window (~50, far-end trim cap as the growth lever) is
// small enough to keep fully laid out — real heights make landing, prepend
// compensation, and scrolling exact.
const ROW_FRAME_CLASS = 'mx-auto w-full max-w-[860px] px-7 py-2'

type Landing = { entryId: string; running: boolean }

// A key typed into a field moves its caret, not the reader.
function isEditableTarget(target: Node): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

// A chapter jump opens under its heading: the break above a row lands in the row's place.
function landingElement(rowEl: HTMLElement): HTMLElement {
  const previous = rowEl.previousElementSibling
  return previous instanceof HTMLElement && previous.getAttribute('role') === 'separator'
    ? previous
    : rowEl
}

type ReaderRowProps = {
  row: StoryEntry
  tier: Tier
  editing: boolean
  editContent: string | null
  editBlocked: boolean
  // Split from editBlocked by rowReversalFlags, so the head reversals stay live during a pass.
  editDisabled: boolean
  reversalDisabled: boolean
  disabledReason?: string
  systemFixLabel?: string
  cutOffFixLabel?: string
  // Flat primitives rather than the decoration object: a fresh `{…}` per walk
  // would defeat the shallow memo compare the same way a merged row would.
  worldTimeLabel?: string
  worldTimeRaw?: number
  worldTimeBreakPreviousLabel?: string
  worldTimeFrame: CalendarFrame | null
  onEditWorldTime: (entryId: string, next: number) => Promise<EditResult>
  onRequestEditWorldTime: (entryId: string) => Promise<void>
  // Shared across every row, so one stable identity each keeps the memo compare holding.
  entityNames: readonly ResolvedEntity[]
  sceneOptions: SceneOptions
  /** The tail rule: only the last entry's card gets edit handlers at all. */
  isTail: boolean
  onEditScene: (entryId: string, next: SceneEdit) => Promise<EditResult>
  onRequestEditScene: (entryId: string) => void
  onStartEdit: (row: StoryEntry) => void
  onContentChange: (text: string) => void
  onCommitEdit: () => void | Promise<void>
  /** The reply this row produced, when this row is the head turn's action — null on every other row. */
  regenTargetId: string | null
  onCommitEditAndRegen: (replyId: string) => void | Promise<void>
  onCancelEdit: () => void
  onRequestRollback: (entryId: string) => Promise<void>
  onRegenerate: (entryId: string) => Promise<void>
  onFixSystemEntry: () => Promise<void>
  onFixCutOff: () => Promise<void>
  onRetrySystemEntry?: () => Promise<void>
  onDismissSystemEntry: () => Promise<void>
  onCopySystemText: (text: string) => Promise<void>
}

// Memo: on web committed-row props are referentially stable, so a stream chunk re-renders only the
// editing row and live card. Native props lose identity over the expo-dom bridge, so there it
// holds only for document-internal renders.
const ReaderRow = memo(function ReaderRow({
  row,
  tier,
  editing,
  editContent,
  editBlocked,
  editDisabled,
  reversalDisabled,
  disabledReason,
  systemFixLabel,
  cutOffFixLabel,
  worldTimeLabel,
  worldTimeRaw,
  worldTimeBreakPreviousLabel,
  worldTimeFrame,
  onEditWorldTime,
  onRequestEditWorldTime,
  entityNames,
  sceneOptions,
  isTail,
  onEditScene,
  onRequestEditScene,
  onStartEdit,
  onContentChange,
  onCommitEdit,
  regenTargetId,
  onCommitEditAndRegen,
  onCancelEdit,
  onRequestRollback,
  onRegenerate,
  onFixSystemEntry,
  onFixCutOff,
  onRetrySystemEntry,
  onDismissSystemEntry,
  onCopySystemText,
}: ReaderRowProps) {
  const isSystem = row.kind === 'system'
  const heldText = isSystem
    ? keptSubmissionText(row.metadata?.systemFailure?.submission)
    : undefined
  const timeEditable = worldTimeRaw != null && worldTimeFrame != null
  // A NULL metadata column carries no absolute triple to edit: the action layer rejects
  // it and useSceneEditing will not open the sheet, so offering the control would leave
  // the phone tier's button doing nothing at all.
  const sceneEditable = isTail && row.metadata != null
  const contentEditNotice = resolveContentEditNotice({
    hasMetadata: row.metadata != null,
    sceneEditable,
    hasSaveAndRegen: regenTargetId != null,
  })
  // EntryCard's canonical prop is an object; building it here keeps the walk
  // primitive-valued so ReaderRow's memo compare still holds.
  const monotonicityBreak =
    worldTimeBreakPreviousLabel != null ? { previousLabel: worldTimeBreakPreviousLabel } : undefined
  const cutOff = row.kind === 'ai_reply' ? row.metadata?.cutOff : undefined
  const cutOffNotice =
    cutOff != null
      ? {
          text: cutOffNoticeText(cutOff),
          action:
            offersProfileFix(cutOff.cause) && cutOffFixLabel != null
              ? { label: cutOffFixLabel, onPress: () => void onFixCutOff() }
              : undefined,
        }
      : undefined
  return (
    <EntryCard
      className="reader-entry-card"
      kind={row.kind}
      tier={tier}
      content={editing ? (editContent ?? '') : row.content}
      meta={row.metadata ?? undefined}
      reasoning={row.metadata?.reasoning}
      disabled={editBlocked}
      disabledReason={disabledReason}
      editDisabled={editDisabled}
      reversalDisabled={reversalDisabled}
      editing={editing}
      contentEditNotice={contentEditNotice ?? undefined}
      editDirty={editing && editContent !== row.content}
      onEdit={isSystem ? undefined : () => onStartEdit(row)}
      onRegen={row.kind === 'ai_reply' ? () => void onRegenerate(row.id) : undefined}
      onContentChange={onContentChange}
      onCommitEdit={() => void onCommitEdit()}
      onCommitEditAndRegen={
        regenTargetId != null ? () => void onCommitEditAndRegen(regenTargetId) : undefined
      }
      onCancelEdit={onCancelEdit}
      onDelete={
        isSystem || row.kind === 'opening' ? undefined : () => void onRequestRollback(row.id)
      }
      detail={isSystem ? row.metadata?.systemFailure?.detail : undefined}
      heldText={heldText}
      onCopy={isSystem ? (text) => void onCopySystemText(text) : undefined}
      fixAction={
        isSystem && systemFixLabel != null
          ? { label: systemFixLabel, onPress: () => void onFixSystemEntry() }
          : undefined
      }
      onRetry={isSystem && onRetrySystemEntry != null ? () => void onRetrySystemEntry() : undefined}
      onDismiss={isSystem ? () => void onDismissSystemEntry() : undefined}
      cutOffNotice={cutOffNotice}
      worldTimeLabel={worldTimeLabel}
      worldTimeRaw={timeEditable ? worldTimeRaw : undefined}
      worldTimeMonotonicityBreak={monotonicityBreak}
      worldTimeFrame={timeEditable ? worldTimeFrame : undefined}
      onEditTime={
        timeEditable ? async (next) => (await onEditWorldTime(row.id, next)).ok : undefined
      }
      onRequestEditTime={timeEditable ? () => void onRequestEditWorldTime(row.id) : undefined}
      sceneEntities={row.metadata?.sceneEntities}
      currentLocationId={row.metadata?.currentLocationId}
      entityNames={entityNames}
      stateReport={row.metadata?.stateReport}
      summary={row.metadata?.summary}
      retrievalQueries={row.metadata?.retrievalQueries}
      sceneOptions={sceneEditable ? sceneOptions : undefined}
      onEditScene={sceneEditable ? (next) => onEditScene(row.id, next) : undefined}
      onRequestEditScene={sceneEditable ? () => onRequestEditScene(row.id) : undefined}
    />
  )
})

function ChapterBreakRule({ number, timeLabel }: ChapterBreak) {
  const label = t('chapters:label', { number })
  const text = timeLabel != null ? `${label} · ${timeLabel}` : label
  return (
    <div
      role="separator"
      aria-label={text}
      className={`${ROW_FRAME_CLASS} flex items-center gap-3`}
    >
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-fg-muted">{text}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

export function ReaderSurface({
  rows,
  worldTimeDecorations,
  chapterBreaks,
  worldTimeFrame,
  streaming,
  branchKey,
  hasOlder,
  editGate,
  gateReason,
  jumpButtonEnabled,
  systemFixLabel,
  cutOffFixLabel,
  entityNames,
  sceneOptions,
  tailEntryId,
  onNearTop,
  onCommitEdit,
  onRequestRollback,
  onEditWorldTime,
  onRequestEditWorldTime,
  onEditScene,
  onRequestEditScene,
  onRegenerate,
  onRetrySystemEntry,
  onDismissSystemEntry,
  onCopySystemText,
  onFixSystemEntry,
  onFixCutOff,
  onEntryLanded,
  ref,
}: ReaderSurfaceProps & { ref?: Ref<ReaderSurfaceHandle> }) {
  // One window subscription for the whole list. Resolved per card, every row would
  // re-render on every resize frame; here a resize only reaches them across a boundary,
  // where ReaderRow's memo compare stops it.
  const tier = useTier()
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
  // (reader-composer.md → Loaded-set model).
  const landedBranchRef = useRef<string | null>(null)
  const pinActiveRef = useRef(false)
  useEffect(() => {
    setEditingId(null)
    setEditDraft('')
  }, [branchKey])
  // Bottom pin: late layout (font swaps, image decode) can still grow content
  // after a scrollTop write, so re-assert per frame until the scroll height
  // settles. A wheel, touch drag, scrollbar press or upward scroll key breaks it.
  const pinRafRef = useRef(0)
  const stopBottomPin = useCallback(() => {
    pinActiveRef.current = false
    cancelAnimationFrame(pinRafRef.current)
  }, [])
  const startBottomPin = useCallback(() => {
    const el = scrollRef.current
    if (el == null) return
    cancelAnimationFrame(pinRafRef.current)
    pinActiveRef.current = true
    let stableFrames = 0
    let lastHeight = -1
    const assertBottom = () => {
      if (!pinActiveRef.current) return
      el.scrollTop = el.scrollHeight
      stableFrames = el.scrollHeight === lastHeight ? stableFrames + 1 : 0
      lastHeight = el.scrollHeight
      if (stableFrames >= 10) {
        pinActiveRef.current = false
        return
      }
      pinRafRef.current = requestAnimationFrame(assertBottom)
    }
    assertBottom()
  }, [])
  useEffect(() => stopBottomPin, [stopBottomPin])
  // Open-at-bottom. Keyed on hasRows (not rows) so prepends don't cancel a
  // running pin.
  const hasRows = rows.length > 0
  useLayoutEffect(() => {
    if (!hasRows || landedBranchRef.current === branchKey) return
    landedBranchRef.current = branchKey
    startBottomPin()
    return stopBottomPin
  }, [branchKey, hasRows, startBottomPin, stopBottomPin])

  const gestureActiveRef = useRef(false)
  // Set from the jumpToEntry call until the loop ends or a gesture drops it. `running` stays false
  // until a commit brings the row: on native `rows` and the call cross the bridge apart.
  const landingRef = useRef<Landing | null>(null)
  // Callbacks lose identity per emission on native, and the signal fires from a frame loop.
  const onEntryLandedRef = useRef(onEntryLanded)
  useLayoutEffect(() => {
    onEntryLandedRef.current = onEntryLanded
  })
  // The landing the host still waits on: it hears once, on the first landed frame or the drop.
  const unreportedLandingRef = useRef<Landing | null>(null)
  const reportLanded = useCallback(() => {
    const landing = unreportedLandingRef.current
    if (landing == null) return
    unreportedLandingRef.current = null
    void onEntryLandedRef.current(landing.entryId)
  }, [])
  // Event time decides whether a wheel continues its chain; handling time, whether the chain is
  // still arriving. Events queued behind a long commit carry old times yet are still momentum.
  const lastWheelAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastWheelHandledAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastWheelSignRef = useRef(0)

  // A break mounting under a reader at the bottom hides the reply's last lines with no scroll event
  // to raise the jump button. Sits ahead of the anchor rule, whose scrollTop write would skew the
  // distance, and measures the last commit's height, since this commit's already holds the break.
  const lastCommitHeightRef = useRef<number | null>(null)
  const breakKeys = Object.keys(chapterBreaks).join('\n')
  useLayoutEffect(() => {
    const el = scrollRef.current
    const lastCommitHeight = lastCommitHeightRef.current
    if (el == null || lastCommitHeight == null) return
    if (gestureActiveRef.current || landingRef.current != null) return
    if (lastCommitHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM_THRESHOLD_PX) return
    startBottomPin()
  }, [breakKeys, startBottomPin])
  // No deps: rows growing below a reader that doesn't follow move the bottom without a break.
  // A hidden reader's height reads 0, which would pass for a reader at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    lastCommitHeightRef.current =
      el != null && el.getClientRects().length > 0 ? el.scrollHeight : null
  })

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

  const landingRafRef = useRef(0)
  const [landedId, setLandedId] = useState<string | null>(null)
  const stopLanding = useCallback(() => {
    landingRef.current = null
    reportLanded()
    cancelAnimationFrame(landingRafRef.current)
    const el = scrollRef.current
    if (el != null && el.style.overflowY !== '') el.style.overflowY = ''
  }, [reportLanded])
  const startLanding = useCallback(() => {
    const el = scrollRef.current
    const landing = landingRef.current
    if (el == null || landing == null || landing.running) return
    const rowEl = el.querySelector(`[data-entry-row="${CSS.escape(landing.entryId)}"]`)
    if (!(rowEl instanceof HTMLElement)) return
    landing.running = true
    stopBottomPin()
    anchorHoldActiveRef.current = false
    autoscrollRef.current.userInterrupted()
    pendingJumpAtRef.current = 0
    let highlighted = false
    let stableFrames = 0
    let totalFrames = 0
    let lastHeight = -1
    let lastScrollTop: number | null = null
    let movingFrames = 0
    let halting = false
    let halted = false
    let wheelHoldStartedAt: number | null = null
    const assertLanding = () => {
      if (landingRef.current !== landing) return
      // A passive listener can't cancel trackpad momentum, but a hidden scroller takes no wheel:
      // overflow stays hidden for the chain. A halt hides it one frame to drop a fling; the fling's
      // in-flight last delta lands a frame later, so the frame that restores it only observes.
      const now = performance.now()
      const wheelChainLive = now - lastWheelHandledAtRef.current < WHEEL_CHAIN_GAP_MS
      if (wheelChainLive) wheelHoldStartedAt ??= now
      // The row has long since landed; staying on, the halt rule would fight the user's own scroll.
      if (wheelChainLive && now - (wheelHoldStartedAt ?? now) >= WHEEL_HOLD_MAX_MS) {
        stopLanding()
        return
      }
      const overflowY = wheelChainLive ? 'hidden' : ''
      if (el.style.overflowY !== overflowY) el.style.overflowY = overflowY
      // A reload can drop the row, and a detached row's rect would read as a huge delta.
      if (!rowEl.isConnected) {
        stopLanding()
        return
      }
      // Nothing lands in a reader not laid out (under another screen), under a finger, or into a
      // fling, which a write doesn't stop: the position must rest a frame or the fling be halted.
      // None of these frames counts as settled, or the loop would end without having landed.
      const writable = el.getClientRects().length > 0 && !gestureActiveRef.current
      const atRest = lastScrollTop != null && Math.abs(el.scrollTop - lastScrollTop) < 1
      // The reader's own writes move the scroll on one frame; a fling moves it on every frame.
      movingFrames = lastScrollTop != null && !atRest ? movingFrames + 1 : 0
      const canLand = writable && atRest && !halting
      const before = el.scrollTop
      if (canLand) {
        const targetTop = landingElement(rowEl).getBoundingClientRect().top
        const deltaPx = targetTop - el.getBoundingClientRect().top - JUMP_LANDING_GAP_PX
        if (Math.abs(deltaPx) >= 1) el.scrollTop += deltaPx
        // The fade's clock starts here, so a delayed landing can't spend it on a row off screen.
        if (!highlighted) {
          highlighted = true
          setLandedId(landing.entryId)
          // Once painted; a newer jump in between has already reported this one as dropped.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (unreportedLandingRef.current === landing) reportLanded()
            }),
          )
        }
      }
      // Read back: the browser clamps the write at either end, and a clamped write moved nothing.
      const after = el.scrollTop
      lastScrollTop = writable ? after : null
      // One halt: should a fling outlive it, the loop waits for rest rather than fight it.
      halting = writable && !halted && movingFrames >= 2
      if (halting) {
        halted = true
        el.style.overflowY = 'hidden'
      }
      const height = el.scrollHeight
      // A frame the loop had to correct hasn't settled: a fling's sub-pixel tail reads as rest. Nor
      // has one inside a chain, whose next wheel would scroll the reader once the loop let go.
      const settled =
        canLand && !wheelChainLive && Math.abs(after - before) < 1 && height === lastHeight
      stableFrames = settled ? stableFrames + 1 : 0
      lastHeight = height
      totalFrames += 1
      if (stableFrames >= LANDING_SETTLED_FRAMES || totalFrames >= LANDING_MAX_FRAMES) {
        stopLanding()
        return
      }
      landingRafRef.current = requestAnimationFrame(assertLanding)
    }
    assertLanding()
  }, [reportLanded, stopBottomPin, stopLanding])
  const jumpToEntry = useCallback(
    (entryId: string) => {
      // Reports a replaced target as dropped before the new one becomes the unreported one.
      stopLanding()
      const landing = { entryId, running: false }
      unreportedLandingRef.current = landing
      landingRef.current = landing
      startLanding()
    },
    [startLanding, stopLanding],
  )
  useLayoutEffect(() => {
    stopLanding()
    setLandedId(null)
  }, [branchKey, stopLanding])
  // After the anchor rule's effect, on its keys: landing cancels any hold that effect just started.
  // One rule per frame; a landing is measured from the row, so it needs no compensation of its own.
  useLayoutEffect(() => {
    if (landingRef.current == null) return
    anchorHoldActiveRef.current = false
    startLanding()
  }, [rows, hasOlder, startLanding])
  useEffect(() => {
    if (landedId == null) return
    const timer = setTimeout(() => setLandedId(null), LANDED_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [landedId])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const metrics = computeScrollMetrics(event.currentTarget)
      lastDistanceRef.current = metrics.distanceFromBottomPx
      // A jump disengages autoscroll until its landing ends, wherever the scroll passes meanwhile.
      const landing = landingRef.current
      if (landing != null && landing.running) autoscrollRef.current.userInterrupted()
      else
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
  // bottom pin — the user has taken over.
  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      // The native event's own time: events queued behind a long commit still read a frame apart.
      // React's synthetic timeStamp can fall back to Date.now(), another clock.
      const at = event.nativeEvent.timeStamp
      const continuesChain = at - lastWheelAtRef.current < WHEEL_CHAIN_GAP_MS
      lastWheelAtRef.current = at
      lastWheelHandledAtRef.current = performance.now()
      const sign = Math.sign(event.deltaY)
      // Momentum never reverses, so a wheel the other way is the user's own.
      const reverses =
        sign !== 0 && lastWheelSignRef.current !== 0 && sign !== lastWheelSignRef.current
      if (sign !== 0) lastWheelSignRef.current = sign
      stopBottomPin()
      // A chain's first event drops a landing; the rest are its momentum, which a running landing
      // holds off by hiding the reader's overflow until they stop.
      if (!continuesChain || reverses) stopLanding()
      anchorHoldActiveRef.current = false
      if (event.deltaY < 0) autoscrollRef.current.userInterrupted()
    },
    [stopBottomPin, stopLanding],
  )

  // A scrollbar press or an upward scroll key moves the view less than the at-bottom band, so
  // without this the bottom pin or the next chunk's re-pin pulls it straight back.
  const interruptByGesture = useCallback(() => {
    stopBottomPin()
    stopLanding()
    anchorHoldActiveRef.current = false
    autoscrollRef.current.userInterrupted()
  }, [stopBottomPin, stopLanding])
  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const el = event.currentTarget
      const press = { onScroller: event.target === el, offsetX: event.nativeEvent.offsetX }
      const overflows = el.scrollHeight > el.clientHeight
      if (isScrollbarPress({ ...press, clientWidth: el.clientWidth, overflows }))
        interruptByGesture()
    },
    [interruptByGesture],
  )
  useEffect(() => {
    const el = scrollRef.current
    if (el == null) return
    const doc = el.ownerDocument
    // On the document, not the scroller: with nothing focused the key lands on the body yet still
    // scrolls the scroller last pressed, which may be another one (the rail list).
    let pressedInside = false
    const onPointerDown = (event: Event) => {
      pressedInside = event.target instanceof Node && el.contains(event.target)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const upward = isUpwardScrollKey(event)
      // A reader left mounted under another screen isn't laid out, and the key isn't its.
      if (
        event.defaultPrevented ||
        !(upward || isDownwardScrollKey(event)) ||
        el.getClientRects().length === 0
      )
        return
      const target = event.target
      if (!(target instanceof Node) || isEditableTarget(target)) return
      if (!(target === doc.body ? pressedInside : el.contains(target))) return
      // Down leaves autoscroll engaged, but a landing sits mid-document, where down still moves it.
      if (upward) interruptByGesture()
      else stopLanding()
    }
    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.addEventListener('keydown', onKeyDown)
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('keydown', onKeyDown)
    }
  }, [interruptByGesture, stopLanding])

  // Touch drags interrupt like native drag-begin did — keyed off the first
  // touchmove, not touchstart, so plain taps can't disengage a pinned stream.
  const handleTouchStart = useCallback(() => {
    gestureActiveRef.current = true
  }, [])
  const handleTouchMove = useCallback(() => {
    stopBottomPin()
    stopLanding()
    anchorHoldActiveRef.current = false
    if (touchInterruptedRef.current) return
    touchInterruptedRef.current = true
    autoscrollRef.current.userInterrupted()
  }, [stopBottomPin, stopLanding])
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
        // The committed row that replaces the streaming card is taller (its
        // footer); hold an engaged reader at the bottom through the swap.
        const engaged = machine.state === 'engaged'
        machine.streamEnded()
        if (engaged) startBottomPin()
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
  }, [streaming, startBottomPin])

  // A viewport shrinking under a reader at the bottom would otherwise hide the newest lines.
  useEffect(() => {
    const el = scrollRef.current
    if (el == null) return
    let lastClientHeight = el.clientHeight
    const observer = new ResizeObserver(() => {
      const previousClientHeight = lastClientHeight
      lastClientHeight = el.clientHeight
      if (el.clientHeight >= previousClientHeight || gestureActiveRef.current) return
      // Pinning the bottom under an in-row editor would push it up under the top, yet the Android
      // keyboard can still hide it, which its WebView never scrolls into view: bring the editor's
      // row, Save included, just into view. hasFocus: a tap on the native composer leaves
      // activeElement on an open editor.
      const doc = el.ownerDocument
      const active = doc.activeElement
      if (active instanceof HTMLTextAreaElement && el.contains(active) && doc.hasFocus()) {
        const row = active.closest('[data-entry-row]') ?? active
        const hiddenPx = row.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom
        if (hiddenPx > 0) el.scrollTop += hiddenPx
        return
      }
      // Read from geometry, not lastDistanceRef: content can grow below without a scroll
      // event, and a shrink never clamps scrollTop.
      const distanceBeforePx = el.scrollHeight - el.scrollTop - previousClientHeight
      if (distanceBeforePx > NEAR_BOTTOM_THRESHOLD_PX) return
      el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const jumpToBottom = useCallback(() => {
    // Cancel any active bottom pin / anchor-hold loop first: otherwise a hold
    // spawned by a just-fired boundary prepend keeps yanking scrollTop toward
    // the top anchor while this animates to the bottom, and they fight.
    stopBottomPin()
    stopLanding()
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
  }, [stopBottomPin, stopLanding])
  useImperativeHandle(ref, () => ({ jumpToBottom, jumpToEntry }), [jumpToBottom, jumpToEntry])

  const startEdit = useCallback((row: StoryEntry) => {
    setEditingId(row.id)
    setEditDraft(row.content)
  }, [])
  // Shared by both commit buttons so the refusal policy has one home: a
  // rejected commit keeps the draft open so typing isn't silently lost, and
  // the host owns the error toast.
  const commitDraft = useCallback(async (): Promise<boolean> => {
    const id = editingIdRef.current
    if (id == null) return false
    const result = await onCommitEdit(id, editDraftRef.current)
    if (!result?.ok) return false
    setEditingId(null)
    setEditDraft('')
    return true
  }, [onCommitEdit])
  const commitEdit = useCallback(async () => {
    await commitDraft()
  }, [commitDraft])
  const commitEditAndRegen = useCallback(
    async (replyId: string) => {
      if (!(await commitDraft())) return
      // Regenerate second: the pipeline re-reads its prompt from the branch tail,
      // so the edit has to be committed before the run starts to be the one it reads.
      await onRegenerate(replyId)
    },
    [commitDraft, onRegenerate],
  )
  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])
  const headTurn = useMemo(() => resolveSaveAndRegenTurn(rows, tailEntryId), [rows, tailEntryId])
  const headTurnIds = useMemo(() => headTurnIdsOf(rows, tailEntryId), [rows, tailEntryId])

  return (
    <div className="relative h-full">
      {/* Stable gutter: a landing's halt hides overflow; a lost scrollbar reflows every row. */}
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]"
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
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
        {rows.map((row) => {
          const decoration = worldTimeDecorations[row.id]
          const flags = rowReversalFlags({ rowId: row.id, headTurnIds, editGate })
          const chapterBreak = chapterBreaks[row.id]
          return (
            <Fragment key={row.id}>
              <div
                data-entry-row={row.id}
                data-landed={row.id === landedId ? true : undefined}
                style={row.id === landedId ? LANDED_ROW_STYLE : undefined}
                className={ROW_FRAME_CLASS}
              >
                <ReaderRow
                  row={row}
                  tier={tier}
                  editing={editingId === row.id}
                  editContent={editingId === row.id ? editDraft : null}
                  editBlocked={editGate !== 'open'}
                  editDisabled={flags.editDisabled}
                  reversalDisabled={flags.reversalDisabled}
                  disabledReason={gateReason}
                  systemFixLabel={systemFixLabel}
                  cutOffFixLabel={cutOffFixLabel}
                  worldTimeLabel={decoration?.label}
                  worldTimeRaw={decoration?.raw}
                  worldTimeBreakPreviousLabel={decoration?.previousLabel}
                  worldTimeFrame={worldTimeFrame}
                  onEditWorldTime={onEditWorldTime}
                  onRequestEditWorldTime={onRequestEditWorldTime}
                  entityNames={entityNames}
                  sceneOptions={sceneOptions}
                  isTail={row.id === tailEntryId}
                  onEditScene={onEditScene}
                  onRequestEditScene={onRequestEditScene}
                  onStartEdit={startEdit}
                  onContentChange={setEditDraft}
                  onCommitEdit={commitEdit}
                  regenTargetId={row.id === headTurn?.originId ? headTurn.replyId : null}
                  onCommitEditAndRegen={commitEditAndRegen}
                  onCancelEdit={cancelEdit}
                  onRequestRollback={onRequestRollback}
                  onRegenerate={onRegenerate}
                  onFixSystemEntry={onFixSystemEntry}
                  onFixCutOff={onFixCutOff}
                  onRetrySystemEntry={onRetrySystemEntry}
                  onDismissSystemEntry={onDismissSystemEntry}
                  onCopySystemText={onCopySystemText}
                />
              </div>
              {chapterBreak != null ? <ChapterBreakRule {...chapterBreak} /> : null}
            </Fragment>
          )
        })}
        {streaming != null ? (
          <div className={ROW_FRAME_CLASS}>
            <EntryCard
              kind="streaming"
              tier={tier}
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
