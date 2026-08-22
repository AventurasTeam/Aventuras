import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { AppActionsMenuPure } from './app-actions-menu-pure'

const meta: Meta<typeof AppActionsMenuPure> = {
  title: 'Compounds/AppActionsMenuPure',
  component: AppActionsMenuPure,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof AppActionsMenuPure>

// Diagnostics on → entry present and activates the handler.
export const DiagnosticsOn: Story = {
  args: { diagnosticsEnabled: true, onOpenDiagnosticsHub: fn() },
  play: async ({ args }) => {
    // The ActionsMenu trigger's accessible name includes a shortcut hint on
    // web ("Actions (Ctrl+K)"), so match by regex, not exact string.
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    const entry = await screen.findByRole('option', { name: 'Diagnostics Hub' })
    await userEvent.click(entry)
    await waitFor(() => expect(args.onOpenDiagnosticsHub).toHaveBeenCalled())
  },
}

// Diagnostics off → entry absent (hidden, not disabled).
export const DiagnosticsOff: Story = {
  args: { diagnosticsEnabled: false, onOpenDiagnosticsHub: fn() },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    // Confirm the overlay actually opened (its search input) before asserting absence.
    await screen.findByPlaceholderText('Search actions…')
    expect(screen.queryByRole('option', { name: 'Diagnostics Hub' })).toBeNull()
  },
}

// The wrapper forwarded neither gate until this slice, so actions-menu.md's "does nothing
// while a modal owns the surface" rule was unreachable from every production mount. `blocked`
// gates the trigger as well as the shortcut; `hotkeyEnabled` gates only the shortcut.
export const BlockedIgnoresShortcutAndTrigger: Story = {
  args: { diagnosticsEnabled: true, onOpenDiagnosticsHub: fn(), blocked: true },
  play: async () => {
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByPlaceholderText('Search actions…')).not.toBeInTheDocument()

    // Not clicked: userEvent refuses a pointer-events:none target, which is itself the
    // assertion — the trigger is inert, not merely unstyled.
    expect(screen.getByRole('button', { name: /Actions/ })).toHaveStyle({
      pointerEvents: 'none',
    })
  },
}

export const HotkeyDisabledStillOpensFromTheTrigger: Story = {
  args: { diagnosticsEnabled: true, onOpenDiagnosticsHub: fn(), hotkeyEnabled: false },
  play: async () => {
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.queryByPlaceholderText('Search actions…')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    expect(await screen.findByPlaceholderText('Search actions…')).toBeInTheDocument()
  },
}
