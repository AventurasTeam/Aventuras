import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { UnsavedChangesDialog } from './unsaved-changes-dialog'

const meta: Meta<typeof UnsavedChangesDialog> = {
  title: 'Compounds/StorySettings/UnsavedChangesDialog',
  component: UnsavedChangesDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  args: { open: true, onSave: fn(), onDiscard: fn(), onCancel: fn() },
}

/**
 * Commit in flight — all three actions are inert. The owner keeps the
 * dialog mounted until the pending leave resolves.
 */
export const Saving: Story = {
  args: { open: true, saving: true, onSave: fn(), onDiscard: fn(), onCancel: fn() },
  play: async ({ args }) => {
    for (const name of ['Cancel', 'Discard', 'Save']) {
      expect(await screen.findByRole('button', { name })).toBeDisabled()
    }
    // Escape and Android back reach the same close handler the disabled
    // Cancel does, so the guard has to hold for them too.
    await userEvent.keyboard('{Escape}')
    expect(args.onCancel).not.toHaveBeenCalled()
    expect(args.onSave).not.toHaveBeenCalled()
    expect(args.onDiscard).not.toHaveBeenCalled()
  },
}

export const SaveFires: Story = {
  args: { open: true, onSave: fn(), onDiscard: fn(), onCancel: fn() },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalled())
    // Save must not also request close — that would resolve the leave twice.
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const DiscardFires: Story = {
  args: { open: true, onSave: fn(), onDiscard: fn(), onCancel: fn() },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(args.onDiscard).toHaveBeenCalled())
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const CancelFires: Story = {
  args: { open: true, onSave: fn(), onDiscard: fn(), onCancel: fn() },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(args.onCancel).toHaveBeenCalled())
    expect(args.onSave).not.toHaveBeenCalled()
    expect(args.onDiscard).not.toHaveBeenCalled()
  },
}

export const EscapeCancels: Story = {
  args: { open: true, onSave: fn(), onDiscard: fn(), onCancel: fn() },
  play: async ({ args }) => {
    await screen.findByRole('button', { name: 'Cancel' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onCancel).toHaveBeenCalled())
  },
}

/**
 * Invalid draft state — Save is disabled, but Discard and Cancel remain live
 * as escape hatches. The reason is displayed under the body copy and is
 * semantically included in the dialog's accessible description (aria-describedby).
 * Design invariant: an invalid session must never become a trap.
 */
export const InvalidDraft: Story = {
  args: {
    open: true,
    saveDisabled: true,
    reason: 'Two suggestion categories share a label',
    onSave: fn(),
    onDiscard: fn(),
    onCancel: fn(),
  },
  play: async ({ args }) => {
    const save = await screen.findByRole('button', { name: 'Save' })
    const discard = await screen.findByRole('button', { name: 'Discard' })
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    expect(save).toBeDisabled()
    expect(discard).not.toBeDisabled()
    expect(cancel).not.toBeDisabled()
    const reasonText = screen.getByText('Two suggestion categories share a label')
    expect(reasonText).toBeInTheDocument()
    // Verify reason is inside the dialog's aria-describedby target, not orphaned
    const alertDialog = screen.getByRole('alertdialog')
    const describedById = alertDialog.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    const describedByElement = document.getElementById(describedById!)
    expect(describedByElement).toBeTruthy()
    expect(describedByElement).toContainElement(reasonText)
    await userEvent.click(discard)
    await waitFor(() => expect(args.onDiscard).toHaveBeenCalled())
    expect(args.onSave).not.toHaveBeenCalled()
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

/**
 * Invalid draft state with Cancel — verify Cancel still fires even when
 * Save is unavailable.
 */
export const InvalidDraftCancel: Story = {
  args: {
    open: true,
    saveDisabled: true,
    reason: 'Two suggestion categories share a label',
    onSave: fn(),
    onDiscard: fn(),
    onCancel: fn(),
  },
  play: async ({ args }) => {
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    expect(cancel).not.toBeDisabled()
    await userEvent.click(cancel)
    await waitFor(() => expect(args.onCancel).toHaveBeenCalled())
    expect(args.onSave).not.toHaveBeenCalled()
    expect(args.onDiscard).not.toHaveBeenCalled()
  },
}
