import { useRouter, type Href } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

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
  navigationStore,
  rehydrateStories,
  selectStoryCards,
  storiesStore,
  type StoryFilter,
  type StoryListQuery,
  type StorySort,
} from '@/lib/stores'

const DEBUG_ID = '__debug__'
const ctx = { db, runInTransaction }
const nowSec = () => Math.floor(Date.now() / 1000)

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

  const cards = useMemo(() => selectStoryCards(rows, query, nowSec()), [rows, query])

  // The wizard route + draft-resume contract are owned by Slice 2.3 (unmerged); until it
  // lands, both entry points route to /wizard (cast: not in the typed-route table yet) and
  // the session prompt path stays dormant (useWizardSessionExists returns false until 2.3).
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
        void openStory(
          storyId,
          ctx,
          (branchId) => router.push(`/reader-composer/${branchId}`),
          nowSec(),
        )
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
        banner={<AppBannerHost onConfigureProvider={() => router.push('/settings')} />}
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
                  if (pendingDelete) void deleteStory(pendingDelete, ctx)
                }}
              >
                <Text>{t('landing:delete.confirm')}</Text>
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {__DEV__ ? (
        <View className="items-center p-4">
          <Button
            variant="secondary"
            onPress={() => {
              navigationStore.setCurrentStory(DEBUG_ID)
              navigationStore.setCurrentBranch(DEBUG_ID)
              router.push(`/reader-composer/${DEBUG_ID}`)
            }}
          >
            <Text>{t('landing:openReaderDebug')}</Text>
          </Button>
        </View>
      ) : null}
    </ScreenShell>
  )
}
