import { ActionsMenu, type ActionGroup } from '@/components/compounds/actions-menu'
import { t } from '@/lib/i18n'

type AppActionsMenuPureProps = {
  diagnosticsEnabled: boolean
  onOpenDiagnosticsHub: () => void
}

// Presentational variant — props in, no store/navigation coupling — so stories
// drive the gating and activation directly. The app mounts the connected
// `AppActionsMenu`, which wires these from the appSettings selector + router.
export function AppActionsMenuPure({
  diagnosticsEnabled,
  onOpenDiagnosticsHub,
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
  return <ActionsMenu coreGroups={[appGroup]} triggerLabel={t('chrome.actions')} triggerSize="lg" />
}

export type { AppActionsMenuPureProps }
