import { ActionsMenu, type ActionGroup } from '@/components/compounds/actions-menu'
import { t } from '@/lib/i18n'

type AppActionsMenuProps = {
  /**
   * Gates the Diagnostics-Hub entry. The caller reads this via the
   * `useAppSettings` selector hook (never a captured snapshot).
   */
  diagnosticsEnabled: boolean
  onOpenDiagnosticsHub: () => void
}

export function AppActionsMenu({ diagnosticsEnabled, onOpenDiagnosticsHub }: AppActionsMenuProps) {
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
  return <ActionsMenu coreGroups={[appGroup]} triggerLabel={t('chrome.actions')} />
}

export type { AppActionsMenuProps }
