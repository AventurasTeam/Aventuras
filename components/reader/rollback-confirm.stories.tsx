import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen } from 'storybook/test'

import { t } from '@/lib/i18n'

import { RollbackConfirmModal } from './rollback-confirm'

const meta: Meta<typeof RollbackConfirmModal> = {
  title: 'Compounds/Reader/RollbackConfirmModal',
  component: RollbackConfirmModal,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { onOpenChange: fn(), onConfirm: fn() },
}

export default meta
type Story = StoryObj<typeof meta>

export const SingleEntryNoChapter: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: { entries: 1, chapters: 0, worldStateChanges: 3 },
  },
}

export const MultiEntryNoChapter: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: { entries: 12, chapters: 0, worldStateChanges: 23 },
  },
}

export const CrossChapter: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: { entries: 12, chapters: 1, worldStateChanges: 23 },
  },
  play: async () => {
    const dialog = await screen.findByRole('alertdialog')
    for (const line of [
      t('reader:rollbackConfirm.entries', { count: 12 }),
      t('reader:rollbackConfirm.chapters', { count: 1 }),
      t('reader:rollbackConfirm.worldState', { count: 23 }),
      t('reader:rollbackConfirm.irreversible'),
    ]) {
      await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(line))
    }
  },
}

export const CrossMultipleChapters: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: { entries: 34, chapters: 2, worldStateChanges: 58 },
  },
}

export const RegenerateCascade: Story = {
  args: {
    open: true,
    variant: 'regenerate',
    targetEntryNumber: 47,
    counts: { entries: 3, chapters: 0, worldStateChanges: 7 },
  },
}
