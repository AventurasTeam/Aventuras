import { TriangleAlert } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

export function AiConfigBanner({ onPressCta }: { onPressCta: () => void }) {
  return (
    <View className="w-full flex-row items-center gap-2 border-y border-warning bg-warning px-3 py-2.5">
      <Icon as={TriangleAlert} size="sm" className="text-warning-fg" />
      <Text className="text-warning-fg">{t('aiBanner.notConfigured')}</Text>
      <Pressable accessibilityRole="link" onPress={onPressCta}>
        <Text className="text-warning-fg underline">{t('aiBanner.cta')}</Text>
      </Pressable>
    </View>
  )
}
