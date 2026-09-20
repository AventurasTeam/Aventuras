import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { EmbeddingUpgradeDialog } from './embedding-upgrade-dialog'

const CURRENT = 'Xenova/all-MiniLM-L6-v2'
const TARGET = 'onnx-community/embeddinggemma-300m-ONNX'

// No `tags: ['autodocs']` — every story is open, so a docs page would stack the modals.
const meta: Meta<typeof EmbeddingUpgradeDialog> = {
  title: 'Compounds/Embedder/EmbeddingUpgradeDialog',
  component: EmbeddingUpgradeDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    currentModelId: CURRENT,
    targetModelId: TARGET,
    onUpgrade: fn(),
    onKeep: fn(),
    onLater: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('storySettings:upgrade.title'))
    expect(dialog).toHaveTextContent(CURRENT)
    expect(dialog).toHaveTextContent(TARGET)
  },
}

export const KeepFires: Story = {
  play: async ({ args }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: t('storySettings:upgrade.keep') }),
    )
    await waitFor(() => expect(args.onKeep).toHaveBeenCalledTimes(1))
    expect(args.onUpgrade).not.toHaveBeenCalled()
    expect(args.onLater).not.toHaveBeenCalled()
  },
}

export const UpgradeFires: Story = {
  play: async ({ args }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: t('storySettings:upgrade.upgrade') }),
    )
    await waitFor(() => expect(args.onUpgrade).toHaveBeenCalledTimes(1))
    expect(args.onKeep).not.toHaveBeenCalled()
    expect(args.onLater).not.toHaveBeenCalled()
  },
}

export const LaterFires: Story = {
  play: async ({ args }) => {
    await userEvent.click(
      await screen.findByRole('button', { name: t('storySettings:upgrade.later') }),
    )
    await waitFor(() => expect(args.onLater).toHaveBeenCalledTimes(1))
    expect(args.onKeep).not.toHaveBeenCalled()
    expect(args.onUpgrade).not.toHaveBeenCalled()
  },
}

export const EscapeDefers: Story = {
  play: async ({ args }) => {
    await screen.findByRole('alertdialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onLater).toHaveBeenCalledTimes(1))
    expect(args.onKeep).not.toHaveBeenCalled()
    expect(args.onUpgrade).not.toHaveBeenCalled()
  },
}
