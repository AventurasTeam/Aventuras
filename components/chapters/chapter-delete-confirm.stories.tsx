import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { ChapterDeletePreview } from '@/lib/actions'
import { t } from '@/lib/i18n'

import { ChapterDeleteConfirm, type ChapterDeleteConfirmProps } from './chapter-delete-confirm'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }
const BLOCKED_REASON = t('generationGate.inFlight')

const COPY = {
  title: 'Delete chapter 5?',
  body: "This undoes what the chapter's close did. Its entries stay.",
  loreEdited: '2 lore rows removed, your edits included',
  lore: '2 lore rows removed',
  editsIncluded: 'your edits included',
  otherChanges: '31 other changes reversed',
  turnsSince:
    '14 turns since stay as written, and can still reflect what it added. Undoing one can bring back a value this removes.',
  closesNextSend: 'A close runs again before your next turn.',
  waits: 'A close waits until the chapter grows past the threshold.',
  staysOpen: 'The chapter stays open until you close it.',
  divider: 'Removing only the divider closes the same prose again, on top of the kept work.',
  irreversible: 'This cannot be undone.',
  cancel: 'Cancel',
  removeDivider: 'Remove divider only',
  confirm: 'Delete chapter',
}
const LORE_LINE = /lore rows? removed/
const OTHER_LINE = /other changes? reversed/
const TURNS_LINE = /turns? since/

// chapter-timeline.md → Delete a chapter's sketch.
const PREVIEW: ChapterDeletePreview = {
  chapterNumber: 5,
  createdLore: { count: 2, userEdited: true },
  otherChanges: 31,
  turnsSince: 14,
  after: 'closes-next-send',
}

function findDialog() {
  return screen.findByRole('alertdialog', { name: COPY.title }, WAIT)
}

async function expectDescription(
  dialog: HTMLElement,
  present: readonly string[],
  absent: readonly (string | RegExp)[] = [],
) {
  for (const line of present)
    await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(line))
  for (const line of absent)
    await expect(dialog).not.toHaveAccessibleDescription(
      typeof line === 'string' ? expect.stringContaining(line) : line,
    )
}

const meta: Meta<typeof ChapterDeleteConfirm> = {
  title: 'Compounds/Chapters/ChapterDeleteConfirm',
  component: ChapterDeleteConfirm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { open: true, preview: PREVIEW, onOpenChange: fn(), onDelete: fn() },
}

export default meta
type Story = StoryObj<typeof meta>

/** Auto-close on, and the region at the threshold once the entries rejoin it. */
export const ClosesNextSend: Story = {
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [
      COPY.body,
      COPY.loreEdited,
      COPY.otherChanges,
      COPY.turnsSince,
      COPY.closesNextSend,
      COPY.divider,
      COPY.irreversible,
    ])
    // The order: lore, other changes, turns since.
    const description = dialog.getAttribute('aria-describedby')
    const text = document.getElementById(description ?? '')?.textContent ?? ''
    expect(text.indexOf(COPY.loreEdited)).toBeLessThan(text.indexOf(COPY.otherChanges))
    expect(text.indexOf(COPY.otherChanges)).toBeLessThan(text.indexOf(COPY.turnsSince))
  },
}

export const Waits: Story = {
  args: { preview: { ...PREVIEW, after: 'waits' } },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(
      dialog,
      [COPY.waits],
      [COPY.closesNextSend, COPY.staysOpen, COPY.divider],
    )
  },
}

export const StaysOpen: Story = {
  args: { preview: { ...PREVIEW, after: 'stays-open' } },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(
      dialog,
      [COPY.staysOpen],
      [COPY.closesNextSend, COPY.waits, COPY.divider],
    )
  },
}

/** No turn followed the chapter: the third line goes. */
export const NoTurnsSince: Story = {
  args: { preview: { ...PREVIEW, turnsSince: 0 } },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [COPY.loreEdited, COPY.otherChanges], [TURNS_LINE])
  },
}

/** A close that landed with no agent writes: no count line shows. */
export const NoCountLines: Story = {
  args: {
    preview: {
      ...PREVIEW,
      createdLore: { count: 0, userEdited: false },
      otherChanges: 0,
      turnsSince: 3,
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(
      dialog,
      [
        '3 turns since stay as written, and can still reflect what it added. Undoing one can bring back a value this removes.',
      ],
      [LORE_LINE, OTHER_LINE],
    )
  },
}

export const NoUserEdits: Story = {
  args: { preview: { ...PREVIEW, createdLore: { count: 2, userEdited: false } } },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [COPY.lore], [COPY.editsIncluded])
  },
}

export const SingleOfEach: Story = {
  args: {
    preview: {
      ...PREVIEW,
      createdLore: { count: 1, userEdited: true },
      otherChanges: 1,
      turnsSince: 1,
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [
      '1 lore row removed, your edits included',
      '1 other change reversed',
      '1 turn since stays as written, and can still reflect what it added. Undoing one can bring back a value this removes.',
    ])
  },
}

export const ButtonsFireTheirModes: Story = {
  play: async ({ args }) => {
    await findDialog()
    await userEvent.click(screen.getByRole('button', { name: COPY.confirm }))
    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith('whole'), WAIT)
    await userEvent.click(screen.getByRole('button', { name: COPY.removeDivider }))
    await waitFor(() => expect(args.onDelete).toHaveBeenLastCalledWith('divider-only'), WAIT)
    expect(args.onDelete).toHaveBeenCalledTimes(2)
    // Neither asks to close: the owner closes the confirm on the removal's result.
    expect(args.onOpenChange).not.toHaveBeenCalled()
  },
}

export const CancelDismisses: Story = {
  play: async ({ args }) => {
    await findDialog()
    await userEvent.click(screen.getByRole('button', { name: COPY.cancel }))
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false), WAIT)
    expect(args.onDelete).not.toHaveBeenCalled()
  },
}

/** A run holds the gate: both actions disable with its reason; Cancel stays live. */
export const Blocked: Story = {
  args: { blockedReason: BLOCKED_REASON },
  play: async ({ args }) => {
    await findDialog()
    for (const name of [COPY.removeDivider, COPY.confirm]) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)
    }
    expect(screen.getByRole('button', { name: COPY.cancel })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(args.onDelete).not.toHaveBeenCalled()
  },
}

/** A removal is running: every button waits for its result. */
export const Pending: Story = {
  args: { pending: true },
  play: async ({ args }) => {
    await findDialog()
    for (const name of [COPY.cancel, COPY.removeDivider, COPY.confirm])
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    expect(args.onDelete).not.toHaveBeenCalled()
  },
}

/** The owner flips `pending` on the press, as `useChapterDeleteConfirm` does. */
function PendingOnDelete(props: ChapterDeleteConfirmProps) {
  const [pending, setPending] = useState(false)
  return (
    <ChapterDeleteConfirm
      {...props}
      pending={pending}
      onDelete={(mode) => {
        props.onDelete(mode)
        setPending(true)
      }}
    />
  )
}

/** The focused action disabling drops focus to the page; the dialog takes it back. */
export const FocusStaysWhenActionsDisable: Story = {
  render: (args) => <PendingOnDelete {...args} />,
  play: async ({ args }) => {
    const dialog = await findDialog()
    const confirm = screen.getByRole('button', { name: COPY.confirm })
    confirm.focus()
    await expect(confirm).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith('whole'), WAIT)
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'), WAIT)
    await waitFor(() => expect(confirm).not.toHaveFocus(), WAIT)
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
  },
}
