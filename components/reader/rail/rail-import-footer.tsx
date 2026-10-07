import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

/** Vault import is M8.3; the footer shows the affordance, inert, with its reason. */
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
