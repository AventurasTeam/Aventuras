import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { SwapResumeDialog } from './swap-resume-dialog'

const meta: Meta<typeof SwapResumeDialog> = {
  title: 'Compounds/Embedder/SwapResumeDialog',
  component: SwapResumeDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  args: {
    open: true,
    targetModelName: 'BGE-small-en-v1.5',
    onResume: fn(),
    onCancelSwap: fn(),
  },
}

export const ResumeFires: Story = {
  args: {
    open: true,
    targetModelName: 'BGE-small-en-v1.5',
    onResume: fn(),
    onCancelSwap: fn(),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.resume') }))
    await waitFor(() => expect(args.onResume).toHaveBeenCalledTimes(1))
    expect(args.onCancelSwap).not.toHaveBeenCalled()
  },
}

export const CancelSwapFires: Story = {
  args: {
    open: true,
    targetModelName: 'BGE-small-en-v1.5',
    onResume: fn(),
    onCancelSwap: fn(),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.cancelSwap') }))
    await waitFor(() => expect(args.onCancelSwap).toHaveBeenCalledTimes(1))
    expect(args.onResume).not.toHaveBeenCalled()
  },
}

export const EscapeDoesNotDismiss: Story = {
  args: {
    open: true,
    targetModelName: 'BGE-small-en-v1.5',
    onResume: fn(),
    onCancelSwap: fn(),
  },
  play: async ({ args }) => {
    await screen.findByRole('button', { name: t('storySettings:swap.resume') })
    await userEvent.keyboard('{Escape}')
    expect(args.onResume).not.toHaveBeenCalled()
    expect(args.onCancelSwap).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: t('storySettings:swap.resume') })).toBeInTheDocument()
  },
}
