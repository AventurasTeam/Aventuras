import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useSyncExternalStore } from 'react'
import { expect, fn, screen, waitFor } from 'storybook/test'

import { externalCell } from '@/components/story-settings/external-cell'
import type { RollbackCounts } from '@/lib/actions'

import { RollbackConfirmModal, type RollbackConfirmModalProps } from './rollback-confirm'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }

const COPY = {
  rollbackTitle: 'Delete from entry 47?',
  regenerateTitle: 'Regenerate from entry 47?',
  rollbackBody: 'This rolls the story back to before entry 47. The following are removed:',
  cascadeBody:
    'This discards entry 47 and everything after it, then generates a new reply from your last action. The following are removed:',
  closeBody:
    'This discards entry 47 and reverses the chapter close that ends on it, then generates a new reply from your last action. The following are removed:',
  keptWorkBody:
    "This discards entry 47 and the work a removed chapter's close left on it, then generates a new reply from your last action. No close brings that work back. The following are removed:",
  closeReturns: 'Chapter 5 will return to in-progress.',
  closeRunsAgain: 'Its close runs again only when one is next due, or when you start it.',
  rollbackIrreversible: 'This cannot be undone.',
  regenerateIrreversible: "Discarded entries can't be brought back.",
}
const REOPENED_LINE = /chapter re-opened/
const REMOVED_LINE = /chapters? removed/

function counts(
  fields: Partial<RollbackCounts> & Pick<RollbackCounts, 'entries' | 'worldStateChanges'>,
): RollbackCounts {
  return { chapters: 0, closeWrites: 0, reopenedChapter: null, removedChapters: [], ...fields }
}

function findDialog(name: string) {
  return screen.findByRole('alertdialog', { name }, WAIT)
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
    counts: counts({ entries: 1, worldStateChanges: 3 }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.rollbackTitle)
    await expectDescription(
      dialog,
      [COPY.rollbackBody, '1 entry', '3 world-state changes', COPY.rollbackIrreversible],
      [REOPENED_LINE, REMOVED_LINE],
    )
  },
}

export const MultiEntryNoChapter: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: counts({ entries: 12, worldStateChanges: 23 }),
  },
}

/** The target falls inside chapter 5, so its earlier entries stay. */
export const ReopenedOnly: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: counts({
      entries: 12,
      chapters: 1,
      worldStateChanges: 23,
      closeWrites: 9,
      reopenedChapter: 5,
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.rollbackTitle)
    await expectDescription(
      dialog,
      [
        '12 entries',
        '1 chapter re-opened — chapter 5 will return to in-progress',
        '23 world-state changes',
      ],
      [REMOVED_LINE],
    )
  },
}

/** The target is chapter 5's first entry, so every entry of it goes. */
export const RemovedOnly: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: counts({
      entries: 12,
      chapters: 1,
      worldStateChanges: 23,
      closeWrites: 9,
      removedChapters: [5],
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.rollbackTitle)
    await expectDescription(
      dialog,
      ['1 chapter removed — chapter 5 goes with its entries'],
      [REOPENED_LINE],
    )
  },
}

export const ReopenedAndRemoved: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: counts({
      entries: 34,
      chapters: 3,
      worldStateChanges: 58,
      closeWrites: 20,
      reopenedChapter: 4,
      removedChapters: [5, 6],
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.rollbackTitle)
    await expectDescription(dialog, [
      '1 chapter re-opened — chapter 4 will return to in-progress',
      '2 chapters removed — chapters 5 and 6 go with their entries',
    ])
  },
}

export const ThreeRemoved: Story = {
  args: {
    open: true,
    targetEntryNumber: 47,
    counts: counts({
      entries: 58,
      chapters: 3,
      worldStateChanges: 80,
      closeWrites: 27,
      removedChapters: [5, 6, 7],
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.rollbackTitle)
    await expectDescription(
      dialog,
      ['3 chapters removed — chapters 5–7 go with their entries'],
      [REOPENED_LINE],
    )
  },
}

/** An older reply with a close in its cascade: the cascade copy, with rollback's chapter lines. */
export const RegenerateCascade: Story = {
  args: {
    open: true,
    variant: 'regenerate',
    targetEntryNumber: 47,
    counts: counts({
      entries: 3,
      chapters: 1,
      worldStateChanges: 7,
      closeWrites: 4,
      removedChapters: [5],
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.regenerateTitle)
    await expectDescription(
      dialog,
      [
        COPY.cascadeBody,
        '3 entries',
        '1 chapter removed — chapter 5 goes with its entries',
        '7 world-state changes',
        COPY.regenerateIrreversible,
      ],
      [COPY.closeReturns, COPY.closeRunsAgain],
    )
  },
}

/** A committed close ends on the reply: the chapter returns to in-progress. */
export const RegenerateClose: Story = {
  args: {
    open: true,
    variant: 'regenerate',
    targetEntryNumber: 47,
    counts: counts({
      entries: 1,
      chapters: 1,
      worldStateChanges: 4,
      closeWrites: 9,
      reopenedChapter: 5,
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.regenerateTitle)
    await expectDescription(
      dialog,
      [
        COPY.closeBody,
        '1 entry',
        '4 world-state changes',
        COPY.closeReturns,
        COPY.closeRunsAgain,
        COPY.regenerateIrreversible,
      ],
      [COPY.cascadeBody, REOPENED_LINE, REMOVED_LINE],
    )
  },
}

/** The close's chapter starts on the reply, so it goes whole and the line names it. */
export const RegenerateCloseRemoved: Story = {
  args: {
    open: true,
    variant: 'regenerate',
    targetEntryNumber: 47,
    counts: counts({
      entries: 1,
      chapters: 1,
      worldStateChanges: 4,
      closeWrites: 9,
      removedChapters: [5],
    }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.regenerateTitle)
    await expectDescription(
      dialog,
      [COPY.closeBody, COPY.closeReturns, COPY.closeRunsAgain, COPY.regenerateIrreversible],
      [COPY.cascadeBody, REOPENED_LINE, REMOVED_LINE],
    )
  },
}

/** Only a removed chapter's kept work is left on the reply, and no close brings it back. */
export const RegenerateKeptWork: Story = {
  args: {
    open: true,
    variant: 'regenerate',
    targetEntryNumber: 47,
    counts: counts({ entries: 1, worldStateChanges: 4, closeWrites: 4 }),
  },
  play: async () => {
    const dialog = await findDialog(COPY.regenerateTitle)
    await expectDescription(
      dialog,
      [COPY.keptWorkBody, '1 entry', '4 world-state changes', COPY.regenerateIrreversible],
      [COPY.closeReturns, COPY.closeRunsAgain, REOPENED_LINE, REMOVED_LINE],
    )
  },
}

const CASCADE = counts({ entries: 3, worldStateChanges: 7 })
const CLOSED = counts({
  entries: 1,
  chapters: 1,
  worldStateChanges: 4,
  closeWrites: 9,
  reopenedChapter: 5,
})
const TERMINAL = counts({ entries: 1, worldStateChanges: 2 })
const recount = externalCell<RollbackCounts>(CASCADE)

// The reader's host: a recount swaps the counts in and leaves the confirm's mode alone.
function RecountHarness(props: Pick<RollbackConfirmModalProps, 'onOpenChange' | 'onConfirm'>) {
  const shown = useSyncExternalStore(recount.subscribe, recount.get)
  return (
    <RollbackConfirmModal
      {...props}
      open
      variant="regenerate"
      targetEntryNumber={47}
      counts={shown}
    />
  )
}

/** The copy follows the counts, not the confirm's mode: a recount flips it. */
export const RegenerateRecount: Story = {
  args: { open: true, variant: 'regenerate', targetEntryNumber: 47, counts: CASCADE },
  render: (args) => <RecountHarness onOpenChange={args.onOpenChange} onConfirm={args.onConfirm} />,
  play: async () => {
    recount.set(CASCADE)
    const dialog = await findDialog(COPY.regenerateTitle)
    await waitFor(
      () => expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.cascadeBody)),
      WAIT,
    )

    recount.set(CLOSED)
    await waitFor(
      () => expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.closeBody)),
      WAIT,
    )
    await expectDescription(dialog, [COPY.closeReturns, COPY.closeRunsAgain])

    // Counts that would fire a tap with no confirm keep the open confirm on the cascade copy.
    recount.set(TERMINAL)
    await waitFor(
      () => expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.cascadeBody)),
      WAIT,
    )
    await expectDescription(dialog, [], [COPY.closeReturns])
  },
}
