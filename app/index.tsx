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
import { deleteStory, openStory, setStoryArchived, setStoryFavorite } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  rehydrateStories,
  selectStoryCards,
  storiesStore,
  type StoryFilter,
  type StoryListQuery,
  type StorySort,
} from '@/lib/stores'

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

  const goWizard = () => router.push('/wizard' as Href)
  const onNewStory = () => {
    if (sessionExists) {
      setPrompt({ trigger: 'new-story' })
      return
    }
    goWizard()
  }
  const openDraft = (storyId: string) => {
    if (sessionExists) {
      setPrompt({ trigger: 'draft', storyId })
      return
    }
    goWizard()
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
        void openStory(storyId, ctx, (branchId) => router.push(`/reader-composer/${branchId}`))
      },
      onToggleFavorite: () => {
        void setStoryFavorite(storyId, !(row?.favorite === 1), ctx)
      },
      onArchiveToggle: () => {
        void setStoryArchived(storyId, row?.status !== 'archived', ctx)
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

      {prompt ? (
        <ConcurrentStatePrompt
          trigger={prompt.trigger}
          onContinueSession={() => {
            setPrompt(null)
            goWizard()
          }}
          onDiscard={() => {
            setPrompt(null)
            goWizard()
          }}
          onDismiss={() => setPrompt(null)}
        />
      ) : null}

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
                  if (id) void deleteStory(id, ctx)
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
