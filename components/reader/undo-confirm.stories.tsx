import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { UndoConfirm } from './undo-confirm'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }

const meta = {
  title: 'Compounds/Reader/UndoConfirm',
  component: UndoConfirm,
  args: {
    open: true,
    title: "Undo chapter 3's close?",
    lines: ['2 lore rows removed, your edits included', '4 other changes reversed'],
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof UndoConfirm>

export default meta
type Story = StoryObj<typeof meta>

/** A close's undo: the chapter delete confirm's impact lines. */
export const CloseImpact: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByRole('alertdialog', { name: args.title }, WAIT)
    expect(dialog).toHaveTextContent('• 2 lore rows removed, your edits included')
    expect(dialog).toHaveTextContent('• 4 other changes reversed')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledOnce(), WAIT)
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

/** Another unseen target: up to five rows as History names them, then the count of the rest. */
export const HistoryRows: Story = {
  args: {
    title: 'Undo your changes to Tobin and 3 more?',
    lines: [
      'Tobin: Modified Description',
      'Tobin · Awareness · The night crossing: Created',
      'The toll: Created',
      'and 1 more',
    ],
  },
  play: async ({ args }) => {
    const dialog = await screen.findByRole('alertdialog', { name: args.title }, WAIT)
    expect(dialog).toHaveTextContent('• Tobin: Modified Description')
    expect(dialog).toHaveTextContent('• and 1 more')
  },
}

/** Esc is Cancel: nothing undone. */
export const EscapeCancels: Story = {
  play: async ({ args }) => {
    await screen.findByRole('alertdialog', { name: args.title }, WAIT)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledOnce(), WAIT)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}
