import { useIsFocused } from '@react-navigation/native'
import { and, desc, eq, lt } from 'drizzle-orm'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Platform, View } from 'react-native'

import { type ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { TruncatedText } from '@/components/compounds/truncated-text'
import { Composer, type ComposerHandle } from '@/components/reader/composer'
import { isDraftEmpty, planSubmissionHandback } from '@/components/reader/composer-draft'
import {
  regenerateRefusalCopy,
  reopenAfterRefusal,
  rollbackRefusalCopy,
  type ConfirmState,
  type RegenerateRefusal,
  type RollbackRefusal,
} from '@/components/reader/confirm-refusal'
import { useContentEditing } from '@/components/reader/content-editing'
import { readerPillPhase } from '@/components/reader/generation-phase'
import {
  draftSubmission,
  readPassFailureCustody,
  settleCommittedPassRetry,
  settlePassFailureCustody,
  settlePassRetryCustody,
} from '@/components/reader/pass-failure-custody'
import { ReaderPeekDrawer } from '@/components/reader/peek/reader-peek-drawer'
import { ReaderBrowseChip } from '@/components/reader/rail/reader-browse-chip'
import { ReaderRailColumn } from '@/components/reader/rail/reader-rail-column'
import { useRailData } from '@/components/reader/rail/use-rail-data'
import ReaderDocument, { type ReaderDocumentRef } from '@/components/reader/reader-document'
import { type ReaderSurfaceHandle } from '@/components/reader/reader-document-types'
import { ReaderSurface } from '@/components/reader/reader-surface'
import {
  classifyRegenerateGate,
  loadRegenerateCountsIfCurrent,
} from '@/components/reader/regenerate-gate'
import {
  latestReplyOf,
  planRegenerateOutcome,
  runBehindTailDrop,
  settleRegenerateArm,
  settleWithDroppedHandback,
} from '@/components/reader/regenerate-outcome'
import { RollbackConfirmModal } from '@/components/reader/rollback-confirm'
import { editGateOf, rowGateReason } from '@/components/reader/row-reversal-flags'
import { SceneEditSheet } from '@/components/reader/scene-edit-sheet'
import { useSceneEditing } from '@/components/reader/scene-editing'
import {
  abortedBeforeTurn,
  cancelComposerRun,
  cancelPillRun,
  composerShowsCancel,
  passRefusalOf,
  pillRunOf,
  sendGapOpen,
  sendRunStreams,
  type PassRefusal,
} from '@/components/reader/send-run'
import { describeSuggestionFailure } from '@/components/reader/suggestion-failure'
import { suggestionRefreshBlocked } from '@/components/reader/suggestion-refresh-gate'
import { SuggestionStrip, type SuggestionStripPhase } from '@/components/reader/suggestion-strip'
import {
  describePassFailure,
  describeTurnFailure,
  dismissSystemEntry,
  passResolvedEntry,
  retryPassEntry,
  toPassFailureMeta,
  toSystemFailureMeta,
  useConfigFixAction,
  useSystemEntryActions,
} from '@/components/reader/system-entry-actions'
import { useLiveRollbackCounts } from '@/components/reader/use-live-rollback-counts'
import { useWorldTimeEditing } from '@/components/reader/world-time-editing'
import { WorldTimeEditSheet } from '@/components/reader/worldtime-edit-sheet'
import { ScreenShell } from '@/components/shells/screen-shell'
import {
  generationGateReason,
  headReversalGateReason,
  selectHeadReversalRunKind,
  selectStorySettingsGenerationRunKind,
} from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { KeyboardInsetColumn } from '@/components/ui/keyboard-inset-column'
import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
import { useLeaveFailedStoryOpen } from '@/hooks/use-leave-failed-story-open'
import { useSwapState } from '@/hooks/use-memory-health'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import { useStoryLeaveGuard } from '@/hooks/use-story-leave-guard'
import { useSurfaceNavigate } from '@/hooks/use-surface-navigate'
import { useTier } from '@/hooks/use-tier'
import {
  clearSystemEntry,
  ENTRIES_WINDOW_SIZE,
  getRollbackCounts,
  loadOpenStory,
  readRecentEntries,
  redoLastAction,
  refreshSuggestions,
  regenerateTurn,
  rollbackToEntry,
  runClassifierNow,
  sameRollbackCounts,
  submitTurn,
  undoLastAction,
  type UndoRejectionCode,
  writeSystemEntry,
  type LoadOpenStoryResult,
  type RollbackCounts,
  type StoryEntryRejection,
} from '@/lib/actions'
import { wrapComposerText, wrapHasSubject, type ComposerMode } from '@/lib/composer-wrap'
import {
  db,
  runInTransaction,
  storyEntries,
  type StoryEntry,
  type SystemFailureMeta,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { refreshEmbeddingStatus } from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import { createHtmlStreamBuffer, type HtmlStreamBuffer } from '@/lib/markdown'
import {
  buildSuggestionSlots,
  findSuggestionAnchor,
  shouldShowSuggestionStrip,
  unappliedStateRole,
} from '@/lib/piggyback'
import {
  isClassifierHeld,
  pipelineEventBus,
  SUGGESTION_REFRESH_KIND,
  type PipelineError,
} from '@/lib/pipeline'
import {
  appSettingsStore,
  awaitRunTerminal,
  blockingOverlaysStore,
  currentStoryStore,
  entitiesStore,
  entriesStore,
  generationStore,
  isHeadReversalBlocked,
  isUserEditBlocked,
  readerRailStore,
  rehydrateStories,
  storiesStore,
  undoRedoStore,
} from '@/lib/stores'
import { useTheme } from '@/lib/themes'
import { toast } from '@/lib/toast'
import { runAction } from '@/lib/utils'
import { resolveLead } from '@/lib/world'

const ctx = { db, runInTransaction }

const loadRollbackCounts = (branchId: string, targetId: string) =>
  getRollbackCounts(branchId, targetId, ctx)

type BranchHydrationState =
  | { branchId: string; status: 'loading' }
  | {
      branchId: string
      status: 'success'
      result: Extract<LoadOpenStoryResult, { status: 'ok' }>
    }

// Module scope, not useCallback([]): `matches` is a useGlobalHotkey effect dep; identity must hold.
// Blocking overlays (Sheet, Dialog, AlertDialog, Select) own the surface at key time; a miss
// stays native.
function matchesUndoRedoShortcut(ev: KeyboardEvent): boolean {
  return (
    (ev.metaKey || ev.ctrlKey) &&
    (ev.key === 'z' || ev.key === 'Z') &&
    !blockingOverlaysStore.isBlocked()
  )
}

function matchesJumpToBottomShortcut(ev: KeyboardEvent): boolean {
  return ev.key === 'End' && !blockingOverlaysStore.isBlocked()
}

type ReaderGateState = {
  hydrationSucceeded: boolean
  swapPending: boolean
  /** The principle-owned gate tooltip, undefined while nothing blocks actions. */
  gateReason: string | undefined
}

// Precedence, not independent conditions: hydration outranks the swap, which
// outranks a run in flight. An object, so the order can't transpose at the call site.
function composerDisabledReason(state: ReaderGateState): string | undefined {
  if (!state.hydrationSucceeded) return t('reader:hydrationLoading')
  if (state.swapPending) return t('reader:actions.blockedWhileSwapping')
  return state.gateReason
}

// Same precedence order as above; null means the reader itself renders. A failed
// open never lands here: it leaves for the story list.
function readerPlaceholder(state: {
  hydrationSucceeded: boolean
  isEmpty: boolean
}): { title: string; subtext?: string } | null {
  if (!state.hydrationSucceeded) return { title: t('reader:hydrationLoading') }
  if (state.isEmpty) return { title: t('reader:emptyTitle'), subtext: t('reader:emptyBody') }
  return null
}

export default function ReaderComposerRoute() {
  const router = useRouter()
  const surfaceNavigate = useSurfaceNavigate()
  const tier = useTier()
  const showRail = tier !== 'phone'
  const isFocused = useIsFocused()
  const { branchId } = useLocalSearchParams<{ branchId: string }>()
  const branchIdRef = useRef(branchId)
  // Assigned post-commit, not during render: a discarded render would otherwise
  // publish a branch that never landed, and every reader of this ref treats a
  // mismatch as "the user left" — dropping work that was still legitimate.
  // Layout, not passive: the commit phase runs to completion before any promise
  // continuation, so no settling callback can read the pre-switch branch back.
  useLayoutEffect(() => {
    branchIdRef.current = branchId
  }, [branchId])
  // One composer and one lastSubmission serve every branch, so settle-time
  // recovery must prove the branch didn't change under its awaits before handing
  // the user's text back. Persisted recovery (the failure entry) is branch-bound
  // and stays unconditional.
  const branchUnchanged = useCallback((started: string) => branchIdRef.current === started, [])

  const [rollback, setRollback] = useState<ConfirmState | null>(null)
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
  // Narrower than editBlocked: a pass or a close alone lets the head reversals through, each
  // interrupting it (principles.md → Edit restrictions during in-flight generation).
  const headReversalGateHeld = generationStore.useGeneration((s) =>
    isHeadReversalBlocked(s.txState, branchId),
  )
  // Set around this route's submitTurn, whose pending mark alone holds the gaps around its runs.
  const [sendPending, setSendPending] = useState(false)
  // Send in flight (its owed pass, its turn and the gap between) swaps Send for Cancel; a pass
  // chained after a turn leaves Send refused, the composer live. Booleans: no re-render per phase.
  const isGenerating = generationStore.useGeneration((s) =>
    composerShowsCancel(s.txState, branchId, sendPending),
  )
  const turnStreaming = generationStore.useGeneration((s) => sendRunStreams(s.txState, branchId))
  const refreshingSuggestions = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some(
      (r) => r.branchId === branchId && r.kind === SUGGESTION_REFRESH_KIND,
    ),
  )
  const pillRunKind = generationStore.useGeneration(
    (s) => pillRunOf(s.txState, branchId)?.kind ?? null,
  )
  const pillRunPhase = generationStore.useGeneration(
    (s) => pillRunOf(s.txState, branchId)?.currentPhase ?? null,
  )
  const pillBeforeTurn = generationStore.useGeneration(
    (s) => pillRunOf(s.txState, branchId)?.beforeTurn === true,
  )

  const open = currentStoryStore.useCurrentStory((s) => s)
  const [hydration, setHydration] = useState<BranchHydrationState>({
    branchId,
    status: 'loading',
  })
  const hydrationIsCurrent = hydration.branchId === branchId
  const hydrated =
    hydrationIsCurrent && hydration.status === 'success' && hydration.result.branchId === branchId
      ? hydration.result
      : null
  const hydrationSucceeded = hydrated != null
  // From the hydration rather than a read of its own, which could fail and leave Send inert.
  const storyId = hydrated?.storyId ?? null
  const { guardLeave, dialog: storyLeaveDialog } = useStoryLeaveGuard(storyId, branchId)
  const openForBranch = hydrationSucceeded && open?.branchId === branchId ? open : null
  const leadEntityId = openForBranch?.definition.leadEntityId ?? null
  const leadName = entitiesStore.useEntities(
    (m) => resolveLead(leadEntityId, m, branchId)?.name ?? null,
  )
  const modesEnabled =
    openForBranch?.settings.composerModesEnabled === true &&
    openForBranch.definition.mode === 'adventure'
  const wrapPov = openForBranch?.settings.composerWrapPov ?? 'first'
  const modesUnavailableReason =
    modesEnabled && !wrapHasSubject(wrapPov, leadName) ? t('reader:composerLeadMissing') : undefined

  const {
    worldTimeFrame,
    worldTimeDecorations,
    timeEdit,
    editWorldTime,
    requestEditWorldTime,
    closeTimeEdit,
  } = useWorldTimeEditing(
    branchId,
    entries,
    openForBranch?.definition.calendarSystemId,
    openForBranch?.definition.worldTimeOrigin,
    ctx,
  )

  // Same snapshot-stability contract as `rows` above: select the raw map, derive
  // the array with useMemo. The whole branch, unwindowed — the panel resolves ids
  // that may sit outside the current scene, and the editor offers every candidate.
  const entityRows = entitiesStore.useEntities((m) => m)
  const branchEntities = useMemo(
    () => [...entityRows.values()].filter((e) => e.branchId === branchId),
    [entityRows, branchId],
  )
  // Entries only ever prepend and nothing trims the far end yet, so it is still the tail.
  const holdsLiveEdge = true
  const {
    entityNames,
    sceneOptions,
    tailEntryId,
    sceneEdit,
    editScene,
    requestEditScene,
    closeSceneEdit,
  } = useSceneEditing(branchId, entries, holdsLiveEdge, branchEntities, ctx)

  const [stripCollapsed, setStripCollapsed] = useState(false)
  const [stripError, setStripError] = useState<PipelineError | null>(null)
  const terminalEntry = findSuggestionAnchor(entries) ?? null
  const suggestionsEnabled = openForBranch?.settings.suggestionsEnabled ?? false
  const suggestionCategories = openForBranch?.settings.suggestionCategories ?? []
  const chips = terminalEntry?.metadata?.nextTurnSuggestions?.items ?? []
  const stripVisible = shouldShowSuggestionStrip({
    suggestionsEnabled,
    hasTerminalEntry: terminalEntry != null,
    hasChips: chips.length > 0,
    categories: suggestionCategories,
  })
  // The strip stays mounted on historical chips after every category is
  // disabled, but the phase no-ops in that state — so ⟳ must not offer a run
  // that cannot produce anything.
  const canRefreshSuggestions = buildSuggestionSlots(suggestionCategories).slots.length > 0
  // No visible/empty-state arm: that is `chips.length`, which the strip already
  // has. Deriving it twice is what let the two disagree.
  const stripPhase: SuggestionStripPhase = refreshingSuggestions
    ? 'loading'
    : stripError != null
      ? 'error'
      : 'idle'
  const stripErrorMessage = describeSuggestionFailure(stripError)
  const stripErrorFix = useConfigFixAction(
    stripError?.kind === 'config-resolver' ? stripError.failure : undefined,
    storyId,
    guardLeave,
  )

  // The failure belongs to the entry it was fired on; a turn, a rollback or a
  // branch switch replaces the strip's contents, so the error must not ride along.
  useEffect(() => setStripError(null), [branchId, terminalEntry?.id])

  const swapTarget = openForBranch?.settings.embedding_swap_target
  const { swapRunning, swapPaused } = useSwapState(storyId, swapTarget)
  // Composing is fine mid-swap; submitting is not. submitTurn refuses either way
  // (a swap owns the vec tables), so gate here rather than let the user write a
  // turn and take a failure entry for it.
  const swapPending = swapRunning || swapPaused

  // While Send's turn is pending with no run registered, the pending Send keeps the pill.
  const sendGap = generationStore.useGeneration((s) =>
    sendGapOpen(s.txState, branchId, sendPending),
  )
  const activePhase = readerPillPhase({
    turnKind: pillRunKind,
    turnPhase: pillRunPhase,
    refreshingSuggestions,
    turnPending: sendGap,
  })

  // Buffer instances live in a ref (mutable, not render state); the safe output
  // they compute on each push drives the re-render via `streaming`.
  const streamBufferRef = useRef<{
    entryId: string
    content: HtmlStreamBuffer
    reasoning: HtmlStreamBuffer
  } | null>(null)
  const [streaming, setStreaming] = useState<{
    entryId: string
    content: string
    reasoning: string
  } | null>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const surfaceRef = useRef<ReaderSurfaceHandle>(null)
  const documentRef = useRef<ReaderDocumentRef>(null)
  const [syncNonce, setSyncNonce] = useState(0)
  const [documentPainted, setDocumentPainted] = useState(false)

  // A full first window means older entries may exist; any shorter load
  // proves the branch top is already inside the window.
  const [hasOlder, setHasOlder] = useState(false)
  const hasOlderSeededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!hydrationSucceeded || hasOlderSeededRef.current === branchId || entries.length === 0)
      return
    hasOlderSeededRef.current = branchId
    setHasOlder(entries.length >= ENTRIES_WINDOW_SIZE)
  }, [hydrationSucceeded, branchId, entries.length])

  // A branch switch must drop any in-flight buffer from the prior branch —
  // it belongs to a different entry list and would otherwise leak forward.
  // `lastSubmission` rides along: retry prefers it over the persisted copy, so
  // carrying it across would offer the previous branch's text to this branch's
  // system entry.
  useEffect(() => {
    streamBufferRef.current = null
    setStreaming(null)
    setHasOlder(false)
    setLastSubmission(null)
  }, [branchId])

  // Leaving the branch (switch or unmount) aborts an in-flight refresh: its
  // target entry is on the branch being left, and letting it settle would hold
  // the edit gate on the branch just entered
  // (reader-composer.md → Edge cases → Branch switch with chips in flight).
  useEffect(
    () => () => {
      // Unguarded: awaitRunTerminal resolves on no match, so a pre-flight check repeats it.
      void awaitRunTerminal(SUGGESTION_REFRESH_KIND, branchId, 'cancel')
    },
    [branchId],
  )

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
            content: createHtmlStreamBuffer(),
            reasoning: createHtmlStreamBuffer(),
          }
        }
        const buffers = streamBufferRef.current
        const safe = (event.channel === 'reasoning' ? buffers.reasoning : buffers.content).push(
          event.text,
        )
        setStreaming((prev) => {
          const base =
            prev?.entryId === event.targetEntryId
              ? prev
              : { entryId: event.targetEntryId, content: '', reasoning: '' }
          return event.channel === 'reasoning'
            ? { ...base, reasoning: safe }
            : { ...base, content: safe }
        })
      }),
    [branchId],
  )

  // Covers the abort/failure paths where no committed row ever lands to
  // trigger the entries.some(...) hide check below.
  useEffect(() => {
    if (!turnStreaming) {
      streamBufferRef.current = null
      setStreaming(null)
    }
  }, [turnStreaming])

  // The real commit hits entriesStore mid-phase, before turnStreaming flips false; checking
  // entries too prevents a frame showing both the synthetic and the committed card.
  const streamingVisible =
    turnStreaming && !(streaming != null && entries.some((e) => e.id === streaming.entryId))

  const reload = useCallback(async () => {
    const recent = await readRecentEntries(branchId, db)
    if (!entriesStore.hydrateIfLoaded(branchId, recent)) return
    // A recent-window reload drops any older entries a scroll-up had loaded, so
    // recompute the boundary: a full window means older may exist, a short one
    // proves the branch top is in the window. The seed guard won't do this.
    hasOlderSeededRef.current = branchId
    setHasOlder(recent.length >= ENTRIES_WINDOW_SIZE)
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
      .limit(ENTRIES_WINDOW_SIZE)) as StoryEntry[]

    for (const row of older) {
      entriesStore.patch(branchId, { op: 'create', id: row.id, row })
    }
    setHasOlder(older.length >= ENTRIES_WINDOW_SIZE)
  }, [branchId])

  useEffect(() => {
    // Never rejects: internally try/caught, logs embedder.status_refresh_failed on its own.
    if (storyId != null) void refreshEmbeddingStatus(storyId)
  }, [storyId])

  const leaveFailedOpen = useLeaveFailedStoryOpen()
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
          leaveFailedOpen()
        }
      })
      .catch(() => {
        if (!cancelled) leaveFailedOpen()
      })
    return () => {
      cancelled = true
    }
  }, [branchId, leaveFailedOpen])

  const storyRows = storiesStore.useStories((s) => s.rows)
  useEffect(() => {
    // Never rejects: internally try/caught, logs bootstrap.stories_hydrate_failed on its own.
    void rehydrateStories(db)
  }, [])
  const storyTitle = useMemo(
    () => storyRows.find((r) => r.id === storyId)?.title,
    [storyRows, storyId],
  )

  const writeTurnFailure = useCallback(
    async (
      error: PipelineError | undefined,
      submission: { content: string; composerMode: string },
    ) => {
      // Copy + discriminant + the reversed user_action's text all persist on
      // the entry, so kind-specific recovery survives an app restart.
      await writeSystemEntry(
        {
          branchId,
          content: describeTurnFailure(error).content,
          failure: toSystemFailureMeta(error, submission),
        },
        ctx,
      )
    },
    [branchId],
  )

  const showTurnFailure = useCallback(
    async (
      error: PipelineError | undefined,
      submission: { content: string; composerMode: string },
    ) => {
      await writeTurnFailure(error, submission)
      await reload()
    },
    [writeTurnFailure, reload],
  )

  const showPassFailure = useCallback(
    async (refusal: PassRefusal, submission: SystemFailureMeta['submission']) => {
      await writeSystemEntry(
        {
          branchId,
          content: describePassFailure(refusal, submission).content,
          failure: toPassFailureMeta(refusal, submission),
        },
        ctx,
      )
      await reload()
    },
    [branchId, reload],
  )

  type DroppedSystemEntry = { content: string; failure: SystemFailureMeta | undefined }

  // A prior failure leaves a system entry as the branch tail; drop it (and
  // resync the store) before a dispatch so the pipeline's prompt/position reads
  // the real content tail, not the failure singleton.
  // Read before the drop, so a caller whose drop or resync throws still holds the entry's text
  // (composer-draft.ts → SubmissionHandback).
  const systemTail = useCallback((): DroppedSystemEntry | null => {
    const tail = [...entriesStore.getEntries().values()].find(
      (e) => e.branchId === branchId && e.kind === 'system',
    )
    return tail ? { content: tail.content, failure: tail.metadata?.systemFailure } : null
  }, [branchId])

  // entry-card.md → State problems: once per turn, beside the card's alert toggle that stays.
  const notifyUnappliedState = useCallback(
    (started: string) => {
      if (!branchUnchanged(started)) return
      const reply = latestReplyOf(entriesStore.getEntries().values(), started)
      const role = unappliedStateRole(reply?.metadata?.stateReport)
      if (role != null)
        toast.warning(
          t(
            role === 'classifier'
              ? 'reader:stateUnappliedClassifier'
              : 'reader:stateUnappliedNarrative',
          ),
        )
    },
    [branchUnchanged],
  )

  const dropSystemTail = useCallback(
    async (tail: DroppedSystemEntry | null): Promise<void> => {
      if (!tail) return
      await clearSystemEntry(branchId, ctx)
      await reload()
    },
    [branchId, reload],
  )

  // Only safe to call where nothing else changed: writeSystemEntry re-appends at
  // MAX(position) + 1, so on a path that already swept entries this would park a
  // stale failure over a branch it no longer describes.
  const restoreSystemTail = useCallback(
    async (dropped: DroppedSystemEntry | null) => {
      if (!dropped) return
      await writeSystemEntry(
        {
          branchId,
          content: dropped.content,
          ...(dropped.failure ? { failure: dropped.failure } : {}),
        },
        ctx,
      )
      await reload()
    },
    [branchId, reload],
  )

  // Position-independent, unlike restoreSystemTail: safe where a sweep already moved the
  // tail. Content is stored wrapped, so it returns under 'free' — no re-wrap on send.
  const handBackSubmission = useCallback(
    (submission: SystemFailureMeta['submission']) => {
      const plan = planSubmissionHandback(submission, composerRef.current?.getDraft())
      if (plan.action === 'none') return
      if (plan.action === 'no-composer') {
        logger.warn('reader.failed_turn_text_unmounted', { branchId })
        return
      }
      if (plan.action === 'keep-draft') {
        toast.info(t('reader:failedTurnTextDropped'))
        return
      }
      composerRef.current?.restoreDraft(plan.content, 'free')
      toast.info(t('reader:failedTurnTextRestored'))
    },
    [branchId],
  )

  // `editBlocked` rises a queue hop and several awaits after the tap; only Send survives the gap
  // (the composer clears), so each dispatch marks it: ref is the sync guard, state disables.
  const dispatchInFlightRef = useRef(false)
  const [dispatchInFlight, setDispatchInFlight] = useState(false)
  const beginDispatch = useCallback((): boolean => {
    if (dispatchInFlightRef.current) return false
    dispatchInFlightRef.current = true
    setDispatchInFlight(true)
    return true
  }, [])
  const endDispatch = useCallback(() => {
    dispatchInFlightRef.current = false
    setDispatchInFlight(false)
  }, [])
  // What every user-edit affordance gates on: the generation gate alone leaves
  // the pre-registration window open.
  const actionsBlocked = editBlocked || dispatchInFlight
  // Same pre-registration guard as actionsBlocked, over the head reversals' own gate.
  const headReversalBlocked = headReversalGateHeld || dispatchInFlight
  const editGate = editGateOf({ editBlocked: actionsBlocked, headReversalBlocked })
  const gateRunKind = generationStore.useGeneration((s) =>
    selectStorySettingsGenerationRunKind(s.txState, storyId ?? undefined),
  )
  const gateReason = generationGateReason(actionsBlocked, gateRunKind)
  // Beside a pass the pill names the pass, but a head reversal waits on the run it can't interrupt.
  const headReversalRunKind = generationStore.useGeneration((s) =>
    selectHeadReversalRunKind(s.txState, branchId),
  )
  const headReversalReason = headReversalGateReason(headReversalBlocked, {
    headReversal: headReversalRunKind,
    pill: gateRunKind,
  })

  const runSubmit = useCallback(
    async (content: string, composerMode: string, raw?: { text: string; mode: ComposerMode }) => {
      if (!storyId || !hydrationSucceeded) return
      if (!beginDispatch()) {
        logger.warn('pipeline.submit_dispatch_suppressed', { branchId })
        return
      }
      const submission = { content, composerMode }
      try {
        // A Send supersedes the entry's text, written while that entry and its Retry stood, so
        // only the arm that puts the entry back reads `dropped` (reader-composer.md → Custody).
        const dropped = systemTail()
        await dropSystemTail(dropped)
        setLastSubmission(submission)
        setSendPending(true)
        const result = await submitTurn(
          { storyId, branchId },
          { content, composerMode },
          ctx,
        ).finally(() => setSendPending(false))
        const refusal = passRefusalOf(result)
        if (refusal != null) {
          // The Send wrote nothing, so its text goes back to the composer or onto the entry.
          setLastSubmission(null)
          await settlePassFailureCustody({
            held: refusal.held,
            custodyNow: () =>
              readPassFailureCustody({
                stillOnBranch: branchUnchanged(branchId),
                composer: composerRef.current,
              }),
            write: (withSubmission) =>
              showPassFailure(refusal, withSubmission ? submission : undefined),
            restoreDraft: () =>
              composerRef.current?.restoreDraft(raw?.text ?? content, raw?.mode ?? 'free'),
          })
        } else if (result.outcome === 'failed') await showTurnFailure(result.error, submission)
        else if (result.outcome === 'rejected' && !result.converged) {
          // The refused turn's user_action is still in the branch, so a Retry would duplicate
          // it: the same hazard regenerate's unconverged arm refuses. A failed resync must not
          // reach the catch below either, since its failure entry offers that Retry.
          setLastSubmission(null)
          toast.error(t('reader:submitUnconverged'))
          await reload().catch((err: unknown) =>
            logger.error('pipeline.submit_resync_failed', {
              branchId,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        } else if (result.outcome === 'rejected')
          await showTurnFailure(
            {
              kind: 'orchestrator',
              // The detail line persists on the entry and renders to the user,
              // so the prose is translated; blockedBy itself is a pipeline kind
              // and stays verbatim as the diagnostic token.
              detail: t('reader:systemEntry.blockedDetail', { reason: result.blockedBy }),
            },
            submission,
          )
        else if (result.outcome === 'aborted') {
          // Cancelled during its owed pass, the Send wrote nothing, so the entry it cleared
          // goes back with its own Retry: a turn entry resends its own text, not this Send's.
          const putBack = abortedBeforeTurn(result) ? dropped : null
          await restoreSystemTail(putBack)
          if (branchUnchanged(branchId)) {
            if (putBack != null) setLastSubmission(putBack.failure?.submission ?? null)
            // Cancel reverses the whole turn (user_action too, C6): hand the text back. A retry
            // lacks raw pre-wrap text, so wrapped content returns under 'free' (no re-wrap). Only
            // into an empty composer: Retry re-enters uncleared and would overwrite mid-turn text.
            if (isDraftEmpty(composerRef.current?.getDraft()))
              composerRef.current?.restoreDraft(raw?.text ?? content, raw?.mode ?? 'free')
            else toast.info(t('reader:turnCancelledDraftKept'))
          }
        } else if (result.outcome === 'completed') notifyUnappliedState(branchId)
      } catch (err) {
        // submitTurn throws on a rejected user_action write — treat a thrown
        // failure like a structured 'failed' outcome so the UI surfaces an
        // error and stays retriable instead of hanging.
        await showTurnFailure(
          {
            kind: 'orchestrator',
            detail: err instanceof Error ? err.message : String(err),
          },
          submission,
        )
      } finally {
        endDispatch()
      }
    },
    [
      storyId,
      branchId,
      hydrationSucceeded,
      systemTail,
      dropSystemTail,
      restoreSystemTail,
      showTurnFailure,
      showPassFailure,
      beginDispatch,
      endDispatch,
      branchUnchanged,
      reload,
      notifyUnappliedState,
    ],
  )

  // Guarded here, not at the callers: the immediate tap and the confirm both funnel through it.
  // Resolves to the action's refusal, which a confirmed regenerate re-opens its confirm on.
  const runRegenerate = useCallback(
    async (
      targetId: string,
      expectedCounts?: RollbackCounts,
    ): Promise<RegenerateRefusal | null> => {
      if (!storyId || !hydrationSucceeded) return null
      if (!beginDispatch()) {
        logger.warn('pipeline.regenerate_dispatch_suppressed', { branchId, entryId: targetId })
        return null
      }
      try {
        const dropped = systemTail()
        const droppedHandback = (
          owed: SystemFailureMeta['submission'],
          settle: () => Promise<string | null>,
        ) =>
          settleWithDroppedHandback({
            branchId,
            dropped: owed,
            settle,
            stillOnBranch: () => branchUnchanged(branchId),
            handBack: handBackSubmission,
          })
        // Scoped to the action alone: a throw out of the arms below happens
        // *after* it returned, with the user's text in hand, so it must not
        // inherit the "no submission to hand back" premise the throw arm encodes.
        const ran = await runBehindTailDrop({
          hasTail: dropped != null,
          clear: () => clearSystemEntry(branchId, ctx),
          reload,
          run: () => regenerateTurn({ storyId, branchId }, targetId, ctx, { expectedCounts }),
        })
        if (ran.status === 'threw') {
          // A toast, not a failure entry: the throw carries no userActionContent,
          // and a system entry's Retry renders unconditionally — it would offer a
          // resubmit that is doomed (nothing to send) or wrong (a stale earlier
          // submission duplicated over the standing user_action).
          logger.error('pipeline.regenerate_threw', {
            branchId,
            entryId: targetId,
            error: ran.error instanceof Error ? ran.error.message : String(ran.error),
          })
          toast.error(t('reader:regenerateFailed'))
          // A DeltaReplayError can commit its transaction and fail the store sync,
          // leaving entriesStore holding rows the sweep already deleted. A committed
          // clear destroyed an earlier failure's only copy of its text: restoreSystemTail
          // is unsafe here (the tail may have moved), the draft isn't.
          await droppedHandback(
            ran.entryDestroyed ? dropped?.failure?.submission : undefined,
            async () => {
              await reload()
              return null
            },
          )
          return null
        }
        const regen = ran.value
        if (regen.status === 'rejected') {
          logger.warn('pipeline.regenerate_rejected', {
            branchId,
            entryId: targetId,
            reason: regen.reason,
          })
          // Every rejection fires before the first sweep, so nothing else moved
          // and putting the failure entry back is an exact undo of the drop.
          await restoreSystemTail(dropped)
          toast.error(t(regenerateRefusalCopy(regen)))
          return regen
        }
        const { result } = regen
        if (result.outcome === 'completed') notifyUnappliedState(branchId)
        // A branch switch under the dispatch makes the composer's draft another
        // branch's, so it can neither decide this plan nor receive its text.
        const stillHere = branchUnchanged(branchId)
        const plan = planRegenerateOutcome({
          outcome: result.outcome,
          converged: regen.converged,
          draftEmpty: stillHere && isDraftEmpty(composerRef.current?.getDraft()),
        })
        // The convergence submission: regenerate's non-success paths unwound the
        // user_action, so Retry re-enters through the normal submit path. Wrapped
        // text returns under 'free' (no re-wrap on send), same as cancel-restore.
        const submission = { content: regen.userActionContent, composerMode: 'free' }
        // Every arm below destroyed the dropped entry for good, so its text follows the arm's own.
        await droppedHandback(dropped?.failure?.submission, () =>
          settleRegenerateArm({
            action: plan.action,
            userActionContent: regen.userActionContent,
            arm: async () => {
              if (plan.action === 'refuse-unconverged') {
                // The unwind didn't land, so the user_action is still in the branch.
                // Neither a Retry nor a draft-restore can offer its text without
                // duplicating it — the same hazard the throw arm above refuses.
                logger.error('pipeline.regenerate_unconverged', {
                  branchId,
                  entryId: targetId,
                  outcome: result.outcome,
                })
                toast.error(t('reader:regenerateFailed'))
              } else if (plan.action === 'write-failure-entry' && result.outcome === 'failed') {
                if (stillHere) setLastSubmission(submission)
                await writeTurnFailure(result.error, submission)
              } else if (plan.action === 'write-blocked-entry' && result.outcome === 'rejected') {
                if (stillHere) setLastSubmission(submission)
                await writeTurnFailure(
                  {
                    kind: 'orchestrator',
                    detail: t('reader:systemEntry.blockedDetail', { reason: result.blockedBy }),
                  },
                  submission,
                )
              } else if (plan.action === 'restore-draft') {
                composerRef.current?.restoreDraft(regen.userActionContent, 'free')
              } else if (plan.action === 'keep-draft' && stillHere) {
                // The swept action is unrecoverable either way, but they asked to
                // discard it; the draft they typed they never agreed to lose.
                toast.info(t('reader:regenerateCancelledDraftKept'))
              }
            },
            resync: () => (plan.resync ? reload() : Promise.resolve()),
            onThrow: (err) => {
              logger.error('pipeline.regenerate_outcome_handling_threw', {
                branchId,
                entryId: targetId,
                outcome: result.outcome,
                error: err instanceof Error ? err.message : String(err),
              })
              toast.error(t('reader:regenerateFailed'))
            },
            // Re-read rather than reuse `stillHere`: the arm awaited.
            draftFree: () =>
              branchUnchanged(branchId) && isDraftEmpty(composerRef.current?.getDraft()),
            restoreDraft: (text) => composerRef.current?.restoreDraft(text, 'free'),
          }),
        )
        return null
      } finally {
        endDispatch()
      }
    },
    [
      storyId,
      branchId,
      hydrationSucceeded,
      systemTail,
      restoreSystemTail,
      reload,
      writeTurnFailure,
      beginDispatch,
      endDispatch,
      branchUnchanged,
      handBackSubmission,
      notifyUnappliedState,
    ],
  )

  // Derived from the persisted entry, not React state, so the failure kind,
  // fix action, and retryable submission all survive an app restart.
  const systemFailure = useMemo(
    () => entries.find((e) => e.kind === 'system')?.metadata?.systemFailure,
    [entries],
  )

  const handleDismissSystemEntry = useCallback(
    () =>
      dismissSystemEntry({
        branchId,
        submission: systemFailure?.submission,
        clear: () => clearSystemEntry(branchId, ctx),
        reload,
        stillOnBranch: () => branchUnchanged(branchId),
        handBack: handBackSubmission,
      }),
    [branchId, reload, handBackSubmission, systemFailure, branchUnchanged],
  )

  // Held until the pass ends: no double tap or Send slips in, head reversals wait;
  // the pill's Cancel still ends the pass.
  const retryPass = useCallback(async () => {
    if (!beginDispatch()) {
      logger.warn('pipeline.pass_retry_dispatch_suppressed', { branchId })
      return
    }
    const stored = systemFailure?.submission
    try {
      await retryPassEntry({
        runPass: () => runClassifierNow(branchId, ctx),
        held: () => isClassifierHeld(branchId, ctx),
        committed: () =>
          settleCommittedPassRetry({
            stored,
            custodyNow: () =>
              readPassFailureCustody({
                stillOnBranch: branchUnchanged(branchId),
                composer: composerRef.current,
              }),
            clear: () => clearSystemEntry(branchId, ctx),
            reload,
            handBack: handBackSubmission,
            keepNotice: async (submission) => {
              await writeSystemEntry({ branchId, ...passResolvedEntry(submission) }, ctx)
              await reload()
            },
          }),
        rewrite: (refusal) =>
          settlePassRetryCustody({
            held: refusal.held,
            stored,
            stillOnBranch: () => branchUnchanged(branchId),
            draft: () => composerRef.current?.getDraft(),
            toSubmission: (draft) =>
              draftSubmission(draft, {
                modesUsable: modesEnabled && modesUnavailableReason == null,
                pov: wrapPov,
                leadName,
              }),
            write: (submission) => showPassFailure(refusal, submission),
            clearDraft: () => {
              const composer = composerRef.current
              composer?.restoreDraft('', composer.getDraft().mode)
            },
          }),
        notify: (message) => toast.info(message),
      })
    } finally {
      endDispatch()
    }
  }, [
    branchId,
    systemFailure,
    showPassFailure,
    handBackSubmission,
    reload,
    beginDispatch,
    endDispatch,
    branchUnchanged,
    modesEnabled,
    modesUnavailableReason,
    wrapPov,
    leadName,
  ])

  const { onRetry: retrySystemEntry, fixAction } = useSystemEntryActions(
    systemFailure,
    () => {
      // A pass-failure entry's Retry runs the pass alone (classifier.md → Failure policy).
      if (systemFailure?.pass === 'failed') {
        runAction(retryPass(), {
          event: 'reader.pass_retry_failed',
          toastMessage: t('reader:passRetryFinishFailed'),
        })
        return
      }
      const submission = lastSubmission ?? systemFailure?.submission
      if (submission) void runSubmit(submission.content, submission.composerMode)
    },
    storyId,
    guardLeave,
  )

  const openRollback = useCallback(
    async (targetId: string) => {
      // A tapped delete silently doing nothing reads as broken — and the count
      // read is a DB round trip that can reject as well as refuse.
      let counts: RollbackCounts | StoryEntryRejection
      const countedAtSettle = generationStore.getSettleCount()
      try {
        counts = await getRollbackCounts(branchId, targetId, ctx)
      } catch (err) {
        logger.error('action_layer.rollback_counts_threw', {
          branchId,
          entryId: targetId,
          error: err instanceof Error ? err.message : String(err),
        })
        toast.error(t('reader:rollbackFailed'))
        return
      }
      if ('status' in counts) {
        toast.error(t('reader:rollbackFailed'))
        return
      }
      const target = entriesStore.getById(targetId)
      setRollback({
        mode: 'rollback',
        targetId,
        targetNumber: target?.position ?? 0,
        counts,
        countedAtSettle,
      })
    },
    [branchId],
  )

  const showLiveCounts = useCallback(
    (counts: RollbackCounts) =>
      setRollback((prev) =>
        prev == null || sameRollbackCounts(prev.counts, counts) ? prev : { ...prev, counts },
      ),
    [],
  )
  useLiveRollbackCounts({
    branchId,
    target: rollback,
    load: loadRollbackCounts,
    onCounts: showLiveCounts,
  })

  const reopenConfirm = useCallback(
    (confirmed: ConfirmState, refusal: RollbackRefusal | RegenerateRefusal) => {
      const stillOnBranch = branchUnchanged(branchId)
      setRollback((current) => reopenAfterRefusal({ current, confirmed, refusal, stillOnBranch }))
    },
    [branchId, branchUnchanged],
  )

  const confirmRollback = useCallback(async () => {
    if (!rollback) return
    const confirmed = rollback
    if (confirmed.mode === 'regenerate') {
      // Close before the stream starts; the streaming card takes over the surface.
      setRollback(null)
      const refusal = await runRegenerate(confirmed.targetId, confirmed.counts)
      if (refusal != null) reopenConfirm(confirmed, refusal)
      return
    }
    const result = await rollbackToEntry(branchId, confirmed.targetId, ctx, {
      expectedCounts: confirmed.counts,
    })
    if (result.status === 'rejected') {
      toast.error(t(rollbackRefusalCopy(result)))
      reopenConfirm(confirmed, result)
      return
    }
    setRollback(null)
  }, [branchId, rollback, runRegenerate, reopenConfirm])

  const handleCommitEdit = useContentEditing(branchId, ctx, reload)

  const handleRequestRegenerate = useCallback(
    async (entryId: string) => {
      // Opening a confirm whose dispatch the in-flight guard will drop leaves
      // the user watching the modal close on nothing.
      if (dispatchInFlightRef.current) return
      const startedBranchId = branchId
      let counts: RollbackCounts | StoryEntryRejection | null
      const countedAtSettle = generationStore.getSettleCount()
      try {
        counts = await loadRegenerateCountsIfCurrent(
          () => getRollbackCounts(startedBranchId, entryId, ctx),
          () => ({
            startedBranchId,
            currentBranchId: branchIdRef.current,
            loadedBranchId: entriesStore.getLoadedBranch(),
            dispatchInFlight: dispatchInFlightRef.current,
            headReversalBlocked: generationStore.isHeadReversalBlocked(startedBranchId),
          }),
        )
      } catch (err) {
        // The count read is a DB round trip of its own: a throw here leaves the
        // tapped ↻ doing nothing at all, which reads as broken.
        logger.error('pipeline.regenerate_counts_threw', {
          branchId: startedBranchId,
          entryId,
          error: err instanceof Error ? err.message : String(err),
        })
        toast.error(t('reader:regenerateFailed'))
        return
      }
      if (counts == null) return
      if ('status' in counts) {
        toast.error(t('reader:regenerateFailed'))
        return
      }
      if (classifyRegenerateGate(counts) === 'immediate') {
        await runRegenerate(entryId)
        return
      }
      // Both confirm arms open the cascade modal in M3; M5.2 swaps the
      // chapter-close arm's copy without touching this path.
      const target = entriesStore.getById(entryId)
      setRollback({
        mode: 'regenerate',
        targetId: entryId,
        targetNumber: target?.position ?? 0,
        counts,
        countedAtSettle,
      })
    },
    [branchId, runRegenerate],
  )

  // Chips are finished prose, so the draft is replaced outright and the mode
  // forced to Free — no wrapping (reader-composer.md → Next-turn suggestions).
  const handleTapChip = useCallback((text: string) => {
    composerRef.current?.restoreDraft(text, 'free')
  }, [])

  const handleToggleStripCollapsed = useCallback(() => setStripCollapsed((prev) => !prev), [])

  const handleCancelSuggestions = useCallback(() => {
    void awaitRunTerminal(SUGGESTION_REFRESH_KIND, branchId, 'cancel')
  }, [branchId])

  const handleCancelComposer = useCallback(
    () => void cancelComposerRun(branchId, sendPending),
    [branchId, sendPending],
  )
  // In Send's gap no run holds the pill, so its Cancel is the composer's: it awaits the next run.
  const handleCancelPill = useCallback(() => {
    if (sendGapOpen(generationStore.getTxState(), branchId, sendPending)) handleCancelComposer()
    else void cancelPillRun(branchId)
  }, [branchId, sendPending, handleCancelComposer])

  // Read at settle time, not from the closure: a branch-switch abort whose
  // reverse-replay fails resolves 'failed' well after the switch, and the
  // error belongs to the strip that fired it. The entry ref alone would cover
  // it (ids are globally unique, and a switch nulls the tail); the branch ref
  // stays so the guard is legible without trusting that cross-module invariant.
  const terminalEntryIdRef = useRef(terminalEntry?.id)
  // Published from the commit, like branchIdRef: the guard below reads both, and
  // an anchor from a render that never landed would fail it against live state.
  useLayoutEffect(() => {
    terminalEntryIdRef.current = terminalEntry?.id
  }, [terminalEntry?.id])

  const handleRefreshSuggestions = useCallback(() => {
    if (
      suggestionRefreshBlocked(generationStore.getTxState(), branchId, dispatchInFlightRef.current)
    )
      return
    const anchor = terminalEntry
    const story = openForBranch
    // The phase resolves its own anchor; this only proves there is one to
    // resolve, and captures which strip an eventual failure belongs to.
    if (anchor == null || story == null) return
    setStripError(null)
    const startedBranchId = branchId
    const startedEntryId = anchor.id
    const fail = (error: PipelineError) => {
      if (branchIdRef.current === startedBranchId && terminalEntryIdRef.current === startedEntryId)
        setStripError(error)
    }
    void refreshSuggestions(
      { storyId: story.storyId, branchId },
      { refreshGuidance: composerRef.current?.getDraft().text ?? '' },
      ctx,
    )
      // 'rejected' is the self-block a second ⟳ hits while one runs, and
      // 'aborted' is a cancel or a branch switch — neither is a failure.
      .then((result) => {
        if (result.outcome === 'failed') fail(result.error)
      })
      .catch((e: unknown) => {
        // Logged outside the strip guard: a throw that lands after a branch
        // switch still has to leave a trace, and beginRun's own unwind path
        // rethrows without logging.
        logger.error('pipeline.suggestion_refresh_threw', {
          branchId: startedBranchId,
          entryId: startedEntryId,
          error: e instanceof Error ? e.message : String(e),
        })
        fail({ kind: 'orchestrator', detail: e instanceof Error ? e.message : String(e) })
      })
  }, [terminalEntry, openForBranch, branchId])

  const handleReady = useCallback(async () => {
    // Boot/reload handshake: emissions before onReady are lost, so bump the
    // nonce to force a fresh full-prop emission, and re-arm the loading veil.
    setDocumentPainted(false)
    setSyncNonce((n) => n + 1)
  }, [])

  const handleFirstPaint = useCallback(async () => {
    setDocumentPainted(true)
  }, [])

  // Recovery reloads re-request the document's own URL; blocking that freezes
  // the surface. Everything else is dropped — entry hrefs are stripped at
  // sanitize, so any foreign navigation is hostile or a sanitize regression.
  // The latch must only ever accept a
  // document-shaped URL (Metro in dev, bundled file/about otherwise): Android
  // fires no request callback for the initial loadUrl, so an unguarded latch
  // would record the first foreign navigation as "own URL" and allow it.
  const documentUrlRef = useRef<string | null>(null)
  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    if (documentUrlRef.current != null) return request.url === documentUrlRef.current
    if (/^(file:|about:|https?:\/\/localhost[:/])/i.test(request.url)) {
      documentUrlRef.current = request.url
      return true
    }
    return false
  }, [])

  // Every rejection is logged; only the actionable ones are shown. `integrity` means
  // the delta log cannot produce the reversal it should — an error, not "Nothing to
  // undo." A branch-not-loaded rejection is a branch-switch race that resolves itself.
  const reportUndoRejection = useCallback(
    (
      op: 'undo' | 'redo',
      result: { code: UndoRejectionCode; reason: string },
      silent = false,
    ): void => {
      const isUndo = op === 'undo'
      const fields = { branchId, code: result.code, reason: result.reason }
      if (result.code === 'integrity')
        logger.error(isUndo ? 'reader.undo_failed' : 'reader.redo_failed', fields)
      else logger.debug(isUndo ? 'reader.undo_rejected' : 'reader.redo_rejected', fields)
      if (silent) return
      if (result.code === 'integrity')
        toast.error(t(isUndo ? 'reader:actions.undoFailed' : 'reader:actions.redoFailed'))
      else if (result.code === 'nothing-to-apply')
        toast.info(t(isUndo ? 'reader:actions.nothingToUndo' : 'reader:actions.nothingToRedo'))
      else if (result.code === 'gated') toast.info(t('reader:actions.blockedWhileGenerating'))
    },
    [branchId],
  )

  // The one place op maps to its action, log event and toast. Two failure notions
  // share the flow: a rejection toasts unless `silent` (the keyboard path, by the
  // native undo convention); a thrown failure toasts on both paths, via runAction.
  const runUndoRedo = useCallback(
    (op: 'undo' | 'redo', silent = false) =>
      runAction(
        (op === 'redo' ? redoLastAction(branchId, ctx) : undoLastAction(branchId, ctx)).then(
          (result) => {
            // Silent to the user, never unlogged: an integrity rejection looks
            // identical to an empty history.
            if (result.status === 'rejected') reportUndoRejection(op, result, silent)
          },
        ),
        {
          event: op === 'redo' ? 'reader.redo_failed' : 'reader.undo_failed',
          toastMessage: t(
            op === 'redo' ? 'reader:actions.redoFailed' : 'reader:actions.undoFailed',
          ),
        },
      ),
    [branchId, reportUndoRejection],
  )

  // Editable-target exclusion lets the browser's native undo/redo win when
  // focus is in a text input — otherwise Ctrl/Cmd+Z on a composer typo
  // reverses the last story turn instead of the typo.
  const handleUndoRedoShortcut = useCallback(
    (ev: KeyboardEvent) => runUndoRedo(ev.shiftKey ? 'redo' : 'undo', true),
    [runUndoRedo],
  )
  useGlobalHotkey(matchesUndoRedoShortcut, handleUndoRedoShortcut, {
    ignoreEditableTargets: true,
    enabled: isFocused,
  })

  // Touch-tier path to undo/redo (the shortcut is keyboard-only).
  const hasRedo = undoRedoStore.useUndoRedo((s) => s.redoStack.length > 0)
  // Engage/settle semantics live in the surface's own jumpToBottom; the host
  // only routes the request to whichever mount is live on this platform.
  const jumpToBottom = useCallback(() => {
    if (Platform.OS === 'web') surfaceRef.current?.jumpToBottom()
    else documentRef.current?.jumpToBottom()
  }, [])

  const handleRetrySystemEntry = useCallback(async () => retrySystemEntry?.(), [retrySystemEntry])
  const handleFixSystemEntry = useCallback(async () => fixAction?.onPress(), [fixAction])
  // Editable-target exclusion keeps End moving the caret inside the composer.
  useGlobalHotkey(matchesJumpToBottomShortcut, jumpToBottom, {
    ignoreEditableTargets: true,
    enabled: isFocused,
  })
  const contextualActions: ActionGroup = useMemo(() => {
    // Undo of the turn is a head reversal, live through a pass; the action refuses any other
    // target with `gated`. Redo never is one, so it keeps the whole gate.
    return {
      id: 'reader',
      header: t('chrome.onThisScreen'),
      entries: [
        {
          id: 'undo',
          label: t('reader:actions.undo'),
          disabled: headReversalBlocked,
          disabledReason: headReversalReason,
          onActivate: () => runUndoRedo('undo'),
        },
        // Absent, not disabled, when the stack is empty — the menu doesn't
        // surface dead commands (actions-menu spec); emptiness is store-derived
        // and cheap, unlike undo's DB-backed target lookup.
        ...(hasRedo
          ? [
              {
                id: 'redo',
                label: t('reader:actions.redo'),
                disabled: actionsBlocked,
                disabledReason: gateReason,
                onActivate: () => runUndoRedo('redo'),
              },
            ]
          : []),
        ...(entries.length > 0
          ? [{ id: 'jump-to-bottom', label: t('reader:jumpToBottom'), onActivate: jumpToBottom }]
          : []),
      ],
    }
  }, [
    hasRedo,
    actionsBlocked,
    headReversalBlocked,
    headReversalReason,
    gateReason,
    runUndoRedo,
    entries.length,
    jumpToBottom,
  ])

  const streamingPayload = useMemo(
    () =>
      streamingVisible
        ? { content: streaming?.content ?? '', reasoning: streaming?.reasoning ?? '' }
        : null,
    [streamingVisible, streaming],
  )

  const jumpButtonEnabled = appSettingsStore.useAppSettings((s) => s.appearance.showJumpToBottom)
  const openRegionPct = useOpenRegionTokens(openForBranch?.storyId)
  const { theme } = useTheme()

  useLayoutEffect(() => {
    readerRailStore.enterBranch(branchId)
  }, [branchId])

  // One read for whichever rail mounts: the column and peek drawer, or the phone chip's Sheet.
  const railData = useRailData(branchId)

  const placeholder = readerPlaceholder({
    hydrationSucceeded,
    isEmpty: entries.length === 0,
  })

  const surfaceProps = {
    rows: entries,
    worldTimeDecorations,
    worldTimeFrame,
    streaming: streamingPayload,
    branchKey: branchId,
    hasOlder,
    editGate,
    gateReason: rowGateReason(editGate, { gate: gateReason, headReversal: headReversalReason }),
    jumpButtonEnabled,
    systemFixLabel: fixAction?.label,
    onNearTop: loadOlderEntries,
    onCommitEdit: handleCommitEdit,
    onRequestRollback: openRollback,
    onEditWorldTime: editWorldTime,
    onRequestEditWorldTime: requestEditWorldTime,
    entityNames,
    sceneOptions,
    tailEntryId,
    onEditScene: editScene,
    onRequestEditScene: requestEditScene,
    onRegenerate: handleRequestRegenerate,
    // Undefined for a held pass entry: its branch can't run a pass.
    onRetrySystemEntry: retrySystemEntry != null ? handleRetrySystemEntry : undefined,
    onDismissSystemEntry: handleDismissSystemEntry,
    onFixSystemEntry: handleFixSystemEntry,
  }

  return (
    <ScreenShell
      variant="in-story"
      title={
        <TruncatedText className="font-semibold" containerClassName="min-h-touch justify-center">
          {storyTitle ?? t('reader:placeholderTitle')}
        </TruncatedText>
      }
      chapterProgress={openRegionPct}
      mobileChipAction={
        tier === 'phone' ? (
          <ReaderBrowseChip
            data={railData}
            storyId={storyId}
            blocked={actionsBlocked}
            blockedReason={gateReason}
            onNavigate={surfaceNavigate}
          />
        ) : undefined
      }
      onBack={() => router.back()}
      onOpenStorySettings={() => {
        if (storyId != null) surfaceNavigate(`/story-settings/${storyId}`)
      }}
      actions={
        <AppActionsMenu
          contextual={contextualActions}
          story={storyId != null ? { storyId, branchId, surface: 'reader' } : undefined}
          beforeLeaveStory={guardLeave}
          blocked={rollback != null || timeEdit != null}
        />
      }
      statusSlot={
        <StoryStatusPill
          storyId={storyId}
          swapTarget={swapTarget}
          activePhase={activePhase}
          beforeTurn={pillBeforeTurn}
          // Absent while nothing runs on the branch: a no-op handler would still open the popover.
          {...(pillRunKind != null || refreshingSuggestions || sendGap
            ? { onCancel: handleCancelPill }
            : {})}
          onOpenMemory={() => {
            if (storyId != null) router.push(`/story-settings/${storyId}?tab=memory`)
          }}
        />
      }
    >
      <View className="flex-1 flex-row">
        <KeyboardInsetColumn>
          <View className="flex-1">
            {placeholder ? (
              <View className="flex-1 items-center justify-center">
                <EmptyState title={placeholder.title} subtext={placeholder.subtext} />
              </View>
            ) : Platform.OS === 'web' ? (
              <ReaderSurface {...surfaceProps} ref={surfaceRef} />
            ) : (
              <View className="flex-1">
                <ReaderDocument
                  {...surfaceProps}
                  ref={documentRef}
                  themeId={theme.id}
                  syncNonce={syncNonce}
                  onReady={handleReady}
                  onFirstPaint={handleFirstPaint}
                  dom={{
                    scrollEnabled: false,
                    style: { flex: 1 },
                    webviewDebuggingEnabled: __DEV__,
                    onShouldStartLoadWithRequest: handleShouldStartLoad,
                  }}
                />
                {!documentPainted ? (
                  <View className="absolute inset-0 items-center justify-center bg-bg-base">
                    <EmptyState title={t('reader:hydrationLoading')} />
                  </View>
                ) : null}
              </View>
            )}
          </View>
          {stripVisible ? (
            <SuggestionStrip
              contentClassName="mx-auto w-full max-w-[860px]"
              phase={stripPhase}
              collapsed={stripCollapsed}
              chips={chips}
              categories={suggestionCategories}
              errorMessage={stripErrorMessage}
              errorFix={stripErrorFix}
              canRefresh={canRefreshSuggestions}
              onTapChip={handleTapChip}
              onRefresh={handleRefreshSuggestions}
              onCancel={handleCancelSuggestions}
              onToggleCollapsed={handleToggleStripCollapsed}
              disabled={headReversalBlocked}
            />
          ) : null}
          <View className="border-t border-border px-6 pb-3.5 pt-3">
            <View className="mx-auto w-full max-w-[860px]">
              <Composer
                ref={composerRef}
                modesEnabled={modesEnabled}
                isGenerating={isGenerating}
                disabled={!hydrationSucceeded || swapPending}
                sendBlocked={actionsBlocked}
                disabledReason={composerDisabledReason({
                  hydrationSucceeded,
                  swapPending,
                  gateReason,
                })}
                modesUnavailableReason={modesUnavailableReason}
                onSend={(rawText, mode) => {
                  const wrapped = wrapComposerText(rawText, { mode, pov: wrapPov, leadName })
                  void runSubmit(wrapped, mode, { text: rawText, mode })
                }}
                onCancel={handleCancelComposer}
              />
            </View>
          </View>
        </KeyboardInsetColumn>
        {showRail ? (
          <>
            <ReaderRailColumn data={railData} isFocused={isFocused} />
            <ReaderPeekDrawer
              data={railData}
              isFocused={isFocused}
              storyId={storyId}
              blocked={actionsBlocked}
              blockedReason={gateReason}
              onNavigate={surfaceNavigate}
            />
          </>
        ) : null}
      </View>
      {/* Focus-gated: a refusal can re-open it after the user moved to another in-story screen. */}
      {rollback && isFocused ? (
        <RollbackConfirmModal
          open
          onOpenChange={(open) => {
            if (!open) setRollback(null)
          }}
          targetEntryNumber={rollback.targetNumber}
          counts={rollback.counts}
          variant={rollback.mode}
          onConfirm={() =>
            runAction(confirmRollback(), {
              event:
                rollback.mode === 'regenerate'
                  ? 'reader.regenerate_failed'
                  : 'reader.rollback_failed',
              toastMessage:
                rollback.mode === 'regenerate'
                  ? t('reader:regenerateFailed')
                  : t('reader:rollbackFailed'),
            })
          }
        />
      ) : null}
      {timeEdit != null && worldTimeFrame != null ? (
        <WorldTimeEditSheet
          frame={worldTimeFrame}
          worldTimeRaw={timeEdit.decoration.raw}
          monotonicityBreak={
            timeEdit.decoration.previousLabel != null
              ? { previousLabel: timeEdit.decoration.previousLabel }
              : undefined
          }
          onSave={async (next) => {
            const result = await editWorldTime(timeEdit.entryId, next)
            return result.ok
          }}
          onClose={closeTimeEdit}
        />
      ) : null}
      {sceneEdit != null ? (
        <SceneEditSheet
          sceneEntities={sceneEdit.sceneEntities}
          currentLocationId={sceneEdit.currentLocationId}
          options={sceneOptions}
          onSave={(next) => editScene(sceneEdit.entryId, next)}
          onClose={closeSceneEdit}
        />
      ) : null}
      {storyLeaveDialog}
    </ScreenShell>
  )
}
