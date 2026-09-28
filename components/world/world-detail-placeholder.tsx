import { View } from 'react-native'

import { EmptyState } from '@/components/ui/empty-state'
import { t } from '@/lib/i18n'

/** World's detail pane with no row selected. */
export function WorldDetailPlaceholder() {
  return (
    <View className="flex-1 items-center justify-center bg-bg-base">
      <EmptyState title={t('world:detail.selectRow')} subtext={t('world:detail.selectRowBody')} />
    </View>
  )
}
