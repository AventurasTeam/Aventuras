import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/** Inert until vault import lands (M8.3). */
export function RailImportFooter(): ReactNode {
  return (
    <View className="border-t border-border p-2">
      <Button
        variant="ghost"
        size="sm"
        disabled
        disabledReason={t('reader:rail.importFromVaultReason')}
      >
        <Text>{t('reader:rail.importFromVault')}</Text>
      </Button>
    </View>
  )
}
