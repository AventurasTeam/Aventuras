import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { ScreenShell } from '@/components/shells/screen-shell'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

export default function DiagnosticsHubRoute() {
  const router = useRouter()
  return (
    <ScreenShell
      variant="app"
      title={<Text className="font-semibold">{t('settings:diagnosticsHub.title')}</Text>}
      onBack={() => router.back()}
    >
      <View className="flex-1 items-center justify-center">
        <EmptyState title={t('settings:diagnosticsHub.comingSoon')} />
      </View>
    </ScreenShell>
  )
}
