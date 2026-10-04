import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen } from 'storybook/test'

import { t } from '@/lib/i18n'

import { ReindexConfirmDialog } from './reindex-confirm-dialog'

const meta = {
  title: 'Compounds/Embedder/ReindexConfirmDialog',
  component: ReindexConfirmDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    rowCount: 42,
    modelLabel: 'all-MiniLM-L6-v2',
  },
} satisfies Meta<typeof ReindexConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

/** The cancel semantics are announced with the dialog, not left for browsing. */
export const Default: Story = {
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    await expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining(t('storySettings:reindexConfirm.cancelSemantics')),
    )
  },
}

export const UnknownCount: Story = { args: { rowCount: null } }
