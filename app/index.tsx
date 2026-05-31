import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { AppActionsMenu } from '@/components/compounds/app-actions-menu'
import { ScreenShell } from '@/components/shells/screen-shell'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { domain } from '@/lib/stores'

// Temporary M1 nav stopgap: no story exists until a later slice's synthetic
// story, so a dev-only affordance is the only path into the reader.
const DEBUG_ID = '__debug__'

export default function Index() {
  const router = useRouter()
  const diagnosticsEnabled = domain.useAppSettings((s) => s.diagnostics.enabled)

  const openReaderDebug = () => {
    domain.setCurrentStory(DEBUG_ID)
    domain.setCurrentBranch(DEBUG_ID)
    router.push(`/reader-composer/${DEBUG_ID}`)
  }

  return (
    <ScreenShell
      variant="app-root"
      title={<Text className="font-semibold">{t('landing:title')}</Text>}
      onOpenAppSettings={() => router.push('/settings')}
      actions={
        <AppActionsMenu
          diagnosticsEnabled={diagnosticsEnabled}
          onOpenDiagnosticsHub={() => router.push('/diagnostics')}
        />
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
