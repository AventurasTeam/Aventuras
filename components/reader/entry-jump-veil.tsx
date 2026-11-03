import { View } from 'react-native'

import { EmptyState } from '@/components/ui/empty-state'
import { t } from '@/lib/i18n'

import { useJumpVeilUp, type JumpVeil } from './use-entry-jump'

/** Covers the reader while a jump that needed a read lands; only this re-renders as it toggles. */
export function EntryJumpVeil({ veil }: { veil: JumpVeil }) {
  const up = useJumpVeilUp(veil)
  if (!up) return null
  return (
    <View className="absolute inset-0 items-center justify-center bg-bg-base">
      <EmptyState title={t('reader:jumpLoading')} />
    </View>
  )
}
