import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import {
  StoryConfigRecoveryDialog,
  type StoryConfigRecoveryDialogProps,
} from './story-config-recovery-dialog'

type LifecycleState = Pick<StoryConfigRecoveryDialogProps, 'open' | 'kind' | 'storyName'>

function LifecycleHarness(props: StoryConfigRecoveryDialogProps) {
  const [state, setState] = useState<LifecycleState>({
    open: props.open,
    kind: props.kind,
    storyName: props.storyName,
  })

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      if (event.key === 'F6') setState((current) => ({ ...current, open: false }))
      if (event.key === 'F7') setState((current) => ({ ...current, open: true }))
      if (event.key === 'F8') setState((current) => ({ ...current, storyName: 'Ashfall' }))
      if (event.key === 'F9') setState((current) => ({ ...current, kind: 'definition-corrupt' }))
    }
    window.addEventListener('keydown', update)
    return () => window.removeEventListener('keydown', update)
  }, [])

  return <StoryConfigRecoveryDialog {...props} {...state} />
}

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

export const ControlledLifecycleReset: Story = {
  args: { kind: 'settings-corrupt' },
  render: (args) => <LifecycleHarness {...args} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Reset settings for this story' }))
    expect(screen.getByText('Reset settings for Mornstone?')).toBeInTheDocument()

    await userEvent.keyboard('{F6}')
    await waitFor(() =>
      expect(screen.queryByText('Reset settings for Mornstone?')).not.toBeInTheDocument(),
    )

    await userEvent.keyboard('{F7}')
    await waitFor(() => expect(screen.getByText("Couldn't open Mornstone")).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Reset settings for this story' }))
    await userEvent.keyboard('{F8}')
    await waitFor(() => expect(screen.getByText("Couldn't open Ashfall")).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Reset settings for this story' }))
    await userEvent.keyboard('{F9}')
    await waitFor(() =>
      expect(
        screen.getByText(
          "This story's definition is corrupted. Aventuras has no safe default to replace it.",
        ),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'Reset settings for this story' }),
    ).not.toBeInTheDocument()
  },
}
