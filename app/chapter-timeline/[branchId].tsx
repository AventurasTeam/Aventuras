import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, type ReactElement } from 'react'
import { ScrollView, View } from 'react-native'

import { ChapterCard } from '@/components/chapters/chapter-card'
import { ChapterDeleteConfirm } from '@/components/chapters/chapter-delete-confirm'
import { ChapterInProgressCard } from '@/components/chapters/chapter-in-progress-card'
import { chapterTimelineData } from '@/components/chapters/chapter-timeline-data'
import { ChapterTimelineHeader } from '@/components/chapters/chapter-timeline-header'
import { useChapterDeleteConfirm } from '@/components/chapters/use-chapter-delete-confirm'
import { useTimelineEditing } from '@/components/chapters/use-timeline-editing'
import { useTimelineTimeRanges } from '@/components/chapters/use-timeline-time-ranges'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { Breadcrumb, type BreadcrumbSegment } from '@/components/compounds/breadcrumb'
import { RowLeaveDialog, RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { StoryStatusPill } from '@/components/compounds/story-status-pill'
import { readerHref } from '@/components/reader/reader-href'
import { ScreenShell } from '@/components/shells/screen-shell'
import { storyPillPhase, useStoryGenerationGate } from '@/components/story-settings/generation-run'
import { EmptyState } from '@/components/ui/empty-state'
import { KeyboardInsetColumn } from '@/components/ui/keyboard-inset-column'
import { useChapterProgress } from '@/hooks/use-chapter-progress'
import { useColdOpenStory } from '@/hooks/use-cold-open-story'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useIsRouteFocused } from '@/hooks/use-is-route-focused'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useStoryLeaveGuard } from '@/hooks/use-story-leave-guard'
import { useTier } from '@/hooks/use-tier'
import { getChapterDeletePreview, loadOpenStory, removeChapter, saveChapter } from '@/lib/actions'
import { resolveCalendar, type CalendarFrame } from '@/lib/calendar'
import type { ChapterDraft, ChapterDraftRow } from '@/lib/chapters'
import { db, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'
import { singleParam } from '@/lib/route-param'
import { chaptersStore, currentStoryStore, storiesStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

const save = (row: ChapterDraftRow, draft: ChapterDraft) => saveChapter({ row, draft }, ctx)

export default function ChapterTimelineRoute(): ReactElement {
  const router = useRouter()
  const isPhone = useTier() === 'phone'
  const focused = useIsRouteFocused()
  const params = useLocalSearchParams<{ branchId?: string | string[] }>()
  const branchId = singleParam(params.branchId) ?? ''

  const open = useColdOpenStory(branchId, 'chapter_timeline')
  const storyId = open?.storyId ?? null
  const { guardLeave, dialog: storyLeaveDialog } = useStoryLeaveGuard(storyId, branchId)
  const storyTitle = storiesStore.useStories((s) => s.rows.find((r) => r.id === storyId)?.title)
  const { activeRunKind, editBlocked, gateReason, beforeTurn, cancelPillRun } =
    useStoryGenerationGate(storyId ?? undefined, branchId)
  const chapterProgress = useChapterProgress(storyId)

  const chapterRows = chaptersStore.useChapters((m) => m)
  const entryIndex = useEntryIndex(branchId)
  const ranges = useTimelineTimeRanges(branchId, focused)
  const calendarSystemId = open?.definition.calendarSystemId
  const origin = open?.definition.worldTimeOrigin
  const frame = useMemo(
    (): CalendarFrame | null =>
      calendarSystemId == null || origin == null
        ? null
        : { calendar: resolveCalendar(calendarSystemId), origin },
    [calendarSystemId, origin],
  )
  const timeline = useMemo(
    () =>
      chapterTimelineData({
        branchId,
        rows: chapterRows.values(),
        ranges,
        // Empty until the first read lands or if it fails (a re-read keeps the last good index):
        // entry ranges drop meanwhile, nothing waits on it.
        entryIndex: entryIndex.index,
        frame,
      }),
    [branchId, chapterRows, ranges, entryIndex.index, frame],
  )
  const expansionRows = useMemo(() => timeline.cards.map((card) => card.row), [timeline.cards])

  const onSaved = useCallback(() => toast.success(t('chapters:save.saved')), [])
  // Hosted above every card for the route's life, so the phone bar can sit outside the scroller.
  const { expandedId, session, toggle, guard, navigateGuarded } = useTimelineEditing({
    ready: open != null,
    branchId,
    rows: expansionRows,
    runInFlight: editBlocked,
    save,
    onSaved,
    // The save bar's notice is an icon with no visible text, so a refused save also toasts.
    onRejected: toast.error,
  })

  const deleteConfirm = useChapterDeleteConfirm({
    branchId,
    active: focused,
    loadPreview: async (chapterId) => {
      // Cards, and so their Delete…, render only once the story is open.
      if (open == null) throw new Error(`no open story on ${branchId} to preview a delete with`)
      return getChapterDeletePreview(branchId, chapterId, open, ctx)
    },
    remove: (chapterId, mode) => removeChapter(branchId, chapterId, mode, ctx),
    // A delete whose store sync failed re-hydrates the branch, as a cold open does. The confirm
    // continuation outlives this screen, so a resync must not re-publish a branch the user has left.
    resync: async () => {
      const result = await loadOpenStory(
        branchId,
        ctx,
        () => currentStoryStore.getCurrentStory()?.branchId === branchId,
      )
      if (result.status !== 'ok' && result.status !== 'cancelled')
        throw new Error(`branch re-hydration ${result.status}`)
    },
  })

  const jump = useCallback(
    (startEntryId: string) => navigateGuarded(readerHref(branchId, startEntryId)),
    [navigateGuarded, branchId],
  )
  const handleBack = useCallback(() => guard(() => router.back()), [guard, router])
  // Constant true: Android back always runs handleBack, so it can't leave past a dirty card.
  useMasterDetailBack(true, handleBack)

  const titleSegments: BreadcrumbSegment[] = [
    {
      key: 'story',
      label: storyTitle ?? t('reader:placeholderTitle'),
      onPress: () => navigateGuarded(readerHref(branchId)),
    },
    { key: 'chapters', label: t('chapters:timeline.title') },
  ]

  return (
    <ScreenShell
      variant="in-story"
      title={<Breadcrumb segments={titleSegments} />}
      chapterProgress={chapterProgress}
      onBack={handleBack}
      onOpenStorySettings={() => {
        if (storyId != null) navigateGuarded(`/story-settings/${storyId}`)
      }}
      actions={
        <AppActionsMenu
          story={storyId != null ? { storyId, branchId, surface: 'chapter-timeline' } : undefined}
          beforeNavigate={guard}
          beforeLeaveStory={guardLeave}
        />
      }
      statusSlot={
        <StoryStatusPill
          storyId={storyId}
          swapTarget={open?.settings.embedding_swap_target}
          activePhase={storyPillPhase(activeRunKind)}
          beforeTurn={beforeTurn}
          onCancel={cancelPillRun}
          onOpenMemory={() => {
            if (storyId != null) navigateGuarded(`/story-settings/${storyId}?tab=memory`)
          }}
        />
      }
    >
      {open == null ? (
        <View className="flex-1 items-center justify-center">
          <EmptyState title={t('reader:hydrationLoading')} />
        </View>
      ) : (
        // touch.md → Save bar on phone: the list compresses so the phone bar rides above the IME.
        <KeyboardInsetColumn className="min-h-0">
          <ScrollView
            className="flex-1"
            contentContainerClassName={isPhone ? 'p-4' : 'p-6'}
            keyboardShouldPersistTaps="handled"
          >
            {/* The wireframe's .timeline-col: one centered column, capped at 760 px. */}
            <View className="w-full max-w-[760px] gap-2.5 self-center">
              <ChapterTimelineHeader closedCount={timeline.cards.length} />
              {timeline.cards.map((card) => (
                <ChapterCard
                  key={card.row.id}
                  data={card}
                  onToggle={() => toggle(card.row.id)}
                  session={card.row.id === expandedId ? session : null}
                  blockedReason={gateReason}
                  hotkeysEnabled={focused}
                  onJump={() => jump(card.row.startEntryId)}
                  onDelete={() => guard(() => void deleteConfirm.open(card.row.id))}
                />
              ))}
              <ChapterInProgressCard progress={chapterProgress} sinceLabel={timeline.sinceLabel} />
            </View>
          </ScrollView>
          {isPhone ? (
            <RowSaveBar
              session={session}
              enabled={focused}
              blocked={editBlocked}
              blockedReason={gateReason}
            />
          ) : null}
        </KeyboardInsetColumn>
      )}
      <RowLeaveDialog session={session} blocked={editBlocked} blockedReason={gateReason} />
      {/* Focus-gated: the portaled confirm would otherwise paint over a screen pushed on top. */}
      {deleteConfirm.target != null && focused ? (
        <ChapterDeleteConfirm
          open
          onOpenChange={(next) => {
            if (!next) deleteConfirm.dismiss()
          }}
          preview={deleteConfirm.target.preview}
          blockedReason={gateReason}
          pending={deleteConfirm.pending}
          onDelete={(mode) => void deleteConfirm.confirm(mode)}
        />
      ) : null}
      {storyLeaveDialog}
    </ScreenShell>
  )
}
