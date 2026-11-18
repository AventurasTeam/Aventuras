import { ActionsMenu, type ActionGroup } from '@/components/compounds/actions-menu'
import { t } from '@/lib/i18n'

type AppActionsMenuPureProps = {
  diagnosticsEnabled: boolean
  onOpenDiagnosticsHub: () => void
  /** Screen-contributed "ON THIS SCREEN" group; omitted → zone hidden. */
  contextual?: ActionGroup
  /** The in-story `GO TO` group (go-to-group.ts); omitted off-story. */
  goTo?: ActionGroup
  /** The in-story `STORY TOOLS` group (story-tools-group.ts); omitted when it has no entry. */
  storyTools?: ActionGroup
  /** Passed through to `ActionsMenu`; the route owns the focus state. */
  hotkeyEnabled?: boolean
  /** Passed through to `ActionsMenu`; the route owns which overlays block it. */
  blocked?: boolean
  /** Passed through to `ActionsMenu`. */
  onOpenChange?: (open: boolean) => void
}

// Presentational variant — props in, no store/navigation coupling — so stories
// drive the gating and activation directly. The app mounts the connected
// `AppActionsMenu`, which wires these from the appSettings selector + router.
export function AppActionsMenuPure({
  diagnosticsEnabled,
  onOpenDiagnosticsHub,
  contextual,
  goTo,
  storyTools,
  hotkeyEnabled,
  blocked,
  onOpenChange,
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
  // actions-menu.md → Anatomy: GO TO, STORY TOOLS, APP.
  const coreGroups = [goTo, storyTools, appGroup].filter(
    (group): group is ActionGroup => group != null,
  )
  // Chrome bar trigger — lg to match the top-bar IconActions.
  return (
    <ActionsMenu
      contextual={contextual}
      coreGroups={coreGroups}
      triggerLabel={t('chrome.actions')}
      triggerSize="lg"
      hotkeyEnabled={hotkeyEnabled}
      blocked={blocked}
      onOpenChange={onOpenChange}
    />
  )
}

export type { AppActionsMenuPureProps }
