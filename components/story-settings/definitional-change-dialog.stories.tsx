import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { t } from '@/lib/i18n'

import { DefinitionalChangeDialog } from './definitional-change-dialog'
import { flaggedFieldsFor } from './flagged-fields'

const meta: Meta<typeof DefinitionalChangeDialog> = {
  title: 'Compounds/StorySettings/DefinitionalChangeDialog',
  component: DefinitionalChangeDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    open: true,
    fields: flaggedFieldsFor(['composerWrapPov']),
    onCancel: fn(),
    onConfirm: fn(),
  },
}

export default meta
type Story = StoryObj<typeof DefinitionalChangeDialog>

function describedBy(dialog: HTMLElement): HTMLElement | null {
  return document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
}

export const OneFlaggedField: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByRole('alertdialog')
    // In the description, so a screen reader announces each consequence with the dialog.
    const description = describedBy(dialog)
    expect(description).toHaveTextContent(t('storySettings:generation.field.composerWrapPov'))
    expect(description).toHaveTextContent(t('storySettings:confirm.consequence.composerWrapPov'))
    await userEvent.click(screen.getByTestId('confirm-save-anyway'))
    expect(args.onConfirm).toHaveBeenCalledTimes(1)
    // Save anyway must not also request close — that would cancel what it confirmed.
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const StacksOneBulletPerField: Story = {
  args: {
    fields: [
      ...flaggedFieldsFor(['composerWrapPov']),
      { key: 'narration', label: 'narration', consequence: 'Changes the prose voice.' },
    ],
  },
  play: async () => {
    const description = describedBy(await screen.findByRole('alertdialog'))
    expect(description?.textContent?.match(/•/g)).toHaveLength(2)
    expect(description).toHaveTextContent('Changes the prose voice.')
  },
}

export const CancelReturnsToEditor: Story = {
  play: async ({ args }) => {
    await screen.findByRole('alertdialog')
    await userEvent.click(screen.getByRole('button', { name: t('cancel') }))
    expect(args.onCancel).toHaveBeenCalledTimes(1)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

export const Saving: Story = {
  args: { saving: true },
  play: async ({ args }) => {
    await screen.findByRole('alertdialog')
    expect(screen.getByTestId('confirm-save-anyway')).toBeDisabled()
    expect(screen.getByRole('button', { name: t('cancel') })).toBeDisabled()
    // Escape reaches the same close handler the disabled Cancel does.
    await userEvent.keyboard('{Escape}')
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}
