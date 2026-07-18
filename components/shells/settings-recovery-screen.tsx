import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { getDatabaseFileRevealAction } from '@/lib/recovery'

type SettingsRecoveryScreenProps = {
  onReset: () => void | Promise<void>
}

// Pre-Router boot surface (not a ScreenShell): rendered from app/_layout when
// app_settings config fails to parse. Reset is always available; Open file is
// desktop-only (feature-detected on the Electron bridge — no path on Android).
export function SettingsRecoveryScreen({ onReset }: SettingsRecoveryScreenProps) {
  const insets = useSafeAreaInsets()
  const revealDbFile = getDatabaseFileRevealAction()

  return (
    <View
      className="flex-1 bg-bg-base"
      style={{
        paddingTop: insets.top,
        paddingRight: insets.right,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      }}
    >
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <Text size="lg" className="font-semibold">
          {t('recovery.title')}
        </Text>
        <Text variant="muted" className="max-w-[400px] text-center">
          {t('recovery.body')}
        </Text>
        <View className="w-full max-w-[320px] gap-3">
          {revealDbFile ? (
            <Button variant="secondary" onPress={() => void revealDbFile()}>
              <Text>{t('recovery.openFile')}</Text>
            </Button>
          ) : null}
          <Button variant="destructive" onPress={() => void onReset()}>
            <Text>{t('recovery.resetSettings')}</Text>
          </Button>
          <Text variant="muted" size="xs" className="text-center">
            {t('recovery.resetWarning')}
          </Text>
        </View>
      </View>
    </View>
  )
}

export type { SettingsRecoveryScreenProps }
