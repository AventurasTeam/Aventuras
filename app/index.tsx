import { useRouter, type Href } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { ScreenShell } from '@/components/shells/screen-shell'
import { AppBannerHost } from '@/components/story/app-banner-host'
import { StoryList, type StoryCardHandlers } from '@/components/story/story-list'
import {
  ConcurrentStatePrompt,
  useWizardSessionExists,
} from '@/components/story/wizard-session-seam'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import {
  clearLiveSession,
  deleteStory,
  loadDraft,
  loadLiveSession,
  openStory,
  setStoryArchived,
  setStoryFavorite,
} from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  rehydrateStories,
  selectStoryCards,
  storiesStore,
  wizardStore,
  type StoryFilter,
  type StoryListQuery,
  type StorySort,
} from '@/lib/stores'
import { runAction } from '@/lib/utils'

const ctx = { db, runInTransaction }

type PromptState = { trigger: 'new-story' | 'draft'; storyId?: string }

export default function Index() {
  const router = useRouter()
  const rows = storiesStore.useStories((s) => s.rows)
  const [query, setQuery] = useState<StoryListQuery>({
    search: '',
    filter: 'all',
    sort: 'last-opened',
  })
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const sessionExists = useWizardSessionExists()

  useEffect(() => {
    void rehydrateStories(db)
  }, [])

  const cards = useMemo(() => selectStoryCards(rows, query, Date.now()), [rows, query])

  const goWizard = (draftId?: string) =>
    router.push((draftId ? `/wizard?draftId=${draftId}` : '/wizard') as Href)

  const onNewStory = () => {
    if (sessionExists) {
      setPrompt({ trigger: 'new-story' })
      return
    }
    // No persisted session, but the in-memory store can hold stale state from an
    // instant-cancel inside the autosave debounce window — start from a clean slate.
    wizardStore.reset()
    goWizard()
  }

  const openDraft = (storyId: string) => {
    if (sessionExists) {
      setPrompt({ trigger: 'draft', storyId })
      return
    }
    runAction(
      loadDraft(storyId, ctx).then((draft) => {
        if (draft) wizardStore.hydrate(draft)
        goWizard(storyId)
      }),
      {
        event: 'action_layer.wizard_draft_load_failed',
        toastMessage: t('landing:errors.draftLoadFailed'),
        context: { storyId },
      },
    )
  }

  const cardHandlers = (storyId: string): StoryCardHandlers => {
    const row = rows.find((r) => r.id === storyId)
    const isDraft = row?.status === 'draft'
    return {
      onOpen: () => {
        if (isDraft) {
          openDraft(storyId)
          return
        }
        runAction(
          openStory(storyId, ctx, (branchId) => router.push(`/reader-composer/${branchId}`)),
          {
            event: 'action_layer.story_open_failed',
            toastMessage: t('landing:errors.openFailed'),
            context: { storyId },
          },
        )
      },
      onToggleFavorite: () => {
        runAction(setStoryFavorite(storyId, !(row?.favorite === 1), ctx), {
          event: 'action_layer.story_favorite_failed',
          toastMessage: t('landing:errors.favoriteFailed'),
          context: { storyId },
        })
      },
      onArchiveToggle: () => {
        runAction(setStoryArchived(storyId, row?.status !== 'archived', ctx), {
          event: 'action_layer.story_archive_failed',
          toastMessage: t('landing:errors.archiveFailed'),
          context: { storyId },
        })
      },
      onDelete: () => setPendingDelete(storyId),
    }
  }

  return (
    <ScreenShell
      variant="app-root"
      title={<Text className="font-semibold">{t('landing:title')}</Text>}
      onOpenAppSettings={() => router.push('/settings')}
      actions={<AppActionsMenu />}
    >
      <StoryList
        cards={cards}
        totalCount={rows.length}
        query={query}
        onSearch={(search) => setQuery((q) => ({ ...q, search }))}
        onFilter={(filter: StoryFilter) => setQuery((q) => ({ ...q, filter }))}
        onSort={(sort: StorySort) => setQuery((q) => ({ ...q, sort }))}
        onNewStory={onNewStory}
        cardHandlers={cardHandlers}
        banner={
          <AppBannerHost onConfigureProvider={() => router.push('/settings?tab=providers')} />
        }
      />

      <ConcurrentStatePrompt
        open={prompt != null}
        trigger={prompt?.trigger ?? 'new-story'}
        draftName={rows.find((r) => r.id === prompt?.storyId)?.title}
        onContinueSession={() => {
          // wizardStore is in-memory only, so it doesn't survive an app
          // restart — re-hydrate from the persisted live session before
          // opening the wizard, or a resumed session would render blank.
          runAction(
            loadLiveSession(ctx).then((session) => {
              if (session) wizardStore.hydrate(session)
              setPrompt(null)
              goWizard()
            }),
            {
              event: 'action_layer.wizard_session_resume_failed',
              toastMessage: t('landing:errors.resumeSessionFailed'),
            },
          )
        }}
        onDiscard={() => {
          const target = prompt
          runAction(
            clearLiveSession(ctx).then(async () => {
              if (target?.trigger === 'draft' && target.storyId) {
                const draft = await loadDraft(target.storyId, ctx)
                if (draft) wizardStore.hydrate(draft)
                else wizardStore.reset()
                setPrompt(null)
                goWizard(target.storyId)
                return
              }
              wizardStore.reset()
              setPrompt(null)
              goWizard()
            }),
            {
              event: 'action_layer.wizard_session_discard_failed',
              toastMessage: t('landing:errors.discardSessionFailed'),
              context: { storyId: target?.storyId },
            },
          )
        }}
        onDismiss={() => setPrompt(null)}
      />

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('landing:delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('landing:delete.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary">
                <Text>{t('landing:delete.cancel')}</Text>
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onPress={() => {
                  const id = pendingDelete
                  if (id)
                    runAction(deleteStory(id, ctx), {
                      event: 'action_layer.story_delete_failed',
                      toastMessage: t('landing:errors.deleteFailed'),
                      context: { storyId: id },
                    })
                }}
              >
                <Text>{t('landing:delete.confirm')}</Text>
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScreenShell>
  )
}
