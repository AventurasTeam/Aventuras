import { Platform, View } from 'react-native'

import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import type { Row } from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'

export type ActionsMenuRowData = {
  label: string
  disabled?: boolean
  disabledReason?: string
  onActivate: () => void
}

/** Web shows a disabled entry's reason as a tooltip; native, which has none, as a line under it. */
export function ActionsMenuRow({ row }: { row: Row<ActionsMenuRowData> }) {
  const { label, disabled, disabledReason } = row.data
  const reason = disabled === true && disabledReason ? disabledReason : undefined
  return (
    <ReasonTooltip reason={reason}>
      <View className="w-full">
        <Text
          size="sm"
          className={disabled ? 'text-fg-muted' : 'text-fg-primary'}
          numberOfLines={1}
        >
          {label}
        </Text>
        {reason != null && Platform.OS !== 'web' ? (
          <Text size="xs" variant="muted" className="mt-0.5">
            {reason}
          </Text>
        ) : null}
      </View>
    </ReasonTooltip>
  )
}
