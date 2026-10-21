import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { StoryLeaveDialog } from './story-leave-dialog'

const meta: Meta<typeof StoryLeaveDialog> = {
  title: 'Compounds/StoryLeaveDialog',
  component: StoryLeaveDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

// While leaving, the button's spinner joins its accessible name, so match on the label.
const CANCEL_AND_LEAVE = new RegExp(t('storyLeave.cancelAndLeave'))

export const Open: Story = {
  args: { open: true, leaving: false, onStay: fn(), onConfirmLeave: fn() },
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('storyLeave.title'))
    expect(dialog).toHaveTextContent(t('storyLeave.body'))
    expect(screen.getByRole('button', { name: t('storyLeave.stay') })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: CANCEL_AND_LEAVE })).not.toBeDisabled()
  },
}

export const StayDismisses: Story = {
  args: { open: true, leaving: false, onStay: fn(), onConfirmLeave: fn() },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: t('storyLeave.stay') }))
    await waitFor(() => expect(args.onStay).toHaveBeenCalledTimes(1))
    expect(args.onConfirmLeave).not.toHaveBeenCalled()
  },
}

/** Confirming must not also request close: that would answer Stay beside the leave. */
export const CancelAndLeaveConfirms: Story = {
  args: { open: true, leaving: false, onStay: fn(), onConfirmLeave: fn() },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: CANCEL_AND_LEAVE }))
    await waitFor(() => expect(args.onConfirmLeave).toHaveBeenCalledTimes(1))
    expect(args.onStay).not.toHaveBeenCalled()
  },
}

export const EscapeStays: Story = {
  args: { open: true, leaving: false, onStay: fn(), onConfirmLeave: fn() },
  play: async ({ args }) => {
    await screen.findByRole('alertdialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onStay).toHaveBeenCalledTimes(1))
  },
}

/** Waiting for the story to go idle: both actions are inert, and Escape / back can't stay. */
export const Leaving: Story = {
  args: { open: true, leaving: true, onStay: fn(), onConfirmLeave: fn() },
  play: async ({ args }) => {
    const leave = await screen.findByRole('button', { name: CANCEL_AND_LEAVE })
    expect(leave).toBeDisabled()
    expect(leave).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: t('storyLeave.stay') })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(args.onStay).not.toHaveBeenCalled()
    expect(args.onConfirmLeave).not.toHaveBeenCalled()
  },
}
