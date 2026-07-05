import { eq } from 'drizzle-orm'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, View } from 'react-native'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { EntryCard } from '@/components/compounds/entry-card'
import { GenerationStatusPill } from '@/components/compounds/generation-status-pill'
import { Composer } from '@/components/reader/composer'
import { EntryWindow } from '@/components/reader/entry-window'
import { JumpButtons } from '@/components/reader/jump-buttons'
import { RollbackConfirmModal } from '@/components/reader/rollback-confirm'
import { useSystemEntryActions } from '@/components/reader/system-entry-actions'
import { ScreenShell } from '@/components/shells/screen-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import {
  clearSystemEntry,
  getRollbackCounts,
  PER_TURN_KIND,
  redoLastAction,
  rollbackToEntry,
  submitTurn,
  undoLastAction,
  updateStoryEntryContent,
  writeSystemEntry,
  type RollbackCounts,
} from '@/lib/actions'
import { wrapComposerText } from '@/lib/composer-wrap'
import { branches, db, runInTransaction, storyEntries, type StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'
import { awaitRunTerminal, type PipelineError } from '@/lib/pipeline'
import { entriesStore, generationStore, isUserEditBlocked, undoRedoStore } from '@/lib/stores'

const ctx = { db, runInTransaction }

type RollbackState = { targetId: string; targetNumber: number; counts: RollbackCounts }

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

  const reload = useCallback(async () => {
    const fresh = (await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchId))
      .orderBy(storyEntries.position)) as StoryEntry[]
    entriesStore.hydrate(branchId, fresh)
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
    if (entriesStore.getLoadedBranch() !== branchId) void reload()
  }, [branchId, reload])

  const runSubmit = useCallback(
    async (content: string, composerMode: string) => {
      if (!storyId) return
      setLastError(undefined)
      // A second unrelated action clears the redo stack (data-model.md).
      undoRedoStore.clear()
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
      const result = await submitTurn({ storyId, branchId }, { content, composerMode }, ctx)
      if (result.outcome === 'failed') {
        setLastError(result.error)
        await writeSystemEntry({ branchId, content: t('reader:systemEntry.failureMessage') }, ctx)
        await reload()
      }
    },
    [storyId, branchId, reload],
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
    await rollbackToEntry(branchId, rollback.targetId, ctx)
    setRollback(null)
  }, [branchId, rollback])

  const startEdit = useCallback((id: string) => {
    setEditingId(id)
    setEditDraft(entriesStore.getById(id)?.content ?? '')
  }, [])

  const commitEdit = useCallback(async () => {
    if (!editingId) return
    await updateStoryEntryContent(branchId, editingId, editDraft, ctx)
    setEditingId(null)
    setEditDraft('')
  }, [branchId, editingId, editDraft])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditDraft('')
  }, [])

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined
    const handler = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'z' || ev.key === 'Z')) {
        ev.preventDefault()
        if (ev.shiftKey) void redoLastAction(branchId, ctx)
        else void undoLastAction(branchId, ctx)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [branchId])

  const renderRow = (e: StoryEntry) => {
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
      title={<Text className="font-semibold">{t('reader:placeholderTitle')}</Text>}
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
            {entries.length === 0 ? (
              <View className="flex-1 items-center justify-center">
                <EmptyState title={t('reader:emptyTitle')} subtext={t('reader:emptyBody')} />
              </View>
            ) : (
              <EntryWindow
                rows={entries}
                renderRow={renderRow}
                onNearTop={() => {}}
                onNearBottom={() => {}}
              />
            )}
            {/* Real scroll linkage awaits an imperative EntryWindow ref (later pass); Home/End keys wait on the same seam. */}
            <JumpButtons
              showJumpToTop={showJump}
              showJumpToBottom={showJump}
              onJumpToTop={() => {}}
              onJumpToBottom={() => {}}
            />
          </View>
          <View className="border-t border-border p-3">
            <Composer
              // modesEnabled should AND stories.settings.composerModesEnabled with
              // adventure-mode once story settings are readable here.
              modesEnabled
              isGenerating={isGenerating}
              disabled={editBlocked}
              onSend={(rawText, mode) => {
                // pov / leadName come from stories.settings / stories.definition
                // once readable here; interim first-person defaults.
                const wrapped = wrapComposerText(rawText, {
                  mode,
                  pov: 'first',
                  leadName: 'You',
                })
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
