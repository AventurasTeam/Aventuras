import { useIsFocused } from '@react-navigation/native'
import { and, desc, eq, lt } from 'drizzle-orm'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Platform, View } from 'react-native'

import { type ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { Composer, type ComposerHandle } from '@/components/reader/composer'
import { isDraftEmpty } from '@/components/reader/composer-draft'
import { readerPillPhase } from '@/components/reader/generation-phase'
import { KeyboardInsetColumn } from '@/components/reader/keyboard-inset-column'
import ReaderDocument, { type ReaderDocumentRef } from '@/components/reader/reader-document'
import {
  type EditResult,
  type ReaderSurfaceHandle,
} from '@/components/reader/reader-document-types'
import { ReaderSurface } from '@/components/reader/reader-surface'
import {
  classifyRegenerateGate,
  loadRegenerateCountsIfCurrent,
} from '@/components/reader/regenerate-gate'
import {
  planRegenerateOutcome,
  shouldRestoreUserActionAfterHandlingFailure,
} from '@/components/reader/regenerate-outcome'
import { RollbackConfirmModal } from '@/components/reader/rollback-confirm'
import { describeSuggestionFailure } from '@/components/reader/suggestion-failure'
import { SuggestionStrip, type SuggestionStripPhase } from '@/components/reader/suggestion-strip'
import {
  describeTurnFailure,
  toSystemFailureMeta,
  useConfigFixAction,
  useSystemEntryActions,
} from '@/components/reader/system-entry-actions'
import { useWorldTimeEditing } from '@/components/reader/world-time-editing'
import { WorldTimeEditSheet } from '@/components/reader/worldtime-edit-sheet'
import { ScreenShell } from '@/components/shells/screen-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
import { useOpenRegionTokens } from '@/hooks/use-open-region-tokens'
import { useTier } from '@/hooks/use-tier'
import {
  clearSystemEntry,
  ENTRIES_WINDOW_SIZE,
  getRollbackCounts,
  loadOpenStory,
  readRecentEntries,
  redoLastAction,
  refreshEmbeddingStatus,
  refreshSuggestions,
  regenerateTurn,
  rollbackToEntry,
  submitTurn,
  undoLastAction,
  type UndoRejectionCode,
  updateStoryEntryContent,
  writeSystemEntry,
  type LoadOpenStoryResult,
  type RegenerateRejectionCode,
  type RegenerateTurnResult,
  type RollbackCounts,
  type StoryEntryRejection,
} from '@/lib/actions'
import { wrapComposerText, type ComposerMode } from '@/lib/composer-wrap'
import {
  branches,
  db,
  runInTransaction,
  storyEntries,
  type StoryEntry,
  type SystemFailureMeta,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { createHtmlStreamBuffer, type HtmlStreamBuffer } from '@/lib/markdown'
import {
  buildSuggestionSlots,
  findSuggestionAnchor,
  shouldShowSuggestionStrip,
} from '@/lib/piggyback'
import {
  PER_TURN_KIND,
  pipelineEventBus,
  SUGGESTION_REFRESH_KIND,
  type PipelineError,
} from '@/lib/pipeline'
import {
  appSettingsStore,
  awaitRunTerminal,
  backgroundClassifierRunning,
  currentStoryStore,
  embedderSwapStore,
  embeddingStatusStore,
  entitiesStore,
  entriesStore,
  generationStore,
  isBackgroundKind,
  isUserEditBlocked,
  rehydrateStories,
  storiesStore,
  type TxState,
  undoRedoStore,
} from '@/lib/stores'
import { useTheme } from '@/lib/themes'
import { toast } from '@/lib/toast'
import { runAction } from '@/lib/utils'

const ctx = { db, runInTransaction }

// The three classes differ in what the user can do about it: wait for the turn,
// resume the swap, or nothing (the last three are invariant violations, where
// inviting a retry sends them into a loop that cannot succeed).
const REGENERATE_REJECTION_COPY = {
  'embedder-swap': 'reader:actions.blockedWhileSwapping',
  'generation-in-flight': 'reader:actions.blockedWhileGenerating',
  'branch-not-loaded': 'reader:regenerateUnavailable',
  'not-an-ai-reply': 'reader:regenerateUnavailable',
  'no-origin': 'reader:regenerateUnavailable',
  'sweep-refused': 'reader:regenerateUnavailable',
} as const satisfies Record<RegenerateRejectionCode, string>

type RollbackState = {
  mode: 'rollback' | 'regenerate'
  targetId: string
  targetNumber: number
  counts: RollbackCounts
}
type BranchHydrationState =
  | { branchId: string; status: 'loading' }
  | {
      branchId: string
      status: 'success'
      result: Extract<LoadOpenStoryResult, { status: 'ok' }>
    }
  | { branchId: string; status: 'failure'; result: LoadOpenStoryResult | null }

// Module scope, not useCallback([]): useGlobalHotkey lists `matches` in its effect
// deps, so identity has to hold unconditionally.
function matchesUndoRedoShortcut(ev: KeyboardEvent): boolean {
  return (ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')
}

function matchesJumpToBottomShortcut(ev: KeyboardEvent): boolean {
  return ev.key === 'End'
}

type ReaderGateState = {
  hydrationFailed: boolean
  hydrationSucceeded: boolean
  swapPending: boolean
  actionsBlocked: boolean
}

// Precedence, not independent conditions: hydration outranks the swap, which
// outranks a run in flight. An object, so the order can't transpose at the call site.
function composerDisabledReason(state: ReaderGateState): string | undefined {
  if (state.hydrationFailed) return t('reader:hydrationFailedBody')
  if (!state.hydrationSucceeded) return t('reader:hydrationLoading')
  if (state.swapPending) return t('reader:actions.blockedWhileSwapping')
  if (state.actionsBlocked) return t('reader:actions.blockedWhileGenerating')
  return undefined
}

// Same precedence order as above; null means the reader itself renders.
function readerPlaceholder(state: {
  hydrationFailed: boolean
  hydrationSucceeded: boolean
  isEmpty: boolean
}): { title: string; subtext?: string } | null {
  if (state.hydrationFailed)
    return { title: t('reader:hydrationFailedTitle'), subtext: t('reader:hydrationFailedBody') }
  if (!state.hydrationSucceeded) return { title: t('reader:hydrationLoading') }
  if (state.isEmpty) return { title: t('reader:emptyTitle'), subtext: t('reader:emptyBody') }
  return null
}

export default function ReaderComposerRoute() {
  const router = useRouter()
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

  const [storyId, setStoryId] = useState<string | null>(null)
  const [rollback, setRollback] = useState<RollbackState | null>(null)
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
  // The phase, not a boolean: one source for whether a turn runs and what it
  // does. Neither a refresh nor a background classifier pass is a turn — either
  // counted here would swap Send for Cancel and raise the streaming placeholder
  // over a branch that isn't streaming. Only the refresh is hard-gate, so
  // `editBlocked` above still covers undo/redo for it.
  // Two selectors over one predicate rather than one returning a pair: a fresh
  // object per read would re-render the reader on every unrelated store write.
  const findTurnRun = useCallback(
    (s: { txState: TxState }) =>
      [...s.txState.runs.values()].find(
        (r) =>
          r.branchId === branchId &&
          r.kind !== SUGGESTION_REFRESH_KIND &&
          !isBackgroundKind(r.kind),
      ),
    [branchId],
  )
  const turnPhase = generationStore.useGeneration((s) => findTurnRun(s)?.currentPhase ?? null)
  const turnKind = generationStore.useGeneration((s) => findTurnRun(s)?.kind ?? null)
  const isGenerating = turnPhase !== null
  const refreshingSuggestions = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some(
      (r) => r.branchId === branchId && r.kind === SUGGESTION_REFRESH_KIND,
    ),
  )
  const classifierRunning = generationStore.useGeneration((s) =>
    backgroundClassifierRunning(s.txState, branchId),
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
  )

  // The failure belongs to the entry it was fired on; a turn, a rollback or a
  // branch switch replaces the strip's contents, so the error must not ride along.
  useEffect(() => setStripError(null), [branchId, terminalEntry?.id])

  const staleTotal = embeddingStatusStore.useEmbeddingStatus((s) =>
    embeddingStatusStore.staleTotalFor(s, storyId),
  )
  // Narrow selector: a boolean stays stable across embed-batch ticks, where the
  // run's own entry changes identity on every one (onProgress fires per batch).
  const swapRunningHere = embedderSwapStore.useSwap(
    (s) => embedderSwapStore.progressFor(s, storyId) != null,
  )
  // A paused swap is signalled off the MARKER, not the stale count: phase-1
  // staging clears embedding_stale row by row, so a half-finished swap drives
  // that count toward zero and a healthy story sits at exactly zero throughout.
  // A live loop reports through the Memory panel's own progress row instead.
  const swapPaused =
    storyId != null && openForBranch?.settings.embedding_swap_target != null && !swapRunningHere
  // Composing is fine mid-swap; submitting is not. submitTurn refuses either way
  // (a swap owns the vec tables), so gate here rather than let the user write a
  // turn and take a failure entry for it.
  const swapPending = swapRunningHere || swapPaused

  const activePhase = readerPillPhase({
    turnKind,
    turnPhase,
    refreshingSuggestions,
    classifierRunning,
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
    if (!isGenerating) {
      streamBufferRef.current = null
      setStreaming(null)
    }
  }, [isGenerating])

  // Visible from the moment the run starts (pre-first-chunk placeholder), and
  // hidden the frame the committed row lands: the real commit hits entriesStore
  // mid-phase, before isGenerating flips false — checking against entries (not
  // just isGenerating) prevents a frame where both the synthetic and the real
  // committed card are visible.
  const streamingVisible =
    isGenerating && !(streaming != null && entries.some((e) => e.id === streaming.entryId))

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
    let cancelled = false
    runAction(
      db
        .select({ storyId: branches.storyId })
        .from(branches)
        .where(eq(branches.id, branchId))
        .then((r) => {
          if (!cancelled) setStoryId(r[0]?.storyId ?? null)
        }),
      { event: 'reader.story_id_load_failed', context: { branchId } },
    )
    return () => {
      cancelled = true
    }
  }, [branchId])

  useEffect(() => {
    // Never rejects: internally try/caught, logs embedder.status_refresh_failed on its own.
    if (storyId != null) void refreshEmbeddingStatus(storyId)
  }, [storyId])

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
    // Never rejects: internally try/caught, logs bootstrap.stories_hydrate_failed on its own.
    void rehydrateStories(db)
  }, [])
  const storyTitle = useMemo(
    () => storyRows.find((r) => r.id === storyId)?.title,
    [storyRows, storyId],
  )

  const showTurnFailure = useCallback(
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
      await reload()
    },
    [branchId, reload],
  )

  type DroppedSystemEntry = { content: string; failure: SystemFailureMeta | undefined }

  // A prior failure leaves a system entry as the branch tail; drop it (and
  // resync the store) before a dispatch so the pipeline's prompt/position reads
  // the real content tail, not the failure singleton.
  //
  // Hands back what it removed: that entry's `submission` is the only copy of
  // the earlier failed turn's text that outlives a restart, because the turn's
  // own user_action was reverse-replayed with its action group. A dispatch that
  // then refuses has destroyed it for nothing unless it puts this back.
  const dropSystemTail = useCallback(async (): Promise<DroppedSystemEntry | null> => {
    const dropped = [...entriesStore.getEntries().values()].find(
      (e) => e.branchId === branchId && e.kind === 'system',
    )
    if (!dropped) return null
    await clearSystemEntry(branchId, ctx)
    await reload()
    return { content: dropped.content, failure: dropped.metadata?.systemFailure }
  }, [branchId, reload])

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

  // `editBlocked` only goes true once a dispatch registers a hard-gate run or
  // enters its reversal barrier — several awaits and a branch-queue hop past the
  // tap. Send survives that window only because the composer clears its own text
  // on send; the per-entry glyphs have no such accident, so every turn dispatch
  // marks the window itself. The ref is the correctness guard (synchronous, no
  // render lag); the state is what disables the affordances.
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

  const runSubmit = useCallback(
    async (content: string, composerMode: string, raw?: { text: string; mode: ComposerMode }) => {
      if (!storyId || !hydrationSucceeded) return
      if (!beginDispatch()) {
        logger.warn('pipeline.submit_dispatch_suppressed', { branchId })
        return
      }
      const submission = { content, composerMode }
      try {
        await dropSystemTail()
        setLastSubmission(submission)
        const result = await submitTurn({ storyId, branchId }, { content, composerMode }, ctx)
        if (result.outcome === 'failed') await showTurnFailure(result.error, submission)
        else if (result.outcome === 'rejected')
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
        else if (result.outcome === 'aborted' && branchUnchanged(branchId)) {
          // Cancel reverses the whole turn (user_action included, C6) — hand
          // the text back for edit/re-send. A retry has no raw pre-wrap text,
          // so the wrapped content returns under 'free' (no re-wrap on send).
          // Only into an empty composer: the composer clears itself on send, but
          // Retry re-enters here without clearing, so text typed while the turn
          // ran would otherwise be overwritten by the cancelled action.
          if (isDraftEmpty(composerRef.current?.getDraft()))
            composerRef.current?.restoreDraft(raw?.text ?? content, raw?.mode ?? 'free')
          else toast.info(t('reader:turnCancelledDraftKept'))
        }
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
      dropSystemTail,
      showTurnFailure,
      beginDispatch,
      endDispatch,
      branchUnchanged,
    ],
  )

  // Guarded here rather than at the callers because both the immediate tap and
  // the modal's confirm funnel through this one dispatch.
  const runRegenerate = useCallback(
    async (targetId: string) => {
      if (!storyId || !hydrationSucceeded) return
      if (!beginDispatch()) {
        logger.warn('pipeline.regenerate_dispatch_suppressed', { branchId, entryId: targetId })
        return
      }
      try {
        let regen: RegenerateTurnResult
        let dropped: DroppedSystemEntry | null = null
        // Scoped to the action alone: a throw out of the arms below happens
        // *after* it returned, with the user's text in hand, so it must not
        // inherit the "no submission to hand back" premise the catch encodes.
        try {
          dropped = await dropSystemTail()
          regen = await regenerateTurn({ storyId, branchId }, targetId, ctx)
        } catch (err) {
          // A toast, not a failure entry: the throw carries no userActionContent,
          // and a system entry's Retry renders unconditionally — it would offer a
          // resubmit that is doomed (nothing to send) or wrong (a stale earlier
          // submission duplicated over the standing user_action).
          logger.error('pipeline.regenerate_threw', {
            branchId,
            entryId: targetId,
            error: err instanceof Error ? err.message : String(err),
          })
          toast.error(t('reader:regenerateFailed'))
          // A DeltaReplayError can commit its transaction and fail the store sync,
          // leaving entriesStore holding rows the sweep already deleted.
          await reload()
          return
        }
        if (regen.status === 'rejected') {
          logger.warn('pipeline.regenerate_rejected', {
            branchId,
            entryId: targetId,
            reason: regen.reason,
          })
          // Every rejection fires before the first sweep, so nothing else moved
          // and putting the failure entry back is an exact undo of the drop.
          await restoreSystemTail(dropped)
          toast.error(t(REGENERATE_REJECTION_COPY[regen.code]))
          return
        }
        const { result } = regen
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
        try {
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
            await showTurnFailure(result.error, submission)
          } else if (plan.action === 'write-blocked-entry' && result.outcome === 'rejected') {
            if (stillHere) setLastSubmission(submission)
            await showTurnFailure(
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
          if (plan.resync) await reload()
        } catch (err) {
          // Reached only once the action returned, so unlike the arm above the
          // user's text is still in hand — hand it back rather than losing it
          // with the failure entry that was being written.
          logger.error('pipeline.regenerate_outcome_handling_threw', {
            branchId,
            entryId: targetId,
            outcome: result.outcome,
            error: err instanceof Error ? err.message : String(err),
          })
          toast.error(t('reader:regenerateFailed'))
          // Re-read rather than reuse `stillHere`: the arms above awaited.
          if (
            branchUnchanged(branchId) &&
            shouldRestoreUserActionAfterHandlingFailure(
              plan.action,
              isDraftEmpty(composerRef.current?.getDraft()),
            )
          )
            composerRef.current?.restoreDraft(regen.userActionContent, 'free')
          await reload()
        }
      } finally {
        endDispatch()
      }
    },
    [
      storyId,
      branchId,
      hydrationSucceeded,
      dropSystemTail,
      restoreSystemTail,
      reload,
      showTurnFailure,
      beginDispatch,
      endDispatch,
      branchUnchanged,
    ],
  )

  // Derived from the persisted entry, not React state, so the failure kind,
  // fix action, and retryable submission all survive an app restart.
  const systemFailure = useMemo(
    () => entries.find((e) => e.kind === 'system')?.metadata?.systemFailure,
    [entries],
  )

  const { onRetry: retrySystemEntry, fixAction } = useSystemEntryActions(
    systemFailure,
    () => {
      const submission = lastSubmission ?? systemFailure?.submission
      if (submission) void runSubmit(submission.content, submission.composerMode)
    },
    storyId,
  )

  const dismissSystemEntry = useCallback(async () => {
    await clearSystemEntry(branchId, ctx)
    await reload()
  }, [branchId, reload])

  const openRollback = useCallback(
    async (targetId: string) => {
      // A tapped delete silently doing nothing reads as broken — and the count
      // read is a DB round trip that can reject as well as refuse.
      let counts: RollbackCounts | StoryEntryRejection
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
      setRollback({ mode: 'rollback', targetId, targetNumber: target?.position ?? 0, counts })
    },
    [branchId],
  )

  const confirmRollback = useCallback(async () => {
    if (!rollback) return
    if (rollback.mode === 'regenerate') {
      const targetId = rollback.targetId
      // Close before the stream starts; the streaming card takes over the surface.
      setRollback(null)
      await runRegenerate(targetId)
      return
    }
    const result = await rollbackToEntry(branchId, rollback.targetId, ctx)
    if (result.status === 'rejected') {
      // Keep the modal open so the user doesn't assume the delete happened.
      toast.error(t('reader:rollbackFailed'))
      return
    }
    setRollback(null)
  }, [branchId, rollback, runRegenerate])

  const handleCommitEdit = useCallback(
    async (entryId: string, content: string): Promise<EditResult> => {
      const result = await updateStoryEntryContent(branchId, entryId, content, ctx)
      if (result.status === 'rejected') {
        // The draft stays open in the document; the host owns the toast.
        toast.error(t('reader:editFailed'))
        return { ok: false }
      }
      return { ok: true }
    },
    [branchId],
  )

  const handleRequestRegenerate = useCallback(
    async (entryId: string) => {
      // Opening a confirm whose dispatch the in-flight guard will drop leaves
      // the user watching the modal close on nothing.
      if (dispatchInFlightRef.current) return
      const startedBranchId = branchId
      let counts: RollbackCounts | StoryEntryRejection | null
      try {
        counts = await loadRegenerateCountsIfCurrent(
          () => getRollbackCounts(startedBranchId, entryId, ctx),
          () => ({
            startedBranchId,
            currentBranchId: branchIdRef.current,
            loadedBranchId: entriesStore.getLoadedBranch(),
            dispatchInFlight: dispatchInFlightRef.current,
            userEditBlocked: generationStore.isUserEditBlocked(),
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
        if (result.outcome === 'failed')
          fail(result.error ?? { kind: 'orchestrator', detail: 'run failed without an error' })
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

  const handleRetrySystemEntry = useCallback(async () => retrySystemEntry(), [retrySystemEntry])
  const handleFixSystemEntry = useCallback(async () => fixAction?.onPress(), [fixAction])
  // Editable-target exclusion keeps End moving the caret inside the composer.
  useGlobalHotkey(matchesJumpToBottomShortcut, jumpToBottom, {
    ignoreEditableTargets: true,
    enabled: isFocused,
  })
  const contextualActions: ActionGroup = useMemo(() => {
    // editBlocked, not isGenerating: undo/redo reject on the gate, which a
    // suggestion refresh now holds too. Keyed off the turn alone, the item
    // would stay enabled and its rejection would toast "nothing to undo" over
    // an intact history.
    const blocked = {
      disabled: actionsBlocked,
      disabledReason: t('reader:actions.blockedWhileGenerating'),
    }
    return {
      id: 'reader',
      header: t('chrome.onThisScreen'),
      entries: [
        {
          id: 'undo',
          label: t('reader:actions.undo'),
          ...blocked,
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
                ...blocked,
                onActivate: () => runUndoRedo('redo'),
              },
            ]
          : []),
        ...(entries.length > 0
          ? [{ id: 'jump-to-bottom', label: t('reader:jumpToBottom'), onActivate: jumpToBottom }]
          : []),
      ],
    }
  }, [hasRedo, actionsBlocked, runUndoRedo, entries.length, jumpToBottom])

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

  const placeholder = readerPlaceholder({
    hydrationFailed,
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
    editBlocked: actionsBlocked,
    jumpButtonEnabled,
    systemFixLabel: fixAction?.label,
    onNearTop: loadOlderEntries,
    onCommitEdit: handleCommitEdit,
    onRequestRollback: openRollback,
    onEditWorldTime: editWorldTime,
    onRequestEditWorldTime: requestEditWorldTime,
    onRegenerate: handleRequestRegenerate,
    onRetrySystemEntry: handleRetrySystemEntry,
    onDismissSystemEntry: dismissSystemEntry,
    onFixSystemEntry: handleFixSystemEntry,
  }

  return (
    <ScreenShell
      variant="in-story"
      title={<Text className="font-semibold">{storyTitle ?? t('reader:placeholderTitle')}</Text>}
      chapterProgress={openRegionPct}
      onBack={() => router.back()}
      onOpenStorySettings={() => {
        if (storyId != null) router.push(`/story-settings/${storyId}`)
      }}
      actions={
        <AppActionsMenu
          contextual={contextualActions}
          blocked={rollback != null || timeEdit != null}
        />
      }
      statusSlot={
        <GenerationStatusPill
          activePhase={activePhase}
          error={
            swapPaused
              ? { code: 'swap-paused' }
              : staleTotal > 0
                ? { code: 'memory-incomplete', pendingRows: staleTotal }
                : undefined
          }
          // A background classifier pass has no cancel affordance, so the prop is
          // absent rather than a no-op handler that would still open the dialog.
          {...(isGenerating || refreshingSuggestions
            ? {
                // The run's own kind, not PER_TURN_KIND: findTurnRun matches on a
                // denylist, so any foreground pipeline added later raises this
                // Cancel and a hardcoded kind would abort a run that isn't there.
                onCancel: () =>
                  void awaitRunTerminal(turnKind ?? SUGGESTION_REFRESH_KIND, branchId, 'cancel'),
              }
            : {})}
          onErrorTap={(code) => {
            if (code !== 'classifier-offline' && storyId != null)
              router.push(`/story-settings/${storyId}?tab=memory`)
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
              disabled={actionsBlocked}
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
                  hydrationFailed,
                  hydrationSucceeded,
                  swapPending,
                  actionsBlocked,
                })}
                onSend={(rawText, mode) => {
                  const wrapped = wrapComposerText(rawText, { mode, pov: wrapPov, leadName })
                  void runSubmit(wrapped, mode, { text: rawText, mode })
                }}
                onCancel={() =>
                  void awaitRunTerminal(turnKind ?? PER_TURN_KIND, branchId, 'cancel')
                }
              />
            </View>
          </View>
        </KeyboardInsetColumn>
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
    </ScreenShell>
  )
}
