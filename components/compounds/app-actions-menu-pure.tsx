import { ActionsMenu, type ActionGroup } from '@/components/compounds/actions-menu'
import { t } from '@/lib/i18n'

type AppActionsMenuPureProps = {
  diagnosticsEnabled: boolean
  onOpenDiagnosticsHub: () => void
  /** Screen-contributed "ON THIS SCREEN" group; omitted → zone hidden. */
  contextual?: ActionGroup
  /** Passed through to `ActionsMenu`; the route owns the focus state. */
  hotkeyEnabled?: boolean
}

// Presentational variant — props in, no store/navigation coupling — so stories
// drive the gating and activation directly. The app mounts the connected
// `AppActionsMenu`, which wires these from the appSettings selector + router.
export function AppActionsMenuPure({
  diagnosticsEnabled,
  onOpenDiagnosticsHub,
  contextual,
  hotkeyEnabled,
}: AppActionsMenuPureProps) {
  // Capability-gated entries are absent from the array, not disabled — the menu
  // doesn't surface dead commands (per actions-menu spec).
  const appGroup: ActionGroup = {
    id: 'app',
    header: t('settings:actions.appGroup'),
    entries: diagnosticsEnabled
      ? [
          {
            id: 'diagnostics-hub',
            label: t('settings:diagnosticsHub.actionLabel'),
            onActivate: onOpenDiagnosticsHub,
          },
        ]
      : [],
  }
  // Chrome bar trigger — lg to match the top-bar IconActions.
  return (
    <ActionsMenu
      contextual={contextual}
      coreGroups={[appGroup]}
      triggerLabel={t('chrome.actions')}
      triggerSize="lg"
      hotkeyEnabled={hotkeyEnabled}
    />
  )
}

export type { AppActionsMenuPureProps }
