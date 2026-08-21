import { useRouter } from 'expo-router'

import type { ActionGroup } from '@/components/compounds/actions-menu'
import { AppActionsMenuPure } from '@/components/compounds/app-actions-menu-pure'
import { appSettingsStore } from '@/lib/stores'

type AppActionsMenuProps = {
  contextual?: ActionGroup
  /**
   * Wraps every route jump this menu owns. A surface with a save session
   * passes its `requestLeave` so the jump routes through the unsaved-changes
   * guard; `save-sessions.md → Navigate-away guard` lists Actions-menu route
   * jumps as a required intercept. Defaults to navigating immediately.
   */
  beforeNavigate?: (proceed: () => void) => void
  /** Passed through to `ActionsMenu`; the route owns the focus state. */
  hotkeyEnabled?: boolean
}

// Connected variant the chrome screens mount as `<AppActionsMenu />`. Reads the
// diagnostics gate through the selector (never a snapshot) and owns the
// Diagnostics-Hub navigation; screens pass only their contextual group.
export function AppActionsMenu({ contextual, beforeNavigate, hotkeyEnabled }: AppActionsMenuProps) {
  const router = useRouter()
  const diagnosticsEnabled = appSettingsStore.useAppSettings((s) => s.diagnostics.enabled)
  return (
    <AppActionsMenuPure
      diagnosticsEnabled={diagnosticsEnabled}
      onOpenDiagnosticsHub={() => {
        const go = () => router.push('/diagnostics')
        if (beforeNavigate) beforeNavigate(go)
        else go()
      }}
      contextual={contextual}
      hotkeyEnabled={hotkeyEnabled}
    />
  )
}
