import { View } from 'react-native'

import { EmptyState } from '@/components/ui/empty-state'
import { t } from '@/lib/i18n'

export function PlotDetailEmpty() {
  return (
    <View className="flex-1 items-center justify-center bg-bg-base">
      <EmptyState title={t('plot:detail.selectRow')} subtext={t('plot:detail.selectRowBody')} />
    </View>
  )
}
