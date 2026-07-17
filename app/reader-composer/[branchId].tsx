import { and, desc, eq, lt } from 'drizzle-orm'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { EntryCard } from '@/components/compounds/entry-card'
import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { Composer } from '@/components/reader/composer'
import { EntryWindow, type EntryWindowHandle } from '@/components/reader/entry-window'
import { JumpButtons } from '@/components/reader/jump-buttons'
import { RollbackConfirmModal } from '@/components/reader/rollback-confirm'
import { useSystemEntryActions } from '@/components/reader/system-entry-actions'
import { ScreenShell } from '@/components/shells/screen-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
import { useTier } from '@/hooks/use-tier'
import {
  clearSystemEntry,
  getRollbackCounts,
  loadOpenStory,
  PER_TURN_KIND,
  redoLastAction,
  rollbackToEntry,
  submitTurn,
  undoLastAction,
  updateStoryEntryContent,
  writeSystemEntry,
  type LoadOpenStoryResult,
  type RollbackCounts,
} from '@/lib/actions'
import { wrapComposerText } from '@/lib/composer-wrap'
import { branches, db, runInTransaction, storyEntries, type StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'
import { createHtmlStreamBuffer, type HtmlStreamBuffer } from '@/lib/markdown'
import { awaitRunTerminal, pipelineEventBus, type PipelineError } from '@/lib/pipeline'
import { createAutoscrollMachine } from '@/lib/reader-scroll'
import {
  currentStoryStore,
  entitiesStore,
  entriesStore,
  generationStore,
  isUserEditBlocked,
  rehydrateStories,
  storiesStore,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

type RollbackState = { targetId: string; targetNumber: number; counts: RollbackCounts }
type StreamingRow = { id: string; kind: 'streaming'; content: string }
type WindowRow = StoryEntry | StreamingRow
type BranchHydrationState =
  | { branchId: string; status: 'loading' }
  | {
      branchId: string
      status: 'success'
      result: Extract<LoadOpenStoryResult, { status: 'ok' }>
    }
  | { branchId: string; status: 'failure'; result: LoadOpenStoryResult | null }

const RECENT_WINDOW_SIZE = 50
const JUMP_TO_BOTTOM_SETTLE_MS = 500

export default function ReaderComposerRoute() {
  const router = useRouter()
  const tier = useTier()
  const showRail = tier !== 'phone'
  const { branchId } = useLocalSearchParams<{ branchId: string }>()

  const [storyId, setStoryId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [rollback, setRollback] = useState<RollbackState | null>(null)
  const [lastError, setLastError] = useState<PipelineError | undefined>(undefined)
  const [lastSubmission, setLastSubmission] = useState<{
    content: string
    composerMode: string
  } | null>(null)

  // Select the raw map (stable reference between patches); derive the sorted
  // view with useMemo. Returning a fresh array from the selector would break
  // useSyncExternalStore's snapshot-stability contract and loop.
  const rows = entriesStore.useEntries((m) => m)
  const entries = useMemo(
    () =>
      [...rows.values()]
        .filter((e) => e.branchId === branchId)
        .sort((a, b) => a.position - b.position),
    [rows, branchId],
  )

  const editBlocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState))
  const isGenerating = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some((r) => r.branchId === branchId),
  )

  const open = currentStoryStore.useCurrentStory((s) => s)
  const [hydration, setHydration] = useState<BranchHydrationState>({
    branchId,
    status: 'loading',
  })
  const hydrationIsCurrent = hydration.branchId === branchId
  const hydrationSucceeded =
    hydrationIsCurrent && hydration.status === 'success' && hydration.result.branchId === branchId
  const hydrationFailed = hydrationIsCurrent && hydration.status === 'failure'
  const openForBranch = hydrationSucceeded && open?.branchId === branchId ? open : null
  const leadEntityId = openForBranch?.definition.leadEntityId ?? null
  const leadName = entitiesStore.useEntities((m) =>
    leadEntityId ? (m.get(leadEntityId)?.name ?? '') : '',
  )
  const modesEnabled =
    openForBranch?.settings.composerModesEnabled === true &&
    openForBranch.definition.mode === 'adventure'
  const wrapPov = openForBranch?.settings.composerWrapPov ?? 'first'

  // Buffer instance lives in a ref (mutable, not render state); the safe output
  // it computes on each push drives the re-render via streamingContent.
  const streamBufferRef = useRef<{ entryId: string; buffer: HtmlStreamBuffer } | null>(null)
  const [streamingContent, setStreamingContent] = useState<{
    entryId: string
    content: string
  } | null>(null)
  const entryWindowRef = useRef<EntryWindowHandle>(null)
  const autoscrollRef = useRef(createAutoscrollMachine())
  const lastDistanceRef = useRef(0)
  // Timestamp of the last jump-to-bottom click while idle. The smooth-scroll
  // it triggers reports several intermediate, non-zero distanceFromBottomPx
  // values before settling, so a bounded time window — not a plain flag —
  // is what lets a fast-following stream still treat it as "at bottom"
  // without also capturing an unrelated, much-later stream after the user
  // has genuinely scrolled away in between.
  const pendingJumpToBottomAtRef = useRef(0)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  // A branch switch must drop any in-flight buffer from the prior branch —
  // it belongs to a different entry list and would otherwise leak forward.
  useEffect(() => {
    streamBufferRef.current = null
    setStreamingContent(null)
  }, [branchId])

  useEffect(
    () =>
      pipelineEventBus.subscribe('stream_chunk', (event) => {
        // stream_chunk carries no branchId/runId — correlate to this route via
        // the current live txState instead of a stale render-time closure.
        const isOurRun = [...generationStore.getTxState().runs.values()].some(
          (r) => r.branchId === branchId,
        )
        if (!isOurRun) return
        if (streamBufferRef.current?.entryId !== event.targetEntryId) {
          streamBufferRef.current = {
            entryId: event.targetEntryId,
            buffer: createHtmlStreamBuffer(),
          }
          const jumpedRecently =
            Date.now() - pendingJumpToBottomAtRef.current < JUMP_TO_BOTTOM_SETTLE_MS
          autoscrollRef.current.streamStarted({
            distanceFromBottomPx: jumpedRecently ? 0 : lastDistanceRef.current,
          })
        }
        const safe = streamBufferRef.current.buffer.push(event.text)
        setStreamingContent({ entryId: event.targetEntryId, content: safe })
      }),
    [branchId],
  )

  // Runs after React commits streamingContent, so the scroll targets the row
  // height the just-arrived chunk actually produced.
  useLayoutEffect(() => {
    if (streamingContent == null || autoscrollRef.current.state !== 'engaged') return
    entryWindowRef.current?.scrollToBottom()
    autoscrollRef.current.autoscrollApplied({ distanceFromBottomPx: 0 })
  }, [streamingContent])

  // Covers the abort/failure paths where no committed row ever lands to
  // trigger the entries.some(...) hide check below.
  useEffect(() => {
    if (!isGenerating) {
      streamBufferRef.current = null
      setStreamingContent(null)
      autoscrollRef.current.streamEnded()
    }
  }, [isGenerating])

  // The real commit lands in entriesStore mid-phase, before isGenerating flips
  // false — checking against entries (not just isGenerating) prevents a frame
  // where both the synthetic and the real committed card are visible.
  const streamingVisible =
    isGenerating &&
    streamingContent != null &&
    !entries.some((e) => e.id === streamingContent.entryId)

  const reload = useCallback(async () => {
    const recent = (await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchId))
      .orderBy(desc(storyEntries.position))
      .limit(RECENT_WINDOW_SIZE)) as StoryEntry[]
    entriesStore.hydrate(branchId, recent.reverse())
  }, [branchId])

  const loadOlderEntries = useCallback(async () => {
    const loadedPositions = [...entriesStore.getEntries().values()]
      .filter((e) => e.branchId === branchId)
      .map((e) => e.position)
    if (loadedPositions.length === 0) return
    const minPosition = Math.min(...loadedPositions)

    const older = (await db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, branchId), lt(storyEntries.position, minPosition)))
      .orderBy(desc(storyEntries.position))
      .limit(RECENT_WINDOW_SIZE)) as StoryEntry[]

    for (const row of older) {
      entriesStore.patch(branchId, { op: 'create', id: row.id, row })
    }
  }, [branchId])

  useEffect(() => {
    let cancelled = false
    void db
      .select({ storyId: branches.storyId })
      .from(branches)
      .where(eq(branches.id, branchId))
      .then((r) => {
        if (!cancelled) setStoryId(r[0]?.storyId ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [branchId])

  useEffect(() => {
    let cancelled = false
    const current = currentStoryStore.getCurrentStory()
    if (current?.branchId === branchId) {
      setHydration({
        branchId,
        status: 'success',
        result: { status: 'ok', storyId: current.storyId, branchId },
      })
      return
    }

    setHydration({ branchId, status: 'loading' })
    void loadOpenStory(branchId, ctx)
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ok' && result.branchId === branchId) {
          setHydration({ branchId, status: 'success', result })
        } else {
          setHydration({ branchId, status: 'failure', result })
        }
      })
      .catch(() => {
        if (!cancelled) setHydration({ branchId, status: 'failure', result: null })
      })
    return () => {
      cancelled = true
    }
  }, [branchId])

  const storyRows = storiesStore.useStories((s) => s.rows)
  useEffect(() => {
    void rehydrateStories(db)
  }, [])
  const storyTitle = useMemo(
    () => storyRows.find((r) => r.id === storyId)?.title,
    [storyRows, storyId],
  )

  const showTurnFailure = useCallback(
    async (error: PipelineError | undefined) => {
      setLastError(error)
      await writeSystemEntry({ branchId, content: t('reader:systemEntry.failureMessage') }, ctx)
      await reload()
    },
    [branchId, reload],
  )

  const runSubmit = useCallback(
    async (content: string, composerMode: string) => {
      if (!storyId || !hydrationSucceeded) return
      setLastError(undefined)
      // A prior failure leaves a system entry as the branch tail; drop it (and
      // resync the store) before the turn so the pipeline's prompt/position
      // reads the real content tail, not the failure singleton.
      const hasSystemTail = [...entriesStore.getEntries().values()].some(
        (e) => e.branchId === branchId && e.kind === 'system',
      )
      if (hasSystemTail) {
        await clearSystemEntry(branchId, ctx)
        await reload()
      }
      setLastSubmission({ content, composerMode })
      try {
        const result = await submitTurn({ storyId, branchId }, { content, composerMode }, ctx)
        if (result.outcome === 'failed') await showTurnFailure(result.error)
        else if (result.outcome === 'rejected')
          await showTurnFailure({ kind: 'orchestrator', detail: `blocked by ${result.blockedBy}` })
      } catch (err) {
        // submitTurn throws on a rejected user_action write — treat a thrown
        // failure like a structured 'failed' outcome so the UI surfaces an
        // error and stays retriable instead of hanging.
        await showTurnFailure({
          kind: 'orchestrator',
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [storyId, branchId, hydrationSucceeded, reload, showTurnFailure],
  )

  // fixAction (config-resolver fixes) has no EntryCard slot in the M2 subset;
  // only the retry passthrough is wired here.
  const { onRetry: retrySystemEntry } = useSystemEntryActions(lastError, () => {
    if (lastSubmission) void runSubmit(lastSubmission.content, lastSubmission.composerMode)
  })

  const dismissSystemEntry = useCallback(async () => {
    await clearSystemEntry(branchId, ctx)
    setLastError(undefined)
    await reload()
  }, [branchId, reload])

  const openRollback = useCallback(
    async (targetId: string) => {
      const counts = await getRollbackCounts(branchId, targetId, ctx)
      if ('status' in counts) return
      const target = entriesStore.getById(targetId)
      setRollback({ targetId, targetNumber: target?.position ?? 0, counts })
    },
    [branchId],
  )

  const confirmRollback = useCallback(async () => {
    if (!rollback) return
    const result = await rollbackToEntry(branchId, rollback.targetId, ctx)
    if (result.status === 'rejected') {
      // Keep the modal open so the user doesn't assume the delete happened.
      toast.error(t('reader:rollbackFailed'))
      return
    }
    setRollback(null)
  }, [branchId, rollback])

  const startEdit = useCallback((id: string) => {
    setEditingId(id)
    setEditDraft(entriesStore.getById(id)?.content ?? '')
  }, [])

  const commitEdit = useCallback(async () => {
    if (!editingId) return
    const result = await updateStoryEntryContent(branchId, editingId, editDraft, ctx)
    if (result.status === 'rejected') {
      // Keep the draft open so a rejected edit doesn't silently discard typing.
      toast.error(t('reader:editFailed'))
      return
    }
    setEditingId(null)
    setEditDraft('')
  }, [branchId, editingId, editDraft])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  const matchesUndoRedoShortcut = useCallback(
    (ev: KeyboardEvent) => (ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z'),
    [],
  )
  // Editable-target exclusion lets the browser's native undo/redo win when
  // focus is in a text input — otherwise Ctrl/Cmd+Z on a composer typo
  // reverses the last story turn instead of the typo.
  const handleUndoRedoShortcut = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.shiftKey) void redoLastAction(branchId, ctx)
      else void undoLastAction(branchId, ctx)
    },
    [branchId],
  )
  useGlobalHotkey(matchesUndoRedoShortcut, handleUndoRedoShortcut, { ignoreEditableTargets: true })

  const windowRows: WindowRow[] = useMemo(() => {
    if (streamingVisible && streamingContent) {
      return [
        ...entries,
        { id: streamingContent.entryId, kind: 'streaming', content: streamingContent.content },
      ]
    }
    return entries
  }, [entries, streamingVisible, streamingContent])

  const renderRow = (row: WindowRow) => {
    if (row.kind === 'streaming') {
      return <EntryCard kind="streaming" content={row.content} streamingPhase="reply" />
    }
    const e = row
    const isEditing = editingId === e.id
    const isSystem = e.kind === 'system'
    return (
      <EntryCard
        kind={e.kind}
        content={isEditing ? editDraft : e.content}
        meta={e.metadata ?? undefined}
        reasoning={e.metadata?.reasoning}
        disabled={editBlocked}
        editing={isEditing}
        onEdit={isSystem ? undefined : () => startEdit(e.id)}
        onContentChange={setEditDraft}
        onCommitEdit={() => void commitEdit()}
        onCancelEdit={cancelEdit}
        onDelete={isSystem || e.kind === 'opening' ? undefined : () => void openRollback(e.id)}
        onRetry={isSystem ? retrySystemEntry : undefined}
        onDismiss={isSystem ? () => void dismissSystemEntry() : undefined}
      />
    )
  }

  const showJump = entries.length > 0

  return (
    <ScreenShell
      variant="in-story"
      title={<Text className="font-semibold">{storyTitle ?? t('reader:placeholderTitle')}</Text>}
      chapterProgress={0}
      onBack={() => router.back()}
      actions={<AppActionsMenu />}
      statusSlot={
        <GenerationStatusPill
          activePhase={isGenerating ? 'generating-narrative' : undefined}
          onCancel={() => void awaitRunTerminal(PER_TURN_KIND, 'cancel')}
          onErrorTap={() => {}}
        />
      }
    >
      <View className="flex-1 flex-row">
        <View className="flex-1">
          <View className="flex-1">
            {hydrationFailed ? (
              <View className="flex-1 items-center justify-center">
                <EmptyState
                  title={t('reader:hydrationFailedTitle')}
                  subtext={t('reader:hydrationFailedBody')}
                />
              </View>
            ) : !hydrationSucceeded ? (
              <View className="flex-1 items-center justify-center">
                <EmptyState title={t('reader:hydrationLoading')} />
              </View>
            ) : entries.length === 0 ? (
              <View className="flex-1 items-center justify-center">
                <EmptyState title={t('reader:emptyTitle')} subtext={t('reader:emptyBody')} />
              </View>
            ) : (
              <EntryWindow
                ref={entryWindowRef}
                key={branchId}
                rows={windowRows}
                renderRow={renderRow}
                onNearTop={() => void loadOlderEntries()}
                onNearBottomChange={(isNearBottom) => setShowJumpToBottom(!isNearBottom)}
                onScrollPositionChange={(pos) => {
                  lastDistanceRef.current = pos.distanceFromBottomPx
                  autoscrollRef.current.userScrolled(pos)
                }}
              />
            )}
            <JumpButtons
              showJumpToBottom={showJump && showJumpToBottom}
              onJumpToBottom={() => {
                entryWindowRef.current?.scrollToBottom({ smooth: true })
                lastDistanceRef.current = 0
                if (isGenerating) {
                  // Today's single-phase per-turn pipeline streams exactly one
                  // entryId per run, so this forced engage already covers the
                  // rest of it — nothing later reads pendingJumpToBottomAtRef
                  // for this run. Revisit if a phase ever streams a second
                  // entryId under the same run.
                  autoscrollRef.current.streamStarted({ distanceFromBottomPx: 0 })
                } else {
                  autoscrollRef.current.autoscrollApplied({ distanceFromBottomPx: 0 })
                  pendingJumpToBottomAtRef.current = Date.now()
                }
              }}
            />
          </View>
          <View className="border-t border-border p-3">
            <Composer
              modesEnabled={modesEnabled}
              isGenerating={isGenerating}
              disabled={editBlocked || !hydrationSucceeded}
              disabledReason={
                hydrationFailed
                  ? t('reader:hydrationFailedBody')
                  : !hydrationSucceeded
                    ? t('reader:hydrationLoading')
                    : undefined
              }
              onSend={(rawText, mode) => {
                const wrapped = wrapComposerText(rawText, { mode, pov: wrapPov, leadName })
                void runSubmit(wrapped, mode)
              }}
              onCancel={() => void awaitRunTerminal(PER_TURN_KIND, 'cancel')}
            />
          </View>
        </View>
        {showRail ? (
          <View className="w-[260px] border-l border-border bg-bg-sunken p-3">
            <Text variant="muted" size="sm">
              {t('reader:railPlaceholder')}
            </Text>
          </View>
        ) : null}
      </View>
      {rollback ? (
        <RollbackConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setRollback(null)
          }}
          targetEntryNumber={rollback.targetNumber}
          counts={rollback.counts}
          onConfirm={() => void confirmRollback()}
        />
      ) : null}
    </ScreenShell>
  )
}
