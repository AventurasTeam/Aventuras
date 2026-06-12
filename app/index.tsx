import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { AiConfigBanner } from '@/components/compounds/ai-config-banner'
import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { ScreenShell } from '@/components/shells/screen-shell'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { appSettingsStore, navigationStore } from '@/lib/stores'

// Temporary M1 nav stopgap: no story exists until a later slice's synthetic
// story, so a dev-only affordance is the only path into the reader.
const DEBUG_ID = '__debug__'

export default function Index() {
  const router = useRouter()
  const noProviders = appSettingsStore.useAppSettings((s) => s.providers.length === 0)

  const openReaderDebug = () => {
    navigationStore.setCurrentStory(DEBUG_ID)
    navigationStore.setCurrentBranch(DEBUG_ID)
    router.push(`/reader-composer/${DEBUG_ID}`)
  }

  return (
    <ScreenShell
      variant="app-root"
      title={<Text className="font-semibold">{t('landing:title')}</Text>}
      onOpenAppSettings={() => router.push('/settings')}
      actions={<AppActionsMenu />}
      banners={
        noProviders ? (
          <AiConfigBanner onPressCta={() => router.push('/settings?tab=providers')} />
        ) : undefined
      }
    >
      <View className="flex-1 items-center justify-center gap-6 p-6">
        <EmptyState title={t('landing:emptyTitle')} subtext={t('landing:emptyBody')} />
        {__DEV__ ? (
          <Button variant="secondary" onPress={openReaderDebug}>
            <Text>{t('landing:openReaderDebug')}</Text>
          </Button>
        ) : null}
      </View>
    </ScreenShell>
  )
}
