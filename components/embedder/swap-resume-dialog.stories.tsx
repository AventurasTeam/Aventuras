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

const baseArgs = {
  open: true,
  targetModelName: 'BGE-small-en-v1.5',
  onResume: fn(),
  onCancelSwap: fn(),
  onLater: fn(),
}

export const Open: Story = {
  args: { ...baseArgs },
}

export const ResumeFires: Story = {
  args: { ...baseArgs, onResume: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.resume') }))
    await waitFor(() => expect(args.onResume).toHaveBeenCalledTimes(1))
    expect(args.onCancelSwap).not.toHaveBeenCalled()
    expect(args.onLater).not.toHaveBeenCalled()
  },
}

export const CancelSwapFires: Story = {
  args: { ...baseArgs, onCancelSwap: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.cancelSwap') }))
    await waitFor(() => expect(args.onCancelSwap).toHaveBeenCalledTimes(1))
    expect(args.onResume).not.toHaveBeenCalled()
    expect(args.onLater).not.toHaveBeenCalled()
  },
}

export const LaterFires: Story = {
  args: { ...baseArgs, onLater: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: t('storySettings:swap.resumeLater') }))
    await waitFor(() => expect(args.onLater).toHaveBeenCalledTimes(1))
    // Deferring must not decide the swap either way — the marker survives, and
    // the reader's pill keeps reporting it.
    expect(args.onResume).not.toHaveBeenCalled()
    expect(args.onCancelSwap).not.toHaveBeenCalled()
  },
}

export const EscapeDefers: Story = {
  args: { ...baseArgs, onLater: fn() },
  play: async ({ args }) => {
    await screen.findByRole('button', { name: t('storySettings:swap.resume') })
    await userEvent.keyboard('{Escape}')
    // Escape routes to Later rather than being swallowed: a modal whose only
    // exits can both fail is a trap, and deferring decides nothing.
    await waitFor(() => expect(args.onLater).toHaveBeenCalledTimes(1))
    expect(args.onResume).not.toHaveBeenCalled()
    expect(args.onCancelSwap).not.toHaveBeenCalled()
  },
}
