import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'

import {
  BranchNavigator,
  type BranchNavigatorHandle,
  type BranchNavigatorProps,
  type BranchNavigatorRow,
} from './branch-navigator'

const TABLET = { viewport: { value: 'tablet' } }
const PHONE = { viewport: { value: 'mobile1' } }
// CI runs plays several times slower than local.
const ANIMATION = { timeout: 3000 }

/** In `created_at` order. */
const ROWS: BranchNavigatorRow[] = [
  { id: 'br_main', name: 'Main' },
  { id: 'br_road', name: 'The road not taken' },
  { id: 'br_trap', name: 'The trap' },
]

const LONG_NAME =
  'The long way round through the drowned quarter, past the bell tower and the salt market'

const LONG_LIST: BranchNavigatorRow[] = Array.from({ length: 30 }, (_, i) => ({
  id: `br_${i + 1}`,
  name: `Branch ${i + 1}`,
}))

function TierMark() {
  return <Text testID="tier">{useTier()}</Text>
}

// gorhom's container fills this stage, so a detent is a share of the stage's height.
function Stage({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions()
  return (
    <View style={{ height, padding: 16, gap: 8, alignItems: 'flex-start' }}>
      <TierMark />
      {children}
    </View>
  )
}

async function waitForTier(tier: 'desktop' | 'tablet' | 'phone') {
  await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent(tier))
}

const navigator = (name: string) => screen.getByRole('dialog', { name })
const queryNavigator = (name: string) => screen.queryByRole('dialog', { name })
const list = () => screen.findByTestId('branch-navigator-list')

async function rowNames() {
  return within(await list())
    .getAllByTestId('branch-navigator-row')
    .map((row) => row.textContent)
}

async function openFromChip(chipName = 'On The trap · 3 branches', title = 'Branches · 3') {
  await userEvent.click(await screen.findByRole('button', { name: chipName }))
  await waitFor(() => expect(navigator(title)).toBeVisible(), ANIMATION)
}

// gorhom's content keeps rising after it turns visible; a press below the window makes the
// browser scroll the container and lift the Sheet.
async function waitForSheetSettled(title: string) {
  let last = Number.NaN
  let still = 0
  await waitFor(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const top = navigator(title).getBoundingClientRect().top
    still = Math.abs(top - last) < 0.5 ? still + 1 : 0
    last = top
    expect(still).toBeGreaterThanOrEqual(5)
  }, ANIMATION)
}

/** The rename field once it holds focus with its text selected: typing then replaces the name. */
async function renameField() {
  const field = (await screen.findByRole('textbox', { name: 'Branch name' })) as HTMLInputElement
  await waitFor(() => {
    expect(field).toHaveFocus()
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
  })
  return field
}

function expectClosedBeforeCalled(onOpenChange: unknown, callback: unknown) {
  const opens = onOpenChange as ReturnType<typeof fn>
  const closedAt = opens.mock.calls.findIndex(([open]) => open === false)
  expect(closedAt).toBeGreaterThanOrEqual(0)
  const called = (callback as ReturnType<typeof fn>).mock.invocationCallOrder[0]
  expect(opens.mock.invocationCallOrder[closedAt]).toBeLessThan(called)
}

// gorhom's indicator: a 4 px bar just above the Sheet's content (layout.md → Sheet behavior).
function dragHandleAbove(content: HTMLElement): HTMLElement | undefined {
  const top = content.getBoundingClientRect().top
  return Array.from(document.querySelectorAll<HTMLElement>('div')).find((element) => {
    const rect = element.getBoundingClientRect()
    return rect.height === 4 && rect.width > 0 && rect.bottom <= top + 1 && rect.top >= top - 32
  })
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Keys, not buttons: a click outside the Popover would dismiss it before the handle's call.
function HandleHarness(props: BranchNavigatorProps) {
  const handle = useRef<BranchNavigatorHandle>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') handle.current?.open()
      if (event.key === 'F3') handle.current?.close()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return <BranchNavigator {...props} ref={handle} />
}

// F4 stands in for the gate opening while the navigator is open.
function PauseLiftsHarness(props: BranchNavigatorProps) {
  const [paused, setPaused] = useState(true)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F4') setPaused(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return <BranchNavigator {...props} paused={paused} />
}

const meta: Meta<typeof BranchNavigator> = {
  title: 'Compounds/Reader/BranchNavigator',
  component: BranchNavigator,
  parameters: { layout: 'fullscreen' },
  args: {
    rows: ROWS,
    currentBranchId: 'br_trap',
    chip: { count: 3, currentName: 'The trap' },
    paused: false,
    onSwitch: fn(),
    onRename: fn(() => Promise.resolve()),
    onOpenChange: fn(),
  },
  decorators: [
    (Story) => (
      <Stage>
        <Story />
      </Stage>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof BranchNavigator>

export const Desktop: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await expect(screen.getByText('Branches · 3')).toBeVisible()
    // The current branch first, the rest in the order given.
    await expect(await rowNames()).toEqual(['The trap', 'Main', 'The road not taken'])
    const rows = within(await list()).getAllByTestId('branch-navigator-row')
    await expect(within(rows[0]).getByRole('img', { name: 'Current branch' })).toBeVisible()
    await expect(within(rows[1]).queryByRole('img', { name: 'Current branch' })).toBeNull()
    await expect(within(rows[2]).queryByRole('img', { name: 'Current branch' })).toBeNull()
    for (const rename of ['Rename The trap', 'Rename Main', 'Rename The road not taken']) {
      await expect(screen.getByRole('button', { name: rename })).toBeVisible()
    }
    // No delete handler, no ×.
    await expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()

    const dialog = navigator('Branches · 3')
    await expect(dialog.closest('[data-radix-popper-content-wrapper]')).not.toBeNull()
    expect(dialog.getBoundingClientRect().width).toBeCloseTo(360, 0)
    await expect(screen.getByRole('button', { name: 'On The trap · 3 branches' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(queryNavigator('Branches · 3')).toBeNull())
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
  },
}

export const Tablet: Story = {
  globals: TABLET,
  play: async () => {
    await waitForTier('tablet')
    await openFromChip()
    await expect(await rowNames()).toEqual(['The trap', 'Main', 'The road not taken'])
    await expect(
      navigator('Branches · 3').closest('[data-radix-popper-content-wrapper]'),
    ).not.toBeNull()
    await expect(screen.getByRole('button', { name: 'Close' })).toBeVisible()
  },
}

export const Phone: Story = {
  globals: PHONE,
  play: async () => {
    await waitForTier('phone')
    await openFromChip()
    await waitForSheetSettled('Branches · 3')
    await expect(await rowNames()).toEqual(['The trap', 'Main', 'The road not taken'])
    const sheet = navigator('Branches · 3')
    await expect(sheet.closest('[data-radix-popper-content-wrapper]')).toBeNull()
    // The Sheet's dismissal is its handle, a backdrop tap or back: no close button.
    await expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    // The short detent: medium or tall would take a larger share of the window.
    const share = sheet.getBoundingClientRect().height / window.innerHeight
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.36)
    expect(dragHandleAbove(sheet)).toBeDefined()
  },
}

export const PressSwitchesAndCloses: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Main' }))
    await expect(args.onSwitch).toHaveBeenCalledTimes(1)
    await expect(args.onSwitch).toHaveBeenCalledWith('br_main')
    expectClosedBeforeCalled(args.onOpenChange, args.onSwitch)
    await waitFor(() => expect(queryNavigator('Branches · 3')).toBeNull())
  },
}

/** layout.md → Stacking: on phone the switch runs after the Sheet's exit. */
export const PressSwitchesAfterExitPhone: Story = {
  globals: PHONE,
  args: { onSwitch: fn() },
  play: async ({ args }) => {
    await waitForTier('phone')
    await openFromChip()
    await waitForSheetSettled('Branches · 3')
    let sheetTopAtCall = Number.NaN
    ;(args.onSwitch as ReturnType<typeof fn>).mockImplementation(() => {
      const sheet = queryNavigator('Branches · 3')
      sheetTopAtCall = sheet == null ? Number.POSITIVE_INFINITY : sheet.getBoundingClientRect().top
    })
    await userEvent.click(screen.getByRole('button', { name: 'Main' }))
    // The exit outlasts the press: a switch run from the press itself is called by now.
    await expect(args.onSwitch).not.toHaveBeenCalled()
    await waitFor(() => expect(args.onSwitch).toHaveBeenCalledTimes(1), ANIMATION)
    await expect(args.onSwitch).toHaveBeenCalledWith('br_main')
    expectClosedBeforeCalled(args.onOpenChange, args.onSwitch)
    expect(sheetTopAtCall).toBeGreaterThanOrEqual(window.innerHeight)
  },
}

export const CurrentRowCloses: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Current branch The trap' }))
    await waitFor(() => expect(queryNavigator('Branches · 3')).toBeNull())
    await expect(args.onSwitch).not.toHaveBeenCalled()
  },
}

export const Paused: Story = {
  args: { paused: true },
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await expect(screen.getByText('Generation in progress — switching paused.')).toBeVisible()
    const main = screen.getByRole('button', { name: 'Main' })
    await expect(main).toHaveAttribute('aria-disabled', 'true')
    expect(Number(getComputedStyle(main).opacity)).toBeLessThan(1)
    // Pins the disabled press: a click on the row's own element reaches no handler.
    fireEvent.click(main)
    await expect(args.onSwitch).not.toHaveBeenCalled()
    await expect(navigator('Branches · 3')).toBeVisible()

    const rename = screen.getByRole('button', { name: 'Rename Main' })
    await expect(rename).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(rename)
    await expect(await screen.findByRole('textbox', { name: 'Branch name' })).toHaveValue('Main')
  },
}

export const PausedPhone: Story = {
  globals: PHONE,
  args: { paused: true },
  play: async ({ args }) => {
    await waitForTier('phone')
    await openFromChip()
    await waitForSheetSettled('Branches · 3')
    await expect(screen.getByText('Generation in progress — switching paused.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Main' }))
    // Past any exit: a held switch would have run by now.
    await pause(800)
    await expect(args.onSwitch).not.toHaveBeenCalled()
    // A Sheet mid-exit still reads visible; the close it reports at once does not.
    await expect(args.onOpenChange).not.toHaveBeenCalledWith(false)
    await expect(navigator('Branches · 3')).toBeVisible()
  },
}

export const PauseLiftsWithNavigatorOpen: Story = {
  render: (args) => <PauseLiftsHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await expect(screen.getByText('Generation in progress — switching paused.')).toBeVisible()
    await userEvent.keyboard('{F4}')
    await waitFor(() =>
      expect(screen.queryByText('Generation in progress — switching paused.')).toBeNull(),
    )
    await expect(navigator('Branches · 3')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Main' }))
    await expect(args.onSwitch).toHaveBeenCalledWith('br_main')
  },
}

const SINGLE = {
  rows: [{ id: 'br_main', name: 'Main' }],
  currentBranchId: 'br_main',
  chip: { count: 1, currentName: 'Main' },
}

export const SingleBranch: Story = {
  args: { ...SINGLE, onDelete: fn() },
  render: (args) => <HandleHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('desktop')
    const anchor = await screen.findByTestId('branch-navigator-anchor')
    await expect(screen.queryByTestId('branch-chip')).toBeNull()
    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(navigator('Branches · 1')).toBeVisible(), ANIMATION)
    await expect(await rowNames()).toEqual(['Main'])
    await expect(screen.getByRole('button', { name: 'Rename Main' })).toBeVisible()
    // The only row is the current one: a delete handler shows no ×.
    await expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()

    // It opens where the chip will sit once a second branch exists.
    const dialog = navigator('Branches · 1')
    const anchorRect = anchor.getBoundingClientRect()
    expect(Math.abs(dialog.getBoundingClientRect().left - anchorRect.left)).toBeLessThan(2)
    expect(dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(anchorRect.bottom)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(queryNavigator('Branches · 1')).toBeNull())
    // Radix hands focus back to its trigger; the hidden anchor must not take it.
    await expect(anchor).not.toHaveFocus()
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
  },
}

export const SingleBranchPhone: Story = {
  globals: PHONE,
  args: { ...SINGLE, onDelete: fn() },
  render: (args) => <HandleHarness {...args} />,
  play: async ({ args }) => {
    await waitForTier('phone')
    await expect(screen.queryByTestId('branch-navigator-anchor')).toBeNull()
    await expect(screen.queryByTestId('branch-chip')).toBeNull()
    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(navigator('Branches · 1')).toBeVisible(), ANIMATION)
    await waitForSheetSettled('Branches · 1')
    await expect(await rowNames()).toEqual(['Main'])
    await expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(true)
    await userEvent.keyboard('{F3}')
    await waitFor(() => expect(queryNavigator('Branches · 1')).toBeNull(), ANIMATION)
    await expect(args.onOpenChange).toHaveBeenLastCalledWith(false)
  },
}

export const DeleteSlot: Story = {
  args: { onDelete: fn() },
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await expect(screen.getByRole('button', { name: 'Delete Main' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Delete The road not taken' })).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Delete The trap' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Main' }))
    await expect(args.onDelete).toHaveBeenCalledTimes(1)
    await expect(args.onDelete).toHaveBeenCalledWith('br_main')
    await expect(args.onSwitch).not.toHaveBeenCalled()
  },
}

export const LongNameTruncates: Story = {
  args: {
    rows: [
      { id: 'br_main', name: 'Main' },
      { id: 'br_long', name: LONG_NAME },
    ],
    currentBranchId: 'br_main',
    chip: { count: 2, currentName: 'Main' },
  },
  play: async () => {
    await waitForTier('desktop')
    await openFromChip('On Main · 2 branches', 'Branches · 2')
    const name = screen.getByText(LONG_NAME)
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    const dialogRight = navigator('Branches · 2').getBoundingClientRect().right
    const rename = screen.getByRole('button', { name: `Rename ${LONG_NAME}` })
    expect(rename.getBoundingClientRect().right).toBeLessThanOrEqual(dialogRight)
    expect(
      screen.getByRole('button', { name: LONG_NAME }).getBoundingClientRect().right,
    ).toBeLessThanOrEqual(dialogRight)
  },
}

const LONG_LIST_ARGS = {
  rows: LONG_LIST,
  currentBranchId: 'br_30',
  chip: { count: 30, currentName: 'Branch 30' },
}

export const LongListDesktop: Story = {
  args: LONG_LIST_ARGS,
  play: async () => {
    await waitForTier('desktop')
    await openFromChip('On Branch 30 · 30 branches', 'Branches · 30')
    const scroller = await list()
    expect(scroller.clientHeight).toBeLessThanOrEqual(320)
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    await expect((await rowNames())[0]).toBe('Branch 30')
  },
}

export const LongListPhone: Story = {
  globals: PHONE,
  args: LONG_LIST_ARGS,
  play: async () => {
    await waitForTier('phone')
    await openFromChip('On Branch 30 · 30 branches', 'Branches · 30')
    await waitForSheetSettled('Branches · 30')
    const scroller = await list()
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    expect(scroller.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
  },
}

export const EscInRenameKeepsNavigator: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    await renameField()
    await userEvent.keyboard('Renamed{Escape}')
    await expect(screen.queryByRole('textbox', { name: 'Branch name' })).toBeNull()
    await expect(screen.getByRole('button', { name: 'Main' })).toBeVisible()
    await expect(navigator('Branches · 3')).toBeVisible()
    await expect(args.onRename).not.toHaveBeenCalled()
    // With no rename open, Esc closes the navigator as usual.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(queryNavigator('Branches · 3')).toBeNull())
  },
}

export const EscInRenameKeepsNavigatorPhone: Story = {
  globals: PHONE,
  play: async ({ args }) => {
    await waitForTier('phone')
    await openFromChip()
    await waitForSheetSettled('Branches · 3')
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    await renameField()
    await userEvent.keyboard('Renamed{Escape}')
    await expect(screen.queryByRole('textbox', { name: 'Branch name' })).toBeNull()
    await expect(screen.getByRole('button', { name: 'Main' })).toBeVisible()
    await pause(300)
    await expect(navigator('Branches · 3')).toBeVisible()
    // A Sheet mid-exit still reads visible; the close it reports at once does not.
    await expect(args.onOpenChange).not.toHaveBeenCalledWith(false)
    await expect(args.onRename).not.toHaveBeenCalled()
  },
}

/** Esc from outside the input, with an empty name left open, closes as usual and saves nothing. */
export const EscOutsideRenameCloses: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    const field = await renameField()
    await userEvent.keyboard('{Backspace}')
    // The blur refuses the empty name, so the row stays in rename with focus off the input.
    await userEvent.click(screen.getByText('Branches · 3'))
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    await expect(field).toBeInTheDocument()
    await expect(field).not.toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(queryNavigator('Branches · 3')).toBeNull())
    await expect(args.onRename).not.toHaveBeenCalled()
  },
}

export const TypingInRenameNeverSwitches: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    const field = await renameField()
    // RN-Web keeps keys inside the input, so the row's own guard is that no pressable holds it:
    // a click in the field would otherwise reach the row's press.
    await expect(field.closest('[role="button"]')).toBeNull()
    await userEvent.click(field)
    field.setSelectionRange(0, field.value.length)
    await userEvent.keyboard('a b{Enter}')
    await waitFor(() => expect(args.onRename).toHaveBeenCalledTimes(1))
    await expect(args.onRename).toHaveBeenCalledWith('br_main', 'a b')
    await expect(args.onSwitch).not.toHaveBeenCalled()
    await expect(navigator('Branches · 3')).toBeVisible()
  },
}

/** Rows that lack the reader's branch (a late refresh): the given order, no ✓. */
export const CurrentBranchNotInRows: Story = {
  args: { currentBranchId: 'br_gone', chip: { count: 0, currentName: null } },
  render: (args) => <HandleHarness {...args} />,
  play: async () => {
    await waitForTier('desktop')
    await screen.findByTestId('branch-navigator-anchor')
    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(navigator('Branches · 3')).toBeVisible(), ANIMATION)
    await expect(await rowNames()).toEqual(['Main', 'The road not taken', 'The trap'])
    await expect(screen.queryByRole('img', { name: 'Current branch' })).toBeNull()
  },
}

/** A save settling after its editor was replaced closes only the editor that started it. */
export const LateSaveLeavesANewerEditorOpen: Story = {
  args: { onRename: fn() },
  play: async ({ args }) => {
    const pending: (() => void)[] = []
    ;(args.onRename as ReturnType<typeof fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pending.push(resolve)
        }),
    )
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    await renameField()
    await userEvent.keyboard('First{Enter}')
    await waitFor(() => expect(args.onRename).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: 'Rename The road not taken' }))
    await renameField()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    await renameField()
    await userEvent.keyboard('Second')

    pending[0]()
    await new Promise((resolve) => setTimeout(resolve, 100))

    const field = screen.getByRole('textbox', { name: 'Branch name' })
    await expect(field).toHaveValue('Second')
    await expect(args.onRename).toHaveBeenCalledTimes(1)
  },
}

export const CloseMidRenameSaves: Story = {
  play: async ({ args }) => {
    await waitForTier('desktop')
    await openFromChip()
    await userEvent.click(screen.getByRole('button', { name: 'Rename Main' }))
    await renameField()
    await userEvent.keyboard(' Main hall ')
    // An outside press closes the navigator and counts as the rename's blur.
    await userEvent.click(screen.getByTestId('tier'))
    await waitFor(() => expect(queryNavigator('Branches · 3')).toBeNull())
    await expect(args.onRename).toHaveBeenCalledTimes(1)
    await expect(args.onRename).toHaveBeenCalledWith('br_main', 'Main hall')
  },
}
