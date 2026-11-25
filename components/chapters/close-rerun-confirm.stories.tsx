import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { CloseRerunPreview, RollbackCounts } from '@/lib/actions'
import { t } from '@/lib/i18n'

import { CloseRerunConfirm } from './close-rerun-confirm'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }
const BLOCKED_REASON = t('generationGate.inFlight')

const COPY = {
  title: "Re-run chapter 5's close?",
  framing:
    'This reverses what the close did to the world and runs it again on gemma-4-26b. The chapter, its title and summary stay.',
  framingNoModel:
    'This reverses what the close did to the world and runs it again. The chapter, its title and summary stay.',
  loreEdited: '2 lore rows removed, your edits included',
  otherChanges: '31 other changes reversed',
  noChanges: 'The close changed nothing in the world.',
  turnsFollowed: '3 turns followed this close:',
  entries: '6 entries (91–96)',
  worldChanges: '12 world-state changes',
  rollbackWarning:
    'Roll back & re-run removes them for good, even if the re-run fails or you cancel it.',
  cost: 'A close is the costliest call the app makes: this one reads 24,310 tokens of story.',
  undoLine: 'CTRL-Z brings this close back until your next turn, edit or rollback.',
  cancel: 'Cancel',
  rerun: 'Re-run close',
  rollbackAndRerun: 'Roll back & re-run',
  rerunOnBranch: 'Re-run on new branch',
  forkSentence:
    'Re-run on new branch keeps them on Harbor watch and branches from entry 90 as "Ch. 5 re-run".',
}
const LORE_LINE = /lore rows? removed/
const OTHER_LINE = /other changes? reversed/
const TURNS_LINE = /followed this close/
const FORK_LINE = /keeps them on/

const SHORTCUT_COUNTS: RollbackCounts = {
  entries: 6,
  chapters: 0,
  worldStateChanges: 12,
  closeWrites: 0,
  reopenedChapter: null,
  removedChapters: [],
}

// chapter-timeline.md → Re-run a close's sketch.
const PREVIEW: CloseRerunPreview = {
  chapterNumber: 5,
  branchName: 'Main',
  model: 'gemma-4-26b',
  tokens: 24310,
  reversal: { createdLore: { count: 2, userEdited: true }, otherChanges: 31 },
  shortcut: {
    targetEntryId: 'ent_91',
    forkPoint: { entryId: 'ent_90', position: 90 },
    turns: 3,
    entries: { count: 6, first: 91, last: 96 },
    counts: SHORTCUT_COUNTS,
  },
}
const NO_TURNS: CloseRerunPreview = { ...PREVIEW, shortcut: null }

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

function button(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

const meta: Meta<typeof CloseRerunConfirm> = {
  title: 'Compounds/Chapters/CloseRerunConfirm',
  component: CloseRerunConfirm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    open: true,
    preview: PREVIEW,
    pending: false,
    onCancel: fn(),
    onConfirm: fn(),
    onConfirmOnBranch: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

/** Turns followed the close: their block, the fork's sentence before the warning, three buttons. */
export const TurnsFollowed: Story = {
  // Not the default branch's name, so a sentence that hard-codes it shows.
  args: { preview: { ...PREVIEW, branchName: 'Harbor watch' } },
  play: async () => {
    const dialog = await findDialog()
    const lines = [
      COPY.framing,
      COPY.loreEdited,
      COPY.otherChanges,
      COPY.turnsFollowed,
      COPY.entries,
      COPY.worldChanges,
      COPY.forkSentence,
      COPY.rollbackWarning,
      COPY.cost,
      COPY.undoLine,
    ]
    await expectDescription(dialog, lines, [COPY.noChanges])
    const describedBy = dialog.getAttribute('aria-describedby')
    const text = document.getElementById(describedBy ?? '')?.textContent ?? ''
    const order = lines.map((line) => text.indexOf(line))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The sentence names the branch by the one key the stored name and the fork's toasts read.
    expect(COPY.forkSentence).toContain(`"${t('chapters:rerunConfirm.autoName', { number: 5 })}"`)

    expect(button(COPY.cancel)).not.toHaveAttribute('aria-disabled', 'true')
    expect(button(COPY.rollbackAndRerun)).not.toHaveAttribute('aria-disabled', 'true')
    const fork = button(COPY.rerunOnBranch)
    expect(fork).not.toHaveAttribute('aria-disabled', 'true')
    expect(fork.closest('[title]')).toBeNull()
    expect(screen.queryByRole('button', { name: COPY.rerun })).toBeNull()
  },
}

/** A system entry stands just before the turns since: the sentence names N below it, not B − 1. */
export const ForkPointBelowSystemEntry: Story = {
  args: {
    preview: {
      ...PREVIEW,
      shortcut: { ...PREVIEW.shortcut!, forkPoint: { entryId: 'ent_89', position: 89 } },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [
      'Re-run on new branch keeps them on Main and branches from entry 89 as "Ch. 5 re-run".',
    ])
  },
}

/** No turn followed: no block, and `Cancel` and `Re-run close`. */
export const NoTurnsSince: Story = {
  args: { preview: NO_TURNS },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(
      dialog,
      [COPY.framing, COPY.loreEdited, COPY.otherChanges, COPY.cost, COPY.undoLine],
      [TURNS_LINE, FORK_LINE, COPY.rollbackWarning],
    )
    expect(button(COPY.cancel)).toBeInTheDocument()
    expect(button(COPY.rerun)).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: COPY.rollbackAndRerun })).toBeNull()
    expect(screen.queryByRole('button', { name: COPY.rerunOnBranch })).toBeNull()
  },
}

/** A close that changed nothing: one line in place of the counts. */
export const ChangedNothing: Story = {
  args: {
    preview: {
      ...NO_TURNS,
      reversal: { createdLore: { count: 0, userEdited: false }, otherChanges: 0 },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [COPY.noChanges], [LORE_LINE, OTHER_LINE])
  },
}

/** `lore-mgmt` resolves to no model: the framing names none. */
export const NoModel: Story = {
  args: { preview: { ...NO_TURNS, model: null } },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [COPY.framingNoModel], ['runs it again on'])
  },
}

export const SingleOfEach: Story = {
  args: {
    preview: {
      ...PREVIEW,
      tokens: 1,
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: {
        targetEntryId: 'ent_91',
        forkPoint: { entryId: 'ent_90', position: 90 },
        turns: 1,
        entries: { count: 1, first: 91, last: 91 },
        counts: { ...SHORTCUT_COUNTS, entries: 1, worldStateChanges: 1 },
      },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await expectDescription(dialog, [
      '1 lore row removed',
      '1 other change reversed',
      '1 turn followed this close:',
      '1 entry (91)',
      '1 world-state change',
      'this one reads 1 token of story.',
    ])
  },
}

export const RerunFiresConfirm: Story = {
  args: { preview: NO_TURNS },
  play: async ({ args }) => {
    await findDialog()
    await userEvent.click(button(COPY.rerun))
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

/** Each of the two confirm actions fires its own handler. */
export const RollbackAndRerunFiresConfirm: Story = {
  play: async ({ args }) => {
    await findDialog()
    await userEvent.click(button(COPY.rerunOnBranch))
    await waitFor(() => expect(args.onConfirmOnBranch).toHaveBeenCalledTimes(1), WAIT)
    // The preview it showed, which the fork reads its expected counts from.
    expect(args.onConfirmOnBranch).toHaveBeenCalledWith(PREVIEW)
    expect(args.onConfirm).not.toHaveBeenCalled()

    await userEvent.click(button(COPY.rollbackAndRerun))
    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onConfirmOnBranch).toHaveBeenCalledTimes(1)
    expect(args.onCancel).not.toHaveBeenCalled()
  },
}

export const CancelFiresCancel: Story = {
  play: async ({ args }) => {
    await findDialog()
    await userEvent.click(button(COPY.cancel))
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** alert-dialog.md → Copy contract: Esc is Cancel. */
export const EscapeCancels: Story = {
  play: async ({ args }) => {
    await findDialog()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** A run holds the gate: `Re-run close` disables with its reason; Cancel stays live. */
export const Blocked: Story = {
  args: { preview: NO_TURNS, blockedReason: BLOCKED_REASON },
  play: async ({ args }) => {
    await findDialog()
    const rerun = button(COPY.rerun)
    // Past user-event's pointer-events check, so only the disabled wiring stops the press.
    await userEvent.click(rerun, { pointerEventsCheck: 0 })
    expect(args.onConfirm).not.toHaveBeenCalled()
    expect(rerun).toHaveAttribute('aria-disabled', 'true')
    expect(rerun.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)
    expect(button(COPY.cancel)).not.toHaveAttribute('aria-disabled', 'true')
  },
}

/** Blocked with turns since: both confirm actions take the gate's reason and fire nothing. */
export const BlockedWithTurns: Story = {
  args: { blockedReason: BLOCKED_REASON },
  play: async ({ args }) => {
    await findDialog()
    for (const name of [COPY.rollbackAndRerun, COPY.rerunOnBranch]) {
      const action = button(name)
      await userEvent.click(action, { pointerEventsCheck: 0 })
      expect(action).toHaveAttribute('aria-disabled', 'true')
      expect(action.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)
    }
    expect(args.onConfirm).not.toHaveBeenCalled()
    expect(args.onConfirmOnBranch).not.toHaveBeenCalled()
  },
}

/** A start or a fork is in flight: every button waits for its result. */
export const Pending: Story = {
  args: { pending: true },
  play: async ({ args }) => {
    await findDialog()
    const buttons = [COPY.cancel, COPY.rollbackAndRerun, COPY.rerunOnBranch].map(button)
    for (const each of buttons) await userEvent.click(each, { pointerEventsCheck: 0 })
    // Esc asks the dialog to close; a start in flight keeps it where it is.
    await userEvent.keyboard('{Escape}')
    expect(args.onConfirm).not.toHaveBeenCalled()
    expect(args.onConfirmOnBranch).not.toHaveBeenCalled()
    expect(args.onCancel).not.toHaveBeenCalled()
    for (const each of buttons) expect(each).toHaveAttribute('aria-disabled', 'true')
  },
}

/** The start trips the gate it runs under, so a reason would read as some other run. */
export const PendingHidesBlockedReason: Story = {
  args: { preview: NO_TURNS, pending: true, blockedReason: BLOCKED_REASON },
  play: async () => {
    await findDialog()
    const rerun = button(COPY.rerun)
    expect(rerun).toHaveAttribute('aria-disabled', 'true')
    expect(rerun.closest('[title]')).toBeNull()
  },
}

const PHONE = { viewport: { value: 'phone390' } }

// The footer's buttons and the title, whose box spans the dialog's content width.
async function footerLayout(names: readonly string[]) {
  const dialog = await findDialog()
  await waitFor(() => expect(dialog).toBeVisible(), WAIT)
  const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
  if (title == null) throw new Error("the confirm's title is not rendered")
  const content = title.getBoundingClientRect()
  return { content, rects: names.map((name) => button(name).getBoundingClientRect()) }
}

/** Above phone the footer is one row at the dialog's right, each button sized to its label. */
export const FooterRow: Story = {
  play: async () => {
    const { content, rects } = await footerLayout([
      COPY.cancel,
      COPY.rollbackAndRerun,
      COPY.rerunOnBranch,
    ])
    for (const rect of rects) expect(Math.abs(rect.top - rects[0]!.top)).toBeLessThan(1)
    expect(Math.abs(Math.max(...rects.map((r) => r.right)) - content.right)).toBeLessThan(1)
    // Buttons grown to fill the row would start at the content's left edge.
    expect(Math.min(...rects.map((r) => r.left))).toBeGreaterThan(content.left + 1)
  },
}

/** Phone: the footer stacks, each button the dialog's full width. */
export const Phone390FooterStack: Story = {
  globals: PHONE,
  play: async () => {
    const { content, rects } = await footerLayout([
      COPY.cancel,
      COPY.rollbackAndRerun,
      COPY.rerunOnBranch,
    ])
    for (const rect of rects) {
      expect(Math.abs(rect.left - content.left)).toBeLessThan(1)
      expect(Math.abs(rect.width - content.width)).toBeLessThan(1)
    }
    const tops = rects.map((r) => r.top)
    expect(new Set(tops).size).toBe(3)
  },
}
