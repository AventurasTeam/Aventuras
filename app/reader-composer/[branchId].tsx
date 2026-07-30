import { useIsFocused } from '@react-navigation/native'
import { and, desc, eq, lt } from 'drizzle-orm'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, View } from 'react-native'

import { type ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import {
  GenerationStatusPill,
  type GenerationPhase,
} from '@/components/compounds/generation-status-pill'
import { Composer, type ComposerHandle } from '@/components/reader/composer'
import ReaderDocument, { type ReaderDocumentRef } from '@/components/reader/reader-document'
import {
  type EditResult,
  type ReaderSurfaceHandle,
} from '@/components/reader/reader-document-types'
import { ReaderSurface } from '@/components/reader/reader-surface'
import { RollbackConfirmModal } from '@/components/reader/rollback-confirm'
import { SuggestionStrip, type SuggestionStripPhase } from '@/components/reader/suggestion-strip'
import {
  describeTurnFailure,
  toSystemFailureMeta,
  useSystemEntryActions,
} from '@/components/reader/system-entry-actions'
import { ScreenShell } from '@/components/shells/screen-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
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
  rollbackToEntry,
  submitTurn,
  undoLastAction,
  updateStoryEntryContent,
  writeSystemEntry,
  type LoadOpenStoryResult,
  type RollbackCounts,
} from '@/lib/actions'
import { wrapComposerText, type ComposerMode } from '@/lib/composer-wrap'
import { branches, db, runInTransaction, storyEntries, type StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'
import { createHtmlStreamBuffer, type HtmlStreamBuffer } from '@/lib/markdown'
import { shouldShowSuggestionStrip } from '@/lib/piggyback'
import {
  awaitRunTerminal,
  PER_TURN_KIND,
  pipelineEventBus,
  SUGGESTION_REFRESH_KIND,
  type PipelineError,
} from '@/lib/pipeline'
import {
  appSettingsStore,
  currentStoryStore,
  embedderSwapStore,
  embeddingStatusStore,
  entitiesStore,
  entriesStore,
  generationStore,
  isUserEditBlocked,
  rehydrateStories,
  storiesStore,
  undoRedoStore,
} from '@/lib/stores'
import { useTheme } from '@/lib/themes'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

type RollbackState = { targetId: string; targetNumber: number; counts: RollbackCounts }
type BranchHydrationState =
  | { branchId: string; status: 'loading' }
  | {
      branchId: string
      status: 'success'
      result: Extract<LoadOpenStoryResult, { status: 'ok' }>
    }
  | { branchId: string; status: 'failure'; result: LoadOpenStoryResult | null }

export default function ReaderComposerRoute() {
  const router = useRouter()
  const tier = useTier()
  const showRail = tier !== 'phone'
  const isFocused = useIsFocused()
  const { branchId } = useLocalSearchParams<{ branchId: string }>()

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
  // A no-gate suggestion refresh is not a turn: per-turn does not block on it, so
  // both can run at once, and counting it here would swap Send for Cancel, gate
  // undo/redo, and raise the streaming placeholder over a branch that isn't
  // streaming.
  const isGenerating = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some(
      (r) => r.branchId === branchId && r.kind !== SUGGESTION_REFRESH_KIND,
    ),
  )
  const refreshingSuggestions = generationStore.useGeneration((s) =>
    [...s.txState.runs.values()].some(
      (r) => r.branchId === branchId && r.kind === SUGGESTION_REFRESH_KIND,
    ),
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

  const [stripCollapsed, setStripCollapsed] = useState(false)
  const [stripError, setStripError] = useState(false)
  const terminalEntry = entries.at(-1) ?? null
  const suggestionsEnabled = openForBranch?.settings.suggestionsEnabled ?? false
  const suggestionCategories = openForBranch?.settings.suggestionCategories ?? []
  const chips = terminalEntry?.metadata?.nextTurnSuggestions?.items ?? []
  const stripVisible = shouldShowSuggestionStrip({
    suggestionsEnabled,
    hasTerminalEntry: terminalEntry != null,
    hasChips: chips.length > 0,
    categories: suggestionCategories,
  })
  const stripPhase: SuggestionStripPhase = refreshingSuggestions
    ? 'loading'
    : stripError
      ? 'error'
      : chips.length > 0
        ? 'visible'
        : 'empty-state'

  // The failure belongs to the entry it was fired on; a turn, a rollback or a
  // branch switch replaces the strip's contents, so the error must not ride along.
  useEffect(() => setStripError(false), [branchId, terminalEntry?.id])

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

  // A suggestion refresh occupies the pill exactly like a turn does, and the
  // pill prioritizes activePhase over error — so the two branches must be
  // derived from one value, or a refresh would leave the warning tone visible.
  const activePhase: GenerationPhase | undefined = isGenerating
    ? 'generating-narrative'
    : refreshingSuggestions
      ? 'refreshing-suggestions'
      : undefined

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
  useEffect(() => {
    streamBufferRef.current = null
    setStreaming(null)
    setHasOlder(false)
  }, [branchId])

  // Leaving the branch (switch or unmount) aborts an in-flight refresh: it is
  // no-gate and non-transactional, and its target entry is on the branch being
  // left (reader-composer.md → Edge cases → Branch switch with chips in flight).
  useEffect(
    () => () => {
      const running = [...generationStore.getTxState().runs.values()].some(
        (r) => r.kind === SUGGESTION_REFRESH_KIND && r.branchId === branchId,
      )
      if (running) void awaitRunTerminal(SUGGESTION_REFRESH_KIND, 'cancel')
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
    entriesStore.hydrate(branchId, recent)
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

  const runSubmit = useCallback(
    async (content: string, composerMode: string, raw?: { text: string; mode: ComposerMode }) => {
      if (!storyId || !hydrationSucceeded) return
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
      const submission = { content, composerMode }
      setLastSubmission(submission)
      try {
        const result = await submitTurn({ storyId, branchId }, { content, composerMode }, ctx)
        if (result.outcome === 'failed') await showTurnFailure(result.error, submission)
        else if (result.outcome === 'rejected')
          await showTurnFailure(
            { kind: 'orchestrator', detail: `blocked by ${result.blockedBy}` },
            submission,
          )
        else if (result.outcome === 'aborted')
          // Cancel reverses the whole turn (user_action included, C6) — hand
          // the text back for edit/re-send. A retry has no raw pre-wrap text,
          // so the wrapped content returns under 'free' (no re-wrap on send).
          composerRef.current?.restoreDraft(raw?.text ?? content, raw?.mode ?? 'free')
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
      }
    },
    [storyId, branchId, hydrationSucceeded, reload, showTurnFailure],
  )

  // Derived from the persisted entry, not React state, so the failure kind,
  // fix action, and retryable submission all survive an app restart.
  const systemFailure = useMemo(
    () => entries.find((e) => e.kind === 'system')?.metadata?.systemFailure,
    [entries],
  )

  const { onRetry: retrySystemEntry, fixAction } = useSystemEntryActions(systemFailure, () => {
    const submission = lastSubmission ?? systemFailure?.submission
    if (submission) void runSubmit(submission.content, submission.composerMode)
  })

  const dismissSystemEntry = useCallback(async () => {
    await clearSystemEntry(branchId, ctx)
    await reload()
  }, [branchId, reload])

  const openRollback = useCallback(
    async (targetId: string) => {
      const counts = await getRollbackCounts(branchId, targetId, ctx)
      if ('status' in counts) {
        // A tapped delete silently doing nothing reads as broken.
        toast.error(t('reader:rollbackFailed'))
        return
      }
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

  const handleRequestRollback = useCallback(
    async (entryId: string) => {
      await openRollback(entryId)
    },
    [openRollback],
  )

  // Chips are finished prose, so the draft is replaced outright and the mode
  // forced to Free — no wrapping (reader-composer.md → Next-turn suggestions).
  const handleTapChip = useCallback((text: string) => {
    composerRef.current?.restoreDraft(text, 'free')
  }, [])

  const handleToggleStripCollapsed = useCallback(() => setStripCollapsed((prev) => !prev), [])

  const handleCancelSuggestions = useCallback(() => {
    void awaitRunTerminal(SUGGESTION_REFRESH_KIND, 'cancel')
  }, [])

  // Read at settle time, not from the closure. A refresh outlives what it was
  // fired on: per-turn doesn't block on it, so a turn can move the tail
  // mid-run, and a branch-switch abort whose reverse-replay fails resolves
  // 'failed' well after the switch. The entry ref alone would cover both (ids
  // are globally unique, and a switch nulls the tail); the branch ref stays so
  // the guard is legible without trusting that cross-module invariant.
  const branchIdRef = useRef(branchId)
  const terminalEntryIdRef = useRef(terminalEntry?.id)
  branchIdRef.current = branchId
  terminalEntryIdRef.current = terminalEntry?.id

  const handleRefreshSuggestions = useCallback(() => {
    const target = terminalEntry
    const story = openForBranch
    if (target == null || story == null) return
    setStripError(false)
    const startedBranchId = branchId
    const startedEntryId = target.id
    const fail = () => {
      if (branchIdRef.current === startedBranchId && terminalEntryIdRef.current === startedEntryId)
        setStripError(true)
    }
    void refreshSuggestions(
      { storyId: story.storyId, branchId },
      { targetEntryId: target.id, refreshGuidance: composerRef.current?.getDraft().text ?? '' },
      ctx,
    )
      // 'rejected' is the self-block a second ⟳ hits while one runs, and
      // 'aborted' is a cancel or a branch switch — neither is a failure.
      .then((result) => {
        if (result.outcome === 'failed') fail()
      })
      .catch(fail)
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
  useGlobalHotkey(matchesUndoRedoShortcut, handleUndoRedoShortcut, {
    ignoreEditableTargets: true,
    enabled: isFocused,
  })

  // Touch-tier path to undo/redo (the shortcut is keyboard-only). A tapped menu
  // item silently doing nothing reads as broken, so rejections toast — unlike
  // the keyboard path, which stays silent per native undo convention.
  const hasRedo = undoRedoStore.useUndoRedo((s) => s.redoStack.length > 0)
  const menuUndo = useCallback(async () => {
    const result = await undoLastAction(branchId, ctx)
    if (result.status === 'rejected') toast.info(t('reader:actions.nothingToUndo'))
  }, [branchId])
  const menuRedo = useCallback(async () => {
    const result = await redoLastAction(branchId, ctx)
    if (result.status === 'rejected') toast.info(t('reader:actions.nothingToRedo'))
  }, [branchId])
  // Engage/settle semantics live in the surface's own jumpToBottom; the host
  // only routes the request to whichever mount is live on this platform.
  const jumpToBottom = useCallback(() => {
    if (Platform.OS === 'web') surfaceRef.current?.jumpToBottom()
    else documentRef.current?.jumpToBottom()
  }, [])

  const handleRetrySystemEntry = useCallback(async () => retrySystemEntry(), [retrySystemEntry])
  const handleDismissSystemEntry = useCallback(async () => {
    await dismissSystemEntry()
  }, [dismissSystemEntry])
  const handleFixSystemEntry = useCallback(async () => fixAction?.onPress(), [fixAction])
  const matchesJumpToBottomShortcut = useCallback((ev: KeyboardEvent) => ev.key === 'End', [])
  // Editable-target exclusion keeps End moving the caret inside the composer.
  useGlobalHotkey(matchesJumpToBottomShortcut, jumpToBottom, {
    ignoreEditableTargets: true,
    enabled: isFocused,
  })
  const contextualActions: ActionGroup = useMemo(() => {
    const blocked = {
      disabled: isGenerating,
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
          onActivate: () => void menuUndo(),
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
                onActivate: () => void menuRedo(),
              },
            ]
          : []),
        ...(entries.length > 0
          ? [{ id: 'jump-to-bottom', label: t('reader:jumpToBottom'), onActivate: jumpToBottom }]
          : []),
      ],
    }
  }, [hasRedo, isGenerating, menuUndo, menuRedo, entries.length, jumpToBottom])

  const streamingPayload = useMemo(
    () =>
      streamingVisible
        ? { content: streaming?.content ?? '', reasoning: streaming?.reasoning ?? '' }
        : null,
    [streamingVisible, streaming],
  )

  const jumpButtonEnabled = appSettingsStore.useAppSettings((s) => s.appearance.showJumpToBottom)
  const { theme } = useTheme()

  const surfaceProps = {
    rows: entries,
    streaming: streamingPayload,
    branchKey: branchId,
    hasOlder,
    editBlocked,
    jumpButtonEnabled,
    systemFixLabel: fixAction?.label,
    onNearTop: loadOlderEntries,
    onCommitEdit: handleCommitEdit,
    onRequestRollback: handleRequestRollback,
    onRetrySystemEntry: handleRetrySystemEntry,
    onDismissSystemEntry: handleDismissSystemEntry,
    onFixSystemEntry: handleFixSystemEntry,
  }

  return (
    <ScreenShell
      variant="in-story"
      title={<Text className="font-semibold">{storyTitle ?? t('reader:placeholderTitle')}</Text>}
      chapterProgress={0}
      onBack={() => router.back()}
      onOpenStorySettings={() => {
        if (storyId != null) router.push(`/story-settings/${storyId}`)
      }}
      actions={<AppActionsMenu contextual={contextualActions} />}
      statusSlot={
        <GenerationStatusPill
          activePhase={activePhase}
          error={
            activePhase != null
              ? undefined
              : swapPaused
                ? { code: 'swap-paused' }
                : staleTotal > 0
                  ? { code: 'memory-incomplete', pendingRows: staleTotal }
                  : undefined
          }
          onCancel={() =>
            void awaitRunTerminal(isGenerating ? PER_TURN_KIND : SUGGESTION_REFRESH_KIND, 'cancel')
          }
          onErrorTap={(code) => {
            if (code !== 'classifier-offline' && storyId != null)
              router.push(`/story-settings/${storyId}?tab=memory`)
          }}
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
              onTapChip={handleTapChip}
              onRefresh={handleRefreshSuggestions}
              onCancel={handleCancelSuggestions}
              onToggleCollapsed={handleToggleStripCollapsed}
              disabled={editBlocked}
            />
          ) : null}
          <View className="border-t border-border px-6 pb-3.5 pt-3">
            <View className="mx-auto w-full max-w-[860px]">
              <Composer
                ref={composerRef}
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
                  void runSubmit(wrapped, mode, { text: rawText, mode })
                }}
                onCancel={() => void awaitRunTerminal(PER_TURN_KIND, 'cancel')}
              />
            </View>
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
