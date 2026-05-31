import { View } from 'react-native'

import { SwitchRow } from '@/components/compounds/switch-row'
import { t } from '@/lib/i18n'

type DiagnosticsSettingsPanelProps = {
  enabled: boolean
  debugEnabled: boolean
  onToggleEnabled: (next: boolean) => void
  onToggleDebug: (next: boolean) => void
}

export function DiagnosticsSettingsPanel({
  enabled,
  debugEnabled,
  onToggleEnabled,
  onToggleDebug,
}: DiagnosticsSettingsPanelProps) {
  return (
    <View className="gap-1">
      <SwitchRow
        label={t('settings:diagnostics.enableLabel')}
        hint={t('settings:diagnostics.enableHint')}
        checked={enabled}
        onCheckedChange={onToggleEnabled}
      />
      <SwitchRow
        label={t('settings:diagnostics.debugLabel')}
        hint={t('settings:diagnostics.debugHint')}
        checked={debugEnabled}
        onCheckedChange={onToggleDebug}
        disabled={!enabled}
      />
    </View>
  )
}

export type { DiagnosticsSettingsPanelProps }
