import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { DuplicateStoryDialog, type DuplicateBranchOption } from './duplicate-story-dialog'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }
const PHONE = { viewport: { value: 'phone390' } }

const MAIN: DuplicateBranchOption = { id: 'br_main', name: 'main' }
const FORK: DuplicateBranchOption = { id: 'br_fork', name: 'The road not taken' }
const SIDE: DuplicateBranchOption = { id: 'br_side', name: 'side' }

// Written out, so a changed locale string fails here rather than passing through t().
const COPY = {
  title: 'Duplicate story',
  name: 'Name',
  branch: 'Branch',
  prefilled: 'Aria’s Descent (copy)',
  currentOption: 'The road not taken · current',
  allBranches: 'All branches (3)',
  cancel: 'Cancel',
  close: 'Close',
  failed: "Couldn't duplicate the story.",
  swapPending: 'An embedding model change is pending on this story.',
  unrecovered: "A branch being copied has an interrupted update the app hasn't recovered.",
  running: 'A run is still going on this story.',
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const findDialog = () => screen.findByRole('dialog', { name: COPY.title }, WAIT)
const button = (name: string) => screen.getByRole('button', { name })
// A pattern: while copying, the button also holds the spinner's progressbar.
const confirm = () => screen.getByRole('button', { name: /Duplicate/ })

/** The name field once it holds focus with its text selected: typing then replaces the name. */
async function nameField(): Promise<HTMLInputElement> {
  const field = (await screen.findByRole('textbox', { name: COPY.name }, WAIT)) as HTMLInputElement
  // selectTextOnFocus selects a tick after focus; typing before it would append.
  await waitFor(() => {
    expect(field).toHaveFocus()
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
  }, WAIT)
  return field
}

// About 360 px from the sm breakpoint up: the field spans the panel inside its 24 px padding.
function expectAbout360(field: HTMLElement) {
  const { width } = field.getBoundingClientRect()
  expect(width).toBeGreaterThanOrEqual(300)
  expect(width).toBeLessThanOrEqual(320)
}

function expectInViewport(element: HTMLElement) {
  const box = element.getBoundingClientRect()
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth)
}

async function pickBranch(name: string) {
  await userEvent.click(button(COPY.branch))
  await userEvent.click(await screen.findByRole('option', { name }, WAIT))
  await waitFor(() => expect(screen.queryByRole('option')).toBeNull(), WAIT)
}

const meta = {
  title: 'Compounds/Story/DuplicateStoryDialog',
  component: DuplicateStoryDialog,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    onOpenChange: fn(),
    sourceTitle: 'Aria’s Descent',
    branches: [MAIN, FORK, SIDE],
    currentBranchId: FORK.id,
    state: { kind: 'ready' },
    onBranchChange: fn(),
    onDuplicate: fn(),
  },
} satisfies Meta<typeof DuplicateStoryDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Several branches: the name selected to type over, the current branch first and marked. */
export const SeveralBranches: Story = {
  play: async ({ args }) => {
    await findDialog()
    const field = await nameField()
    await expect(field).toHaveValue(COPY.prefilled)
    expectAbout360(field)
    const select = button(COPY.branch)
    await expect(select).toHaveTextContent(COPY.currentOption)
    await userEvent.click(select)
    const options = await screen.findAllByRole('option', {}, WAIT)
    expect(options.map((option) => option.textContent)).toEqual([
      COPY.currentOption,
      'main',
      'side',
      COPY.allBranches,
    ])
    await userEvent.click(options[1])
    await waitFor(
      () => expect(args.onBranchChange).toHaveBeenCalledWith({ branchId: MAIN.id }),
      WAIT,
    )
    await expect(button(COPY.branch)).toHaveTextContent('main')
    expect(args.onDuplicate).not.toHaveBeenCalled()
  },
}

/** Enter in the name duplicates the current branch under the typed name, and keeps focus. */
export const EnterDuplicates: Story = {
  play: async ({ args }) => {
    const field = await nameField()
    await userEvent.keyboard('  Ashes of Aria  {Enter}')
    await waitFor(() => expect(args.onDuplicate).toHaveBeenCalledTimes(1), WAIT)
    // The raw name: the action trims it.
    expect(args.onDuplicate).toHaveBeenCalledWith({
      title: '  Ashes of Aria  ',
      branch: { branchId: FORK.id },
    })
    await expect(field).toHaveFocus()
  },
}

/** `All branches (N)` copies the whole tree. */
export const AllBranches: Story = {
  play: async ({ args }) => {
    await nameField()
    await pickBranch(COPY.allBranches)
    expect(args.onBranchChange).toHaveBeenCalledWith('all')
    await userEvent.click(confirm())
    await waitFor(
      () => expect(args.onDuplicate).toHaveBeenCalledWith({ title: COPY.prefilled, branch: 'all' }),
      WAIT,
    )
  },
}

/** One branch: no Select, and the copy takes that branch. */
export const OneBranch: Story = {
  args: { branches: [MAIN], currentBranchId: MAIN.id },
  play: async ({ args }) => {
    await nameField()
    expect(screen.queryByRole('button', { name: COPY.branch })).toBeNull()
    expect(screen.queryByText(COPY.branch)).toBeNull()
    await userEvent.click(confirm())
    await waitFor(
      () =>
        expect(args.onDuplicate).toHaveBeenCalledWith({
          title: COPY.prefilled,
          branch: { branchId: MAIN.id },
        }),
      WAIT,
    )
  },
}

/** A blank or whitespace name disables `Duplicate`; Enter then does nothing and keeps focus. */
export const EmptyName: Story = {
  play: async ({ args }) => {
    const field = await nameField()
    await userEvent.clear(field)
    await waitFor(() => expect(confirm()).toHaveAttribute('aria-disabled', 'true'), WAIT)
    await userEvent.keyboard('   {Enter}')
    await expect(confirm()).toHaveAttribute('aria-disabled', 'true')
    await pause(50)
    await expect(field).toHaveFocus()
    expect(args.onDuplicate).not.toHaveBeenCalled()
    await userEvent.keyboard('A')
    await waitFor(() => expect(confirm()).not.toHaveAttribute('aria-disabled', 'true'), WAIT)
  },
}

/** An IME's confirming Enter can arrive with isComposing false and keyCode 229. */
export const ImeEnterDuplicatesNothing: Story = {
  play: async ({ args }) => {
    const field = await nameField()
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 229,
        isComposing: false,
        bubbles: true,
        cancelable: true,
      }),
    )
    await pause(50)
    expect(args.onDuplicate).not.toHaveBeenCalled()
    await expect(field).toHaveFocus()
  },
}

/** The refusal check is in flight: only `Duplicate` waits, and Esc still cancels. */
export const Checking: Story = {
  args: { state: { kind: 'checking' } },
  play: async ({ args }) => {
    const field = await nameField()
    await expect(confirm()).toHaveAttribute('aria-disabled', 'true')
    await expect(button(COPY.cancel)).not.toHaveAttribute('aria-disabled', 'true')
    await expect(button(COPY.branch)).not.toHaveAttribute('aria-disabled', 'true')
    await expect(field).not.toHaveAttribute('readonly')
    await userEvent.keyboard('{Enter}')
    await pause(50)
    expect(args.onDuplicate).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false), WAIT)
  },
}

function refusedPlay(line: string): Story['play'] {
  return async ({ args }) => {
    const field = await nameField()
    // The dialog fades in from opacity 0.
    await waitFor(() => expect(screen.getByText(line)).toBeVisible(), WAIT)
    // The width holds with the line in: the dialog doesn't resize per state.
    expectAbout360(field)
    const action = confirm()
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(action.closest('[title]')).toHaveAttribute('title', line)
    // The Select stays live: its refusals judge the branches it picks.
    await expect(button(COPY.branch)).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(action, { pointerEventsCheck: 0 })
    expect(args.onDuplicate).not.toHaveBeenCalled()
  }
}

export const SwapPending: Story = {
  args: { state: { kind: 'refused', reason: t('landing:duplicate.refused.swapPending') } },
  play: refusedPlay(COPY.swapPending),
}

export const Unrecovered: Story = {
  args: { state: { kind: 'refused', reason: t('landing:duplicate.refused.unrecovered') } },
  play: refusedPlay(COPY.unrecovered),
}

export const Running: Story = {
  args: { state: { kind: 'refused', reason: t('landing:duplicate.refused.running') } },
  play: refusedPlay(COPY.running),
}

/** The copy is one transaction: everything waits, and Esc, Cancel and × don't close. */
export const Copying: Story = {
  args: { state: { kind: 'copying' } },
  play: async ({ args }) => {
    await findDialog()
    await expect(await screen.findByRole('textbox', { name: COPY.name })).toHaveAttribute(
      'readonly',
    )
    await expect(button(COPY.branch)).toHaveAttribute('aria-disabled', 'true')
    await expect(button(COPY.cancel)).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm()).toHaveAttribute('aria-disabled', 'true')
    await expect(confirm()).toHaveAttribute('aria-busy', 'true')
    await expect(button(COPY.close)).toHaveAttribute('aria-disabled', 'true')
    // Past user-event's pointer check, so only the disabled wiring and the close guard stop these.
    await userEvent.keyboard('{Escape}')
    await userEvent.click(button(COPY.cancel), { pointerEventsCheck: 0 })
    await userEvent.click(button(COPY.close), { pointerEventsCheck: 0 })
    await pause(50)
    expect(args.onOpenChange).not.toHaveBeenCalled()
    expect(args.onDuplicate).not.toHaveBeenCalled()
    await expect(screen.getByRole('dialog', { name: COPY.title })).toBeInTheDocument()
  },
}

/** Nothing was written: the line shows, and both actions stay live for a retry or a cancel. */
export const Failed: Story = {
  args: { state: { kind: 'failed' } },
  play: async ({ args }) => {
    await nameField()
    await waitFor(() => expect(screen.getByText(COPY.failed)).toBeVisible(), WAIT)
    await expect(confirm()).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(confirm())
    await waitFor(
      () =>
        expect(args.onDuplicate).toHaveBeenCalledWith({
          title: COPY.prefilled,
          branch: { branchId: FORK.id },
        }),
      WAIT,
    )
    await userEvent.click(button(COPY.cancel))
    expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** Phone width: every control stays on screen. */
export const PhoneSeveralBranches: Story = {
  globals: PHONE,
  play: async () => {
    await findDialog()
    const field = await nameField()
    for (const element of [field, button(COPY.branch), button(COPY.cancel), confirm()])
      expectInViewport(element)
  },
}

export const PhoneCopying: Story = {
  globals: PHONE,
  args: { state: { kind: 'copying' } },
  play: async ({ args }) => {
    await findDialog()
    for (const element of [button(COPY.cancel), confirm()]) expectInViewport(element)
    await userEvent.keyboard('{Escape}')
    await pause(50)
    expect(args.onOpenChange).not.toHaveBeenCalled()
  },
}
