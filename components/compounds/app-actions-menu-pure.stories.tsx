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
