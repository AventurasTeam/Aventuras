import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test'

import { AppActionsMenuPure } from './app-actions-menu-pure'
import { buildGoToGroup } from './go-to-group'
import { buildStoryToolsGroup } from './story-tools-group'

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

// `blocked` gates the trigger as well as the shortcut; `hotkeyEnabled` gates only
// the shortcut (actions-menu.md → Inert under a blocking overlay).
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

// On World: GO TO renders; `Open World` self-omits, `Open Plot`/`Open Reader` navigate.
const navigateFromWorld = fn()

export const InStoryWorld: Story = {
  args: {
    diagnosticsEnabled: false,
    onOpenDiagnosticsHub: fn(),
    goTo: buildGoToGroup(
      { storyId: 'story_1', branchId: 'br_1', surface: 'world' },
      navigateFromWorld,
    ),
  },
  play: async () => {
    const trigger = screen.getByRole('button', { name: /Actions/ })

    await userEvent.click(trigger)
    await screen.findByPlaceholderText('Search actions…')
    expect(screen.queryByRole('option', { name: 'Open World' })).toBeNull()
    await userEvent.click(await screen.findByRole('option', { name: 'Open Plot' }))
    await waitFor(() => expect(navigateFromWorld).toHaveBeenCalledWith('/plot/br_1'))

    // The overlay auto-closes on activation — reopen it to check the other entry too.
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Open Reader' }))
    await waitFor(() => expect(navigateFromWorld).toHaveBeenCalledWith('/reader-composer/br_1'))
  },
}

// actions-menu.md → Anatomy: the curated core runs GO TO, STORY TOOLS, APP.
const openCloseModalFromWorld = fn()

export const InStoryCoreGroups: Story = {
  args: {
    diagnosticsEnabled: true,
    onOpenDiagnosticsHub: fn(),
    goTo: buildGoToGroup({ storyId: 'story_1', branchId: 'br_1', surface: 'world' }, fn()),
    storyTools: buildStoryToolsGroup({
      branchId: 'br_1',
      canClose: true,
      gateReason: undefined,
      openCloseModal: openCloseModalFromWorld,
    }),
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    await screen.findByPlaceholderText('Search actions…')
    // The headers render uppercase through CSS; the DOM keeps the copy as written.
    const goTo = screen.getByText('Go to')
    const storyTools = screen.getByText('Story tools')
    const app = screen.getByText('App')
    expect(goTo.compareDocumentPosition(storyTools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(storyTools.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.click(await screen.findByRole('option', { name: 'Close chapter…' }))
    await waitFor(() => expect(openCloseModalFromWorld).toHaveBeenCalledTimes(1))
    expect(openCloseModalFromWorld).toHaveBeenCalledWith({ branchId: 'br_1' })
  },
}

// actions-menu.md → Gating: a run in flight shows the entry disabled with the uniform tooltip.
const GATE_REASON = 'Generation is in flight. Cancel to edit.'
const openCloseModalWhileGated = fn()

export const StoryToolsWhileARunHolds: Story = {
  args: {
    diagnosticsEnabled: false,
    onOpenDiagnosticsHub: fn(),
    storyTools: buildStoryToolsGroup({
      branchId: 'br_1',
      canClose: true,
      gateReason: GATE_REASON,
      openCloseModal: openCloseModalWhileGated,
    }),
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }))
    const entry = await screen.findByRole('option', { name: 'Close chapter…' })
    await expect(entry).toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByTitle(GATE_REASON)).toBeInTheDocument()
    // RN-Web blocks a disabled Pressable's pointer; fireEvent goes past that to the menu's guard.
    fireEvent.click(entry)
    expect(openCloseModalWhileGated).not.toHaveBeenCalled()
  },
}
