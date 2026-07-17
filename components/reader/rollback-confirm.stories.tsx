import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { fn } from 'storybook/test'

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
}

export const CrossMultipleChapters: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: { entries: 34, chapters: 2, worldStateChanges: 58 },
  },
}
