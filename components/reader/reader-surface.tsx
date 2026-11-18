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
  createLandingMachine,
  isDownwardScrollKey,
  isScrollbarPress,
  isUpwardScrollKey,
  rowAtOffset,
  WHEEL_CHAIN_GAP_MS,
} from '@/lib/reader-scroll'

import type { ChapterBreak } from './chapter-breaks'
import { keptSubmissionText } from './composer-draft'
import type {
  EditResult,
  EditSession,
  ReaderSurfaceHandle,
  ReaderSurfaceProps,
} from './reader-document-types'
import { SLICE_CAP } from './reader-slice'
import { headTurnIdsOf, rowReversalFlags } from './row-reversal-flags'
import { resolveSaveAndRegenTurn } from './save-and-regen'
import type { ResolvedEntity } from './scene-editing'
import { changeAbove, composeHeld, sliceFieldsOf } from './slice-hold'

const NEAR_BOTTOM_THRESHOLD_PX = 20
const JUMP_TO_BOTTOM_SETTLE_MS = 500
// Scroll events this far apart, with no finger down, are a reader at rest.
const REST_MS = 150
const JUMP_LANDING_GAP_PX = 12
const LANDED_HIGHLIGHT_MS = 1_500
// Custom properties inherit; the card's animation can't read the wrapper's animation-duration.
const LANDED_ROW_STYLE = { '--reader-landed-ms': `${LANDED_HIGHLIGHT_MS}ms` } as CSSProperties

// No content-visibility culling: placeholder heights settling shifted content under the finger
// (device-observed; no scroll anchoring here). A slice of at most SLICE_CAP rows lays out in full.
const ROW_FRAME_CLASS = 'mx-auto w-full max-w-[860px] px-7 py-2'

/** A jump held until the document has committed a slice at `key` or past it. */
type Landing = { entryId: string; key: number; running: boolean }

/**
 * The topmost viewport row plus every row's id and offset, and the scrollTop they were read at: a
 * shrinking commit clamps scrollTop before the anchor rule runs, so it compensates from this one.
 */
type AnchorMemo = {
  branchKey: string
  index: number
  ids: string[]
  tops: number[]
  scrollTop: number
}

const rowElementsOf = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-entry-row]'))

// Scroll-independent content offset: rows and the scroller share an offset parent.
const contentTop = (el: HTMLElement, rowEl: HTMLElement) => rowEl.offsetTop - el.offsetTop

// Branch copies share entry ids, so the memo names its branch.
function readAnchor(el: HTMLElement, rowEls: HTMLElement[], branchKey: string): AnchorMemo | null {
  const tops = rowEls.map((rowEl) => contentTop(el, rowEl))
  const index = rowAtOffset(rowEls.length, (i) => tops[i] + rowEls[i].offsetHeight, el.scrollTop)
  if (index == null) return null
  const ids = rowEls.map((rowEl) => rowEl.dataset.entryRow ?? '')
  return { branchKey, index, ids, tops, scrollTop: el.scrollTop }
}

/** The row at content offset `y`: a trim's keep row, one viewport-height past the viewport. */
function rowIdAt(el: HTMLElement, y: number): string | null {
  const rowEls = rowElementsOf(el)
  const index = rowAtOffset(
    rowEls.length,
    (i) => contentTop(el, rowEls[i]) + rowEls[i].offsetHeight,
    y,
  )
  return index == null ? null : (rowEls[index].dataset.entryRow ?? null)
}

function shallowEqualProps(a: object, b: object): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

// A key typed into a field moves its caret, not the reader.
function isEditableTarget(target: Node): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

const isLandedFade = (animation: Animation): boolean =>
  animation instanceof CSSAnimation && animation.animationName.startsWith('reader-card-landed')

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
  /** Another entry's editor is open: this row's actions wait on it. */
  held: boolean
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
  /** This row is in the host's C10 table; a flag rather than the table keeps the memo holding. */
  closeHere: boolean
  onCloseChapterHere: (entryId: string) => Promise<void>
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
  held,
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
  closeHere,
  onCloseChapterHere,
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
      replyEstimate={row.kind === 'ai_reply' ? (row.contentTokens ?? undefined) : undefined}
      reasoning={row.metadata?.reasoning}
      disabled={editBlocked}
      disabledReason={disabledReason}
      editDisabled={editDisabled}
      reversalDisabled={reversalDisabled}
      held={held}
      heldReason={held ? t('reader:editFocus.held') : undefined}
      editing={editing}
      contentEditNotice={contentEditNotice ?? undefined}
      editDirty={editing && editContent !== row.content}
      onEdit={isSystem ? undefined : () => onStartEdit(row)}
      onRegen={row.kind === 'ai_reply' ? () => void onRegenerate(row.id) : undefined}
      onCloseChapterHere={closeHere ? () => void onCloseChapterHere(row.id) : undefined}
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
      promptSections={isSystem ? row.metadata?.systemFailure?.promptSections : undefined}
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

// Permanent while rows may exist past this edge: one that mounted mid-scroll would shift content.
function BoundaryShimmer() {
  return (
    <div aria-hidden className={ROW_FRAME_CLASS}>
      <div className="rounded-lg border border-border bg-bg-raised p-4">
        <Skeleton className="mb-3 h-4 w-24" />
        <Skeleton className="mb-2 h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  )
}

function ChapterBreakRule({ number, timeLabel }: ChapterBreak) {
  const text =
    timeLabel != null
      ? t('chapters:labelWithTime', { number, time: timeLabel })
      : t('chapters:label', { number })
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
  ref,
  ...incoming
}: ReaderSurfaceProps & { ref?: Ref<ReaderSurfaceHandle> }) {
  // Renders from `shown`, the props as last adopted (reader-document.md → Entry list). Adopting in
  // a layout effect lets the hold decision read the DOM the change would move.
  const [shown, setShown] = useState<ReaderSurfaceProps>(incoming)
  const {
    rows,
    worldTimeDecorations,
    chapterBreaks,
    closeHereEntryIds,
    worldTimeFrame,
    streaming,
    branchKey,
    hasOlder,
    hasNewer,
    sliceKey,
    editGate,
    gateReason,
    jumpButtonEnabled,
    systemFixLabel,
    cutOffFixLabel,
    entityNames,
    sceneOptions,
    tailEntryId,
    onCommitEdit,
    onRequestRollback,
    onEditWorldTime,
    onRequestEditWorldTime,
    onEditScene,
    onRequestEditScene,
    onRegenerate,
    onCloseChapterHere,
    onRetrySystemEntry,
    onDismissSystemEntry,
    onCopySystemText,
    onFixSystemEntry,
    onFixCutOff,
    onEntryLanded,
    onEditSession,
  } = shown
  const shownRef = useRef(shown)
  useLayoutEffect(() => {
    shownRef.current = shown
  })
  // One window subscription for the whole list. Resolved per card, every row would
  // re-render on every resize frame; here a resize only reaches them across a boundary,
  // where ReaderRow's memo compare stops it.
  const tier = useTier()
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoscrollRef = useRef(createAutoscrollMachine())
  const lastDistanceRef = useRef(0)
  const pendingJumpAtRef = useRef(0)
  const streamActiveRef = useRef(false)
  const touchInterruptedRef = useRef(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  // Content growing below a reader that doesn't follow fires no scroll event to raise the button.
  const syncJumpButton = useCallback(() => {
    const el = scrollRef.current
    if (el == null || el.getClientRects().length === 0) return
    setShowJumpToBottom(computeScrollMetrics(el).distanceFromBottomPx > NEAR_BOTTOM_THRESHOLD_PX)
  }, [])

  // Boundary requests, trims and held changes all wait for rest; whatever may have work re-arms it.
  const gestureActiveRef = useRef(false)
  const lastScrollAtRef = useRef(Number.NEGATIVE_INFINITY)
  const midGesture = useCallback(
    () => gestureActiveRef.current || performance.now() - lastScrollAtRef.current < REST_MS,
    [],
  )
  const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRestRef = useRef<() => void>(() => {})
  const armRest = useCallback(() => {
    if (restTimerRef.current != null) clearTimeout(restTimerRef.current)
    restTimerRef.current = setTimeout(() => {
      restTimerRef.current = null
      onRestRef.current()
    }, REST_MS)
  }, [])
  useEffect(
    () => () => {
      if (restTimerRef.current != null) clearTimeout(restTimerRef.current)
    },
    [],
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  // Mirror edit state into refs so commitEdit stays referentially stable across
  // keystrokes — a changing commit callback would defeat the row memo.
  const editingIdRef = useRef<string | null>(null)
  const editDraftRef = useRef('')
  editingIdRef.current = editingId
  editDraftRef.current = editDraft
  // From the props, not `shown`: a row coming back above a held anchor is the host's already, and
  // the editor's row outside the slice rides beside it as `editingRow`.
  const { rows: liveRows, editingRow } = incoming
  const editingStored = useMemo(() => {
    if (editingId == null) return undefined
    const live = liveRows.find((row) => row.id === editingId)
    if (live != null) return live.content
    return editingRow?.id === editingId ? editingRow.content : undefined
  }, [liveRows, editingRow, editingId])
  const editingStoredRef = useRef<string | undefined>(undefined)
  editingStoredRef.current = editingStored
  const editDirty = editingId != null && editDraft !== editingStored

  // A row leaving the loaded set by a path no user action takes drops its draft, so a redo that
  // restores the row shows the row, not the old editor. Leaving only the slice keeps it.
  const editingRowLoaded = editingId == null || editingStored !== undefined
  useEffect(() => {
    if (editingRowLoaded) return
    setEditingId(null)
    setEditDraft('')
  }, [editingRowLoaded])

  // Transitions only: the host arms its leave guard from these, and on native each one crosses
  // the bridge, so a keystroke that doesn't flip dirty sends nothing.
  const onEditSessionRef = useRef(onEditSession)
  useLayoutEffect(() => {
    onEditSessionRef.current = onEditSession
  })
  const reportedEntryId = editingRowLoaded ? editingId : null
  useEffect(() => {
    void onEditSessionRef.current(
      reportedEntryId == null ? null : { entryId: reportedEntryId, dirty: editDirty },
    )
  }, [reportedEntryId, editDirty])

  // Branch switch: new window, scrolled to bottom, edit state dropped
  // (reader-composer.md → Loaded-set model).
  const landedBranchRef = useRef<string | null>(null)
  const pinActiveRef = useRef(false)
  useEffect(() => {
    setEditingId(null)
    setEditDraft('')
  }, [branchKey])
  // The anchor rule's hold loop; every other writer that moves the reader stops it.
  const anchorHoldActiveRef = useRef(false)
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
    anchorHoldActiveRef.current = false
    let stableFrames = 0
    let lastHeight = -1
    const assertBottom = () => {
      if (!pinActiveRef.current) return
      el.scrollTop = el.scrollHeight
      stableFrames = el.scrollHeight === lastHeight ? stableFrames + 1 : 0
      lastHeight = el.scrollHeight
      if (stableFrames >= 10) {
        pinActiveRef.current = false
        armRest()
        return
      }
      pinRafRef.current = requestAnimationFrame(assertBottom)
    }
    assertBottom()
  }, [armRest])
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

  // Set from the jumpToEntry call until the loop ends or a gesture drops it. `running` stays false
  // until a commit at the landing's key brings the row: on native `rows` and the call cross apart.
  const landingRef = useRef<Landing | null>(null)
  // A Jump to bottom whose slice hasn't been committed yet: it lands once one at its key has.
  const pendingBottomRef = useRef<number | null>(null)
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

  // A close's break (under a row the last commit showed; with its rows, it's the slice moving)
  // hides a bottom reader's last lines without a scroll event. Ahead of the anchor rule (its write
  // skews the distance), on the last commit's pre-break height; short of the tail, no bottom.
  const lastCommitHeightRef = useRef<number | null>(null)
  const lastCommitRowIdsRef = useRef<ReadonlySet<string>>(new Set())
  const lastCommitBreakIdsRef = useRef<ReadonlySet<string>>(new Set())
  const breakKeys = Object.keys(chapterBreaks).join('\n')
  useLayoutEffect(() => {
    const el = scrollRef.current
    const lastCommitHeight = lastCommitHeightRef.current
    if (el == null || lastCommitHeight == null || shownRef.current.hasNewer) return
    const lastRowIds = lastCommitRowIdsRef.current
    const lastBreakIds = lastCommitBreakIdsRef.current
    const closed = breakKeys
      .split('\n')
      .some((id) => id !== '' && !lastBreakIds.has(id) && lastRowIds.has(id))
    if (!closed || gestureActiveRef.current || landingRef.current != null) return
    if (lastCommitHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM_THRESHOLD_PX) return
    startBottomPin()
  }, [breakKeys, startBottomPin])
  // No deps: rows growing below a reader that doesn't follow move the bottom without a break.
  // A hidden reader's height reads 0, which would pass for a reader at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    lastCommitHeightRef.current =
      el != null && el.getClientRects().length > 0 ? el.scrollHeight : null
    lastCommitRowIdsRef.current = new Set(shownRef.current.rows.map((row) => row.id))
    lastCommitBreakIdsRef.current = new Set(Object.keys(shownRef.current.chapterBreaks))
  })

  // The one anchor rule (reader-document.md → Entry list): the memo row's, or nearest survivor's,
  // offset delta, then a hold against late layout. A scroll drops the memo: no commit undoes one.
  const anchorMemoRef = useRef<AnchorMemo | null>(null)
  // The anchor rule's last scrollTop write: its scroll event is the reader's own, not the user's
  // (reader-composer.md → Autoscroll), so it moves neither autoscroll nor the memo.
  const anchorWriteRef = useRef<number | null>(null)
  const anchorHoldRafRef = useRef(0)
  useEffect(() => () => cancelAnimationFrame(anchorHoldRafRef.current), [])
  const recordAnchor = useCallback(() => {
    const el = scrollRef.current
    if (el == null || el.getClientRects().length === 0) return
    anchorMemoRef.current = readAnchor(el, rowElementsOf(el), shownRef.current.branchKey)
  }, [])
  // Marks a write as the reader's own only if it moved the scroll: a clamped one fires no event.
  const writeAnchorScroll = useCallback((el: HTMLElement, top: number) => {
    const before = el.scrollTop
    el.scrollTop = top
    if (el.scrollTop !== before) anchorWriteRef.current = el.scrollTop
  }, [])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el == null || el.getClientRects().length === 0) return
    const rowEls = rowElementsOf(el)
    const memo = anchorMemoRef.current
    const { branchKey: shownBranch } = shownRef.current
    // A running landing or bottom pin wins: each places the reader by its own measure.
    const placed = landingRef.current?.running === true || pinActiveRef.current
    if (memo != null && memo.branchKey === shownBranch && !placed) {
      const now = new Map(rowEls.map((rowEl) => [rowEl.dataset.entryRow, rowEl]))
      let anchor: { el: HTMLElement; deltaPx: number } | null = null
      for (let step = 0; anchor == null && step < memo.ids.length; step += 1) {
        for (const i of step === 0 ? [memo.index] : [memo.index - step, memo.index + step]) {
          const rowEl = i >= 0 && i < memo.ids.length ? now.get(memo.ids[i]) : undefined
          if (rowEl != null) {
            anchor = { el: rowEl, deltaPx: contentTop(el, rowEl) - memo.tops[i] }
            break
          }
        }
      }
      if (anchor != null && anchor.deltaPx !== 0) {
        // Content that shrank under a reader at the bottom has clamped scrollTop already; any
        // other change since the memo is the reader's own write, which stands.
        const clamped =
          el.scrollTop < memo.scrollTop && el.scrollTop >= el.scrollHeight - el.clientHeight - 1
        const base = clamped ? memo.scrollTop : el.scrollTop
        writeAnchorScroll(el, Math.max(0, base + anchor.deltaPx))
        const anchorEl = anchor.el
        const targetTop = anchorEl.getBoundingClientRect().top
        cancelAnimationFrame(anchorHoldRafRef.current)
        anchorHoldActiveRef.current = true
        let stableFrames = 0
        let totalFrames = 0
        const hold = () => {
          if (!anchorHoldActiveRef.current || !anchorEl.isConnected) return
          // scrollTop writes round: without the 1px floor, sub-pixel drift spins this to the cap.
          const drift = anchorEl.getBoundingClientRect().top - targetTop
          if (Math.abs(drift) >= 1) {
            writeAnchorScroll(el, el.scrollTop + drift)
            stableFrames = 0
          } else {
            stableFrames += 1
          }
          totalFrames += 1
          if (stableFrames >= 10 || totalFrames >= 120) {
            anchorHoldActiveRef.current = false
            return
          }
          anchorHoldRafRef.current = requestAnimationFrame(hold)
        }
        anchorHoldRafRef.current = requestAnimationFrame(hold)
      }
    }
    anchorMemoRef.current = readAnchor(el, rowEls, shownBranch)
  }, [shown, writeAnchorScroll])

  // After the anchor rule. Mid-gesture, a change above the anchor row (rows, breaks, top shimmer)
  // holds that part until rest; below stays live. A jump's slice and a branch switch never wait.
  const incomingRef = useRef(incoming)
  const sourceRef = useRef(incoming)
  const heldRef = useRef(false)
  const adoptHeld = useCallback(() => {
    if (!heldRef.current) return false
    heldRef.current = false
    sourceRef.current = incomingRef.current
    setShown(incomingRef.current)
    return true
  }, [])
  useLayoutEffect(() => {
    incomingRef.current = incoming
    const source = sourceRef.current
    // Every render hands a fresh rest object; only a real props change is news.
    if (incoming === source || shallowEqualProps(incoming, source)) {
      sourceRef.current = incoming
      return
    }
    sourceRef.current = incoming
    heldRef.current = false
    // The row the reader is on, before the change moves anything.
    recordAnchor()
    const current = shownRef.current
    const landing = landingRef.current
    const pendingBottom = pendingBottomRef.current
    const jumpsHere =
      (landing != null && incoming.sliceKey >= landing.key) ||
      (pendingBottom != null && incoming.sliceKey >= pendingBottom)
    const anchorId = anchorMemoRef.current?.ids[anchorMemoRef.current.index]
    if (
      incoming.branchKey !== current.branchKey ||
      jumpsHere ||
      anchorId == null ||
      !midGesture()
    ) {
      setShown(incoming)
      return
    }
    const change = changeAbove(current, incoming, anchorId)
    if (change === 'none') {
      setShown(incoming)
      return
    }
    heldRef.current = true
    armRest()
    setShown({
      ...incoming,
      ...(change === 'anchorGone'
        ? sliceFieldsOf(current, incoming)
        : composeHeld(current, incoming, anchorId)),
    })
  }, [incoming, midGesture, armRest, recordAnchor])

  const landingRafRef = useRef(0)
  // A fresh object per landing, so a repeat landing on the same row restarts the clear timer.
  const [landed, setLanded] = useState<{ entryId: string } | null>(null)
  const landedId = landed?.entryId ?? null
  const stopLanding = useCallback(() => {
    landingRef.current = null
    pendingBottomRef.current = null
    reportLanded()
    cancelAnimationFrame(landingRafRef.current)
    const el = scrollRef.current
    if (el != null && el.style.overflowY !== '') el.style.overflowY = ''
    armRest()
  }, [armRest, reportLanded])
  const startLanding = useCallback(() => {
    const el = scrollRef.current
    const landing = landingRef.current
    if (el == null || landing == null || landing.running) return
    // The slice the jump moved to: the one it is leaving may lack the row above, or the row.
    if (landing.key > shownRef.current.sliceKey) return
    const rowEl = el.querySelector(`[data-entry-row="${CSS.escape(landing.entryId)}"]`)
    if (!(rowEl instanceof HTMLElement)) return
    landing.running = true
    stopBottomPin()
    anchorHoldActiveRef.current = false
    autoscrollRef.current.userInterrupted()
    pendingJumpAtRef.current = 0
    const machine = createLandingMachine()
    const assertLanding = () => {
      if (landingRef.current !== landing) return
      // A passive listener can't cancel trackpad momentum, but a hidden scroller takes no wheel:
      // overflow stays hidden for the chain. A halt hides it one frame to drop a fling; the fling's
      // in-flight last delta lands a frame later, so the frame that restores it only observes.
      const now = performance.now()
      const step = machine.plan({
        now,
        wheelChainLive: now - lastWheelHandledAtRef.current < WHEEL_CHAIN_GAP_MS,
        rowConnected: rowEl.isConnected,
        laidOut: el.getClientRects().length > 0,
        fingerDown: gestureActiveRef.current,
        scrollTop: el.scrollTop,
      })
      if (step.kind === 'stop') {
        stopLanding()
        return
      }
      if (el.style.overflowY !== step.overflowY) el.style.overflowY = step.overflowY
      if (step.land) {
        const targetTop = landingElement(rowEl).getBoundingClientRect().top
        const deltaPx = targetTop - el.getBoundingClientRect().top - JUMP_LANDING_GAP_PX
        if (Math.abs(deltaPx) >= 1) el.scrollTop += deltaPx
      }
      // The fade's clock starts here, so a delayed landing can't spend it on a row off screen.
      if (step.highlight) {
        setLanded({ entryId: landing.entryId })
        // A row still tinted keeps its attribute, so CSS alone wouldn't replay its fade.
        for (const animation of rowEl.querySelector('.reader-entry-card')?.getAnimations() ?? [])
          if (isLandedFade(animation)) animation.currentTime = 0
        // Once painted; a newer jump in between has already reported this one as dropped.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (unreportedLandingRef.current === landing) reportLanded()
          }),
        )
      }
      // Read back: the browser clamps the write at either end, and a clamped write moved nothing.
      const after = el.scrollTop
      syncJumpButton()
      const settle = machine.settle({ after, scrollHeight: el.scrollHeight })
      if (settle.haltOverflow) el.style.overflowY = 'hidden'
      if (settle.done) {
        stopLanding()
        return
      }
      landingRafRef.current = requestAnimationFrame(assertLanding)
    }
    assertLanding()
  }, [reportLanded, stopBottomPin, stopLanding, syncJumpButton])
  const jumpToEntry = useCallback(
    (entryId: string, key: number) => {
      // Reports a replaced target as dropped before the new one becomes the unreported one. A
      // repeat of it isn't reported: the host's veil waits on that id until the new one lands.
      if (unreportedLandingRef.current?.entryId === entryId) unreportedLandingRef.current = null
      stopLanding()
      const landing = { entryId, key, running: false }
      unreportedLandingRef.current = landing
      landingRef.current = landing
      // A jump halts momentum, so a change held for rest is taken now; its commit lands the row.
      if (adoptHeld()) return
      startLanding()
    },
    [adoptHeld, startLanding, stopLanding],
  )
  useLayoutEffect(() => {
    stopLanding()
    setLanded(null)
  }, [branchKey, stopLanding])

  const landAtBottom = useCallback(() => {
    startBottomPin()
    lastDistanceRef.current = 0
    pendingJumpAtRef.current = Date.now()
    if (streamActiveRef.current) autoscrollRef.current.streamStarted({ distanceFromBottomPx: 0 })
    else autoscrollRef.current.autoscrollApplied({ distanceFromBottomPx: 0 })
  }, [startBottomPin])
  // After the anchor rule, per adopted slice: a waiting jump lands, cancelling the rule's hold (one
  // rule per frame). A landing whose slice lacks its row drops, or it would hold every trim back.
  useLayoutEffect(() => {
    const bottomKey = pendingBottomRef.current
    if (bottomKey != null && sliceKey >= bottomKey) {
      pendingBottomRef.current = null
      // Nothing was rendered between: no animation, the bottom pin absorbs the rows' late layout.
      if (!hasNewer) landAtBottom()
    }
    const landing = landingRef.current
    if (landing == null || landing.running || sliceKey < landing.key) return
    if (!rows.some((row) => row.id === landing.entryId)) {
      stopLanding()
      return
    }
    anchorHoldActiveRef.current = false
    startLanding()
  }, [rows, hasOlder, hasNewer, sliceKey, landAtBottom, startLanding, stopLanding])
  useEffect(() => {
    if (landed == null) return
    const timer = setTimeout(() => setLanded(null), LANDED_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [landed])

  // A request the host hasn't answered yet: the next rest waits for it or a new slice.
  const requestInFlightRef = useRef<object | null>(null)
  useLayoutEffect(() => {
    requestInFlightRef.current = null
  }, [sliceKey])
  // Keyed on sliceKey, not rows: a turn's trim waits for a scroll's rest, else its compensating
  // write could lift a bottom reader between the user's row and the reply, disengaging the stream.
  useLayoutEffect(() => {
    armRest()
  }, [sliceKey, armRest])

  // A held change adopts first and its commit re-arms rest, so a request measures the host's slice.
  // Extensions and trims fire only here: their compensating write never fights compositor scroll.
  const onRest = useCallback(() => {
    if (midGesture()) return
    if (landingRef.current != null || pendingBottomRef.current != null) return
    if (pinActiveRef.current) return
    const el = scrollRef.current
    if (el == null || el.getClientRects().length === 0) return
    // Before adopting: the gesture's scrolls dropped the memo the held change would compensate by.
    recordAnchor()
    if (adoptHeld()) return
    if (requestInFlightRef.current != null) return
    const current = shownRef.current
    const send = (request: Promise<void>) => {
      // Its own token: an older answer, landing after a new key's request, mustn't free that one.
      const token = {}
      requestInFlightRef.current = token
      const settle = () => {
        if (requestInFlightRef.current === token) requestInFlightRef.current = null
      }
      void request.then(settle, settle)
    }
    const metrics = computeScrollMetrics(el)
    const keepTop = () => rowIdAt(el, el.scrollTop - el.clientHeight)
    const keepBottom = () => rowIdAt(el, el.scrollTop + 2 * el.clientHeight)
    if (current.hasOlder && metrics.withinTopViewport) {
      const keepId = keepBottom()
      if (keepId != null) send(current.onNearTop({ sliceKey: current.sliceKey, keepId }))
    } else if (current.hasNewer && metrics.withinBottomViewport) {
      const keepId = keepTop()
      if (keepId != null) send(current.onNearBottom({ sliceKey: current.sliceKey, keepId }))
    } else if (current.rows.length > SLICE_CAP) {
      const end = el.scrollTop > metrics.distanceFromBottomPx ? 'top' : 'bottom'
      const keepId = end === 'top' ? keepTop() : keepBottom()
      if (keepId != null) send(current.onTrim({ end, sliceKey: current.sliceKey, keepId }))
    }
  }, [adoptHeld, midGesture, recordAnchor])
  useLayoutEffect(() => {
    onRestRef.current = onRest
  })

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const metrics = computeScrollMetrics(event.currentTarget)
      const anchorWrite = anchorWriteRef.current
      anchorWriteRef.current = null
      lastScrollAtRef.current = performance.now()
      armRest()
      setShowJumpToBottom(metrics.distanceFromBottomPx > NEAR_BOTTOM_THRESHOLD_PX)
      if (anchorWrite != null && Math.abs(event.currentTarget.scrollTop - anchorWrite) < 1) return
      lastDistanceRef.current = metrics.distanceFromBottomPx
      anchorMemoRef.current = null
      // A scroll during a running landing disengages autoscroll. A stream starting mid-landing can
      // still engage it for one write, which that write's own scroll event takes back.
      const landing = landingRef.current
      if (landing != null && landing.running) autoscrollRef.current.userInterrupted()
      else
        autoscrollRef.current.userScrolled({ distanceFromBottomPx: metrics.distanceFromBottomPx })
    },
    [armRest],
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
      // A rich entry's shadow root retargets the event to its host; the key acts where it began.
      const origin = event.composedPath()[0]
      const target = event.target
      if (event.defaultPrevented || !(origin instanceof Element) || !(target instanceof Node))
        return
      const press = { key: event.key, shiftKey: event.shiftKey, targetTagName: origin.tagName }
      const upward = isUpwardScrollKey(press)
      // A reader left mounted under another screen isn't laid out, and the key isn't its.
      if (
        !(upward || isDownwardScrollKey(press)) ||
        isEditableTarget(origin) ||
        el.getClientRects().length === 0
      )
        return
      if (!(target === doc.body ? pressedInside : el.contains(target))) return
      // Down leaves autoscroll engaged, but mid-document it still moves the view, which a landing
      // or the anchor hold would pull back.
      if (upward) interruptByGesture()
      else {
        stopLanding()
        anchorHoldActiveRef.current = false
      }
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
    // Momentum scroll events re-arm the check; a still-finger release needs this kick.
    armRest()
  }, [armRest])

  // Layout effect: the pin targets the height the just-arrived chunk produced. Short of the tail no
  // stream comes; a card the slice leaves with hasn't ended, one an extension brings is disengaged,
  // one a bottom jump brings is engaged (reader-composer.md → Autoscroll → At the tail only).
  const previousHasNewerRef = useRef(hasNewer)
  useLayoutEffect(() => {
    const machine = autoscrollRef.current
    const reachedTail = previousHasNewerRef.current && !hasNewer
    const leftTail = !previousHasNewerRef.current && hasNewer
    previousHasNewerRef.current = hasNewer
    if (streaming == null) {
      if (streamActiveRef.current) {
        streamActiveRef.current = false
        // The committed row that replaces the streaming card is taller (its
        // footer); hold an engaged reader at the bottom through the swap.
        const engaged = machine.state === 'engaged'
        machine.streamEnded()
        if (engaged && !leftTail) startBottomPin()
      }
      return
    }
    if (!streamActiveRef.current) {
      streamActiveRef.current = true
      const jumpedRecently = Date.now() - pendingJumpAtRef.current < JUMP_TO_BOTTOM_SETTLE_MS
      machine.streamStarted({
        distanceFromBottomPx: jumpedRecently
          ? 0
          : reachedTail
            ? Number.POSITIVE_INFINITY
            : lastDistanceRef.current,
      })
    }
    if (machine.state === 'engaged') {
      const el = scrollRef.current
      anchorHoldActiveRef.current = false
      if (el != null) el.scrollTop = el.scrollHeight
      machine.autoscrollApplied({ distanceFromBottomPx: 0 })
    } else if (landingRef.current?.running !== true && !pinActiveRef.current) {
      // A running landing or pin moves the reader before the paint: read here, the button flashes.
      syncJumpButton()
    }
  }, [streaming, hasNewer, startBottomPin, syncJumpButton])

  // A viewport shrinking under a reader at the bottom would otherwise hide the newest lines.
  useEffect(() => {
    const el = scrollRef.current
    if (el == null) return
    let lastClientHeight = el.clientHeight
    const observer = new ResizeObserver(() => {
      // Shown again after another screen: a change held meanwhile is adopted at the next rest.
      armRest()
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
      // Short of the tail the bottom is the shimmer, which nothing pins to.
      if (shownRef.current.hasNewer) return
      // Read from geometry, not lastDistanceRef: content can grow below without a scroll
      // event, and a shrink never clamps scrollTop.
      const distanceBeforePx = el.scrollHeight - el.scrollTop - previousClientHeight
      if (distanceBeforePx > NEAR_BOTTOM_THRESHOLD_PX) return
      anchorHoldActiveRef.current = false
      el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [armRest])

  const jumpToBottom = useCallback(
    (key: number) => {
      // Stop pin and anchor hold first: a hold from a just-fired prepend would keep yanking
      // scrollTop toward its anchor while this animates to the bottom.
      stopBottomPin()
      stopLanding()
      anchorHoldActiveRef.current = false
      // A swapped slice, or a change held for rest that this jump takes now: land on its commit.
      if (adoptHeld() || key > shownRef.current.sliceKey) {
        pendingBottomRef.current = key
        return
      }
      // A slice gone short of the tail since the press: the button stays up for another.
      if (shownRef.current.hasNewer) return
      const el = scrollRef.current
      if (el != null) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      lastDistanceRef.current = 0
      if (streamActiveRef.current) {
        autoscrollRef.current.streamStarted({ distanceFromBottomPx: 0 })
      } else {
        autoscrollRef.current.autoscrollApplied({ distanceFromBottomPx: 0 })
        pendingJumpAtRef.current = Date.now()
      }
    },
    [adoptHeld, stopBottomPin, stopLanding],
  )
  // Short of the tail only the host can move the slice; it swaps and jumps back.
  const pressJumpToBottom = useCallback(() => {
    const current = shownRef.current
    if (current.hasNewer) void current.onJumpToBottom()
    else jumpToBottom(current.sliceKey)
  }, [jumpToBottom])
  const startEdit = useCallback((row: StoryEntry) => {
    setEditingId(row.id)
    setEditDraft(row.content)
  }, [])
  // Shared by both commit buttons and the host's leave guard, so the refusal policy has one home:
  // a rejected commit keeps the draft open so typing isn't silently lost, and the host owns the
  // error toast. No open editor has nothing to lose, so it counts as clean.
  const commitDraft = useCallback(async (): Promise<EditResult> => {
    const id = editingIdRef.current
    if (id == null) return { ok: true }
    const result = await onCommitEdit(id, editDraftRef.current)
    if (!result?.ok) return result ?? { ok: false }
    setEditingId(null)
    setEditDraft('')
    return { ok: true }
  }, [onCommitEdit])
  const commitEdit = useCallback(async () => {
    await commitDraft()
  }, [commitDraft])
  const commitEditAndRegen = useCallback(
    async (replyId: string) => {
      if (!(await commitDraft()).ok) return
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
  const editSession = useCallback((): EditSession | null => {
    const entryId = editingIdRef.current
    const stored = editingStoredRef.current
    if (entryId == null || stored === undefined) return null
    return { entryId, dirty: editDraftRef.current !== stored }
  }, [])
  useImperativeHandle(
    ref,
    () => ({ jumpToBottom, jumpToEntry, editSession, commitDraft, discardDraft: cancelEdit }),
    [jumpToBottom, jumpToEntry, editSession, commitDraft, cancelEdit],
  )
  const headTurn = useMemo(() => resolveSaveAndRegenTurn(rows, tailEntryId), [rows, tailEntryId])
  const headTurnIds = useMemo(() => headTurnIdsOf(rows, tailEntryId), [rows, tailEntryId])

  return (
    <div className="relative h-full">
      {/* Stable gutter: a landing's halt and wheel hold hide overflow; a lost bar reflows rows. */}
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
        {hasOlder && rows.length > 0 ? <BoundaryShimmer /> : null}
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
                  held={editingId != null && editingId !== row.id}
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
                  closeHere={closeHereEntryIds[row.id] === true}
                  onCloseChapterHere={onCloseChapterHere}
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
        {hasNewer && rows.length > 0 ? <BoundaryShimmer /> : null}
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
              streamingTokens={streaming.tokens}
            />
          </div>
        ) : null}
      </div>
      <JumpButtons
        showJumpToBottom={jumpButtonEnabled && rows.length > 0 && (showJumpToBottom || hasNewer)}
        onJumpToBottom={pressJumpToBottom}
      />
    </div>
  )
}
