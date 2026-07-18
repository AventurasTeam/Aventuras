import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { StoryConfigRecoveryDialog } from './story-config-recovery-dialog'

const meta = {
  title: 'Compounds/Story/StoryConfigRecoveryDialog',
  component: StoryConfigRecoveryDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    storyName: 'Mornstone',
    onOpenFile: fn(),
    onReset: fn(),
    onDismiss: fn(),
  },
} satisfies Meta<typeof StoryConfigRecoveryDialog>

export default meta
type Story = StoryObj<typeof meta>

export const DesktopSettings: Story = {
  args: { kind: 'settings-corrupt' },
  play: async ({ args }) => {
    expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument()

    const reset = screen.getByRole('button', { name: 'Reset settings for this story' })
    await userEvent.click(reset)

    expect(args.onReset).not.toHaveBeenCalled()
    expect(screen.getByText('Reset settings for Mornstone?')).toBeInTheDocument()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())

    await userEvent.click(cancel)
    const restoredReset = screen.getByRole('button', { name: 'Reset settings for this story' })
    await waitFor(() => expect(restoredReset).toHaveFocus())

    await userEvent.click(restoredReset)
    await userEvent.click(screen.getByRole('button', { name: 'Reset settings' }))
    expect(args.onReset).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset settings for this story' })).toHaveFocus(),
    )
  },
}

export const AndroidSettings: Story = {
  args: { kind: 'settings-corrupt', onOpenFile: undefined },
  play: async () => {
    expect(screen.queryByRole('button', { name: 'Open file' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reset settings for this story' }),
    ).toBeInTheDocument()
  },
}

export const DesktopDefinition: Story = {
  args: { kind: 'definition-corrupt' },
  play: async () => {
    expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reset settings for this story' }),
    ).not.toBeInTheDocument()
  },
}

export const AndroidDefinition: Story = {
  args: { kind: 'definition-corrupt', onOpenFile: undefined },
  play: async () => {
    expect(screen.queryByRole('button', { name: 'Open file' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reset settings for this story' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument()
  },
}
