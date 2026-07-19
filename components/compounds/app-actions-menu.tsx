import { useRouter } from 'expo-router'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenuPure } from '@/components/compounds/app-actions-menu-pure'
import { appSettingsStore } from '@/lib/stores'

// Connected variant the chrome screens mount as `<AppActionsMenu />`. Reads the
// diagnostics gate through the selector (never a snapshot) and owns the
// Diagnostics-Hub navigation; screens pass only their contextual group.
export function AppActionsMenu({ contextual }: { contextual?: ActionGroup }) {
  const router = useRouter()
  const diagnosticsEnabled = appSettingsStore.useAppSettings((s) => s.diagnostics.enabled)
  return (
    <AppActionsMenuPure
      diagnosticsEnabled={diagnosticsEnabled}
      onOpenDiagnosticsHub={() => router.push('/diagnostics')}
      contextual={contextual}
    />
  )
}
