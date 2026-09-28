import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { DeleteConfirmDialog } from './delete-confirm-dialog'

const WAIT = { timeout: 3000 }

const meta = {
  title: 'Compounds/DeleteConfirmDialog',
  component: DeleteConfirmDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    title: 'Delete Mira?',
    description: "This can be undone from the reader with Ctrl+Z (Undo in the reader's menu).",
    impacts: [
      '2 awareness records',
      '1 happening involvement',
      '1 relationship',
      'Removed from the current scene',
    ],
    confirmLabel: 'Delete character',
  },
} satisfies Meta<typeof DeleteConfirmDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Character: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Mira?' })
    await waitFor(() => {
      expect(within(dialog).getByText('• 2 awareness records')).toBeVisible()
      expect(within(dialog).getByText('• Removed from the current scene')).toBeVisible()
      expect(
        within(dialog).getByText(
          "This can be undone from the reader with Ctrl+Z (Undo in the reader's menu).",
        ),
      ).toBeVisible()
    }, WAIT)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete character' }))
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
    expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

export const Lore: Story = {
  args: { title: 'Delete The Aetherium?', impacts: [], confirmLabel: 'Delete lore' },
  play: async ({ args }) => {
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete The Aetherium?' })
    expect(screen.queryByTestId('delete-impacts')).toBeNull()
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    }, WAIT)
    await userEvent.keyboard('{Escape}')
    expect(args.onOpenChange).toHaveBeenCalledWith(false)
    expect(args.onConfirm).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(args.onOpenChange).toHaveBeenCalledWith(false)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } }
