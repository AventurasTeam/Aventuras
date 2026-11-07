import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo, type ReactElement } from 'react'
import { ScrollView, View } from 'react-native'

import { ChapterCard } from '@/components/chapters/chapter-card'
import { useChapterExpansion } from '@/components/chapters/chapter-expansion'
import { ChapterInProgressCard } from '@/components/chapters/chapter-in-progress-card'
import { chapterTimelineData } from '@/components/chapters/chapter-timeline-data'
import { ChapterTimelineHeader } from '@/components/chapters/chapter-timeline-header'
import { useChapterRowSession } from '@/components/chapters/use-chapter-row-session'
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
import { single as singleParam } from '@/components/world/world-selection'
import { useChapterProgress } from '@/hooks/use-chapter-progress'
import { useColdOpenStory } from '@/hooks/use-cold-open-story'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { useIsRouteFocused } from '@/hooks/use-is-route-focused'
import { useMasterDetailBack } from '@/hooks/use-master-detail-back'
import { useRowSessionGuard } from '@/hooks/use-row-session-guard'
import { useStoryLeaveGuard } from '@/hooks/use-story-leave-guard'
import { useTier } from '@/hooks/use-tier'
import { saveChapter, type ChapterSaveResult } from '@/lib/actions'
import { resolveCalendar, type CalendarFrame } from '@/lib/calendar'
import { chapterDraftFrom, type ChapterDraft } from '@/lib/chapters'
import { db, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'
import { chaptersStore, storiesStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

// No field renders while no card is open, so no Save can reach this; it writes nothing.
const NO_CHAPTER_OPEN: ChapterSaveResult = {
  status: 'rejected',
  reason: 'no chapter open',
  code: 'failed',
}

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
        // Empty while the index reads or after it failed: entry ranges drop, nothing waits on it.
        entryIndex: entryIndex.index,
        frame,
      }),
    [branchId, chapterRows, ranges, entryIndex.index, frame],
  )
  const expansionRows = useMemo(() => timeline.cards.map((card) => card.row), [timeline.cards])

  const { onSession, guard, navigateGuarded, dirty } = useRowSessionGuard()
  // Ahead of the session: its key is the expanded id, which must change in the same render.
  const { expandedId, setExpanded } = useChapterExpansion({
    ready: open != null,
    rows: expansionRows,
    runInFlight: editBlocked,
    dirty,
  })
  const expandedRow = timeline.cards.find((card) => card.row.id === expandedId)?.row ?? null
  const values = useMemo(() => chapterDraftFrom(expandedRow), [expandedRow])
  const onSave = useCallback(
    (draft: ChapterDraft): Promise<ChapterSaveResult> =>
      expandedRow == null
        ? Promise.resolve(NO_CHAPTER_OPEN)
        : saveChapter({ branchId, row: expandedRow, draft }, ctx),
    [branchId, expandedRow],
  )
  const onSaved = useCallback(() => toast.success(t('chapters:save.saved')), [])
  // Hosted above every card for the route's life, so the phone bar can sit outside the scroller.
  const session = useChapterRowSession({
    rowId: expandedId,
    values,
    onSave,
    onSaved,
    // The save bar's notice has no visible text on phone, so a refused save also toasts.
    onRejected: toast.error,
    onSession,
  })

  const toggle = useCallback(
    (id: string) => guard(() => setExpanded(id === expandedId ? null : id)),
    [guard, setExpanded, expandedId],
  )
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
              <ChapterTimelineHeader closedCount={timeline.closedCount} />
              {timeline.cards.map((card) => {
                const expanded = card.row.id === expandedId
                return (
                  <ChapterCard
                    key={card.row.id}
                    data={card}
                    expanded={expanded}
                    onToggle={() => toggle(card.row.id)}
                    // Its fields mount once the form holds this row, or native shows the last row.
                    session={expanded && session.formRowId === card.row.id ? session : null}
                    blocked={editBlocked}
                    blockedReason={gateReason}
                    hotkeysEnabled={focused}
                    onJump={() => jump(card.row.startEntryId)}
                  />
                )
              })}
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
      {storyLeaveDialog}
    </ScreenShell>
  )
}
