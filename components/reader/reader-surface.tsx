// components/reader/reader-surface.tsx
// Plain web React: renders on the web page and inside the reader document's
// DOM bundle — never on Hermes.
import {
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
import type { StoryEntry } from '@/lib/db'
import { computeScrollMetrics, createAutoscrollMachine } from '@/lib/reader-scroll'

import type { ReaderSurfaceHandle, ReaderSurfaceProps } from './reader-document-types'

const NEAR_BOTTOM_THRESHOLD_PX = 20
const JUMP_TO_BOTTOM_SETTLE_MS = 500

const ROW_FRAME_CLASS = 'mx-auto w-full max-w-[860px] px-7 py-2'
// contain-intrinsic-size matches the retired virtualizer's row estimate so
// scrollbar geometry stays plausible before a row first renders. The streaming
// row must NOT get these: it has to lay out on every chunk so the pin's
// scrollHeight write reflects the newest content.
const ROW_CULL_CLASS = '[content-visibility:auto] [contain-intrinsic-size:auto_160px]'

export function ReaderSurface({
  rows,
  streaming,
  branchKey,
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

  // Branch switch: new window, scrolled to bottom, edit state dropped
  // (reader-composer.md → Loaded-set model → Branch switch).
  const landedBranchRef = useRef<string | null>(null)
  useEffect(() => {
    setEditingId(null)
    setEditDraft('')
  }, [branchKey])
  useLayoutEffect(() => {
    if (rows.length === 0 || landedBranchRef.current === branchKey) return
    landedBranchRef.current = branchKey
    const el = scrollRef.current
    if (el != null) el.scrollTop = el.scrollHeight
  }, [branchKey, rows])

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const metrics = computeScrollMetrics(event.currentTarget)
      lastDistanceRef.current = metrics.distanceFromBottomPx
      autoscrollRef.current.userScrolled({ distanceFromBottomPx: metrics.distanceFromBottomPx })
      if (metrics.withinTopViewport && !nearTopRef.current) void onNearTop()
      nearTopRef.current = metrics.withinTopViewport
      setShowJumpToBottom(metrics.distanceFromBottomPx > NEAR_BOTTOM_THRESHOLD_PX)
    },
    [onNearTop],
  )

  // Upward only: wheel-down toward the live edge should let the positional
  // rule re-engage autoscroll, not interrupt it.
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) autoscrollRef.current.userInterrupted()
  }, [])

  // Touch drags interrupt like native drag-begin did — keyed off the first
  // touchmove, not touchstart, so plain taps can't disengage a pinned stream.
  const handleTouchMove = useCallback(() => {
    if (touchInterruptedRef.current) return
    touchInterruptedRef.current = true
    autoscrollRef.current.userInterrupted()
  }, [])
  const handleTouchEnd = useCallback(() => {
    touchInterruptedRef.current = false
  }, [])

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
    if (editingId == null) return
    // A rejected commit keeps the draft open so typing isn't silently lost;
    // the host owns the error toast.
    const result = await onCommitEdit(editingId, editDraft)
    if (result?.ok) {
      setEditingId(null)
      setEditDraft('')
    }
  }, [editingId, editDraft, onCommitEdit])
  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  const renderCard = (e: StoryEntry) => {
    const isEditing = editingId === e.id
    const isSystem = e.kind === 'system'
    return (
      <EntryCard
        kind={e.kind}
        content={isEditing ? editDraft : e.content}
        entryId={e.id}
        meta={e.metadata ?? undefined}
        reasoning={e.metadata?.reasoning}
        disabled={editBlocked}
        editing={isEditing}
        onEdit={isSystem ? undefined : () => startEdit(e)}
        onContentChange={setEditDraft}
        onCommitEdit={() => void commitEdit()}
        onCancelEdit={cancelEdit}
        onDelete={isSystem || e.kind === 'opening' ? undefined : () => void onRequestRollback(e.id)}
        detail={isSystem ? e.metadata?.systemFailure?.detail : undefined}
        fixAction={
          isSystem && systemFixLabel != null
            ? { label: systemFixLabel, onPress: () => void onFixSystemEntry() }
            : undefined
        }
        onRetry={isSystem ? () => void onRetrySystemEntry() : undefined}
        onDismiss={isSystem ? () => void onDismissSystemEntry() : undefined}
      />
    )
  }

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {rows.map((row) => (
          <div key={row.id} className={`${ROW_FRAME_CLASS} ${ROW_CULL_CLASS}`}>
            {renderCard(row)}
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
