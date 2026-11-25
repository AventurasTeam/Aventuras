import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

import { BranchDeleteConfirm, type BranchDeleteConfirmProps } from './branch-delete-confirm'

// CI runs plays several times slower than local; every wait uses this.
const WAIT = { timeout: 5000 }
const PHONE = { viewport: { value: 'mobile1' } }
const BLOCKED_REASON = t('generationGate.inFlight')

// branch-navigator.md → Delete confirm's sketch.
const COPY = {
  title: 'Delete alt-ending-2?',
  count: '38 entries exist only on this branch.',
  one: '1 entry exists only on this branch.',
  none: 'No entries exist only on this branch.',
  consequence: "Its world, plot and chapter changes go with it. This can't be undone.",
  cancel: 'Cancel',
  confirm: 'Delete branch',
  failed: "Couldn't delete the branch.",
}
const COUNT_LINE = /\d+ entr(?:y|ies) exists? only on this branch/

function findDialog() {
  return screen.findByRole('alertdialog', { name: COPY.title }, WAIT)
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect()
  return { x: Math.floor(box.left + box.width / 2), y: Math.floor(box.top + box.height / 2) }
}

function hitAt({ x, y }: { x: number; y: number }): Element | null {
  return document.elementFromPoint(x, y)
}

// An open modal turns a lower layer's pointer events off, and hit-testing skips such an element
// whatever paints there: the layer under test takes them back for the probe alone.
function withHitTesting<T>(layer: HTMLElement, probe: () => T): T {
  const previous = layer.style.pointerEvents
  layer.style.pointerEvents = 'auto'
  try {
    return probe()
  } finally {
    layer.style.pointerEvents = previous
  }
}

const meta: Meta<typeof BranchDeleteConfirm> = {
  title: 'Compounds/Reader/BranchDeleteConfirm',
  component: BranchDeleteConfirm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { open: true, name: 'alt-ending-2', count: 38, onOpenChange: fn(), onDelete: fn() },
}

export default meta
type Story = StoryObj<typeof meta>

export const Count: Story = {
  play: async ({ args }) => {
    const dialog = await findDialog()
    await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.count))
    await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.consequence))
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    const text = description?.textContent ?? ''
    expect(text.indexOf(COPY.count)).toBeLessThan(text.indexOf(COPY.consequence))
    // Radix focuses an AlertDialog through its Cancel: a plain button there leaves focus behind it.
    await waitFor(
      () => expect(within(dialog).getByRole('button', { name: COPY.cancel })).toHaveFocus(),
      WAIT,
    )
    expect(within(dialog).queryByRole('status')).toBeNull()
    expect(within(dialog).queryByRole('alert')).toBeNull()

    await userEvent.click(within(dialog).getByRole('button', { name: COPY.confirm }))
    await waitFor(() => expect(args.onDelete).toHaveBeenCalledTimes(1), WAIT)
    // Not a closer: the host closes the confirm on the delete's result.
    expect(args.onOpenChange).not.toHaveBeenCalled()
    await expect(dialog).toBeInTheDocument()
  },
}

export const One: Story = {
  args: { count: 1 },
  play: async () => {
    const dialog = await findDialog()
    await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.one))
    await expect(dialog).not.toHaveAccessibleDescription(/entries exist/)
  },
}

export const Zero: Story = {
  args: { count: 0 },
  play: async () => {
    const dialog = await findDialog()
    await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.none))
    await expect(dialog).not.toHaveAccessibleDescription(COUNT_LINE)
  },
}

export const CancelCloses: Story = {
  play: async ({ args }) => {
    const dialog = await findDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: COPY.cancel }))
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false), WAIT)
    expect(args.onDelete).not.toHaveBeenCalled()
  },
}

/** The gate closed, or a swap went pending, after the confirm opened. Cancel stays live. */
export const Blocked: Story = {
  args: { blockedReason: BLOCKED_REASON },
  play: async ({ args }) => {
    const dialog = await findDialog()
    await expect(within(dialog).getByRole('status')).toHaveTextContent(BLOCKED_REASON)
    const confirm = within(dialog).getByRole('button', { name: COPY.confirm })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    // Past user-event's pointer-events check, so only the disabled wiring stops the press.
    await userEvent.click(confirm, { pointerEventsCheck: 0 })
    expect(args.onDelete).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: COPY.cancel })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** The delete is running: it can't stop partway, so nothing answers until it settles. */
export const Pending: Story = {
  args: { phase: 'pending' },
  play: async ({ args }) => {
    const dialog = await findDialog()
    const cancel = within(dialog).getByRole('button', { name: COPY.cancel })
    const confirm = within(dialog).getByRole('button', { name: COPY.confirm })
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    for (const button of [cancel, confirm]) {
      expect(button).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(button, { pointerEventsCheck: 0 })
    }
    await userEvent.keyboard('{Escape}')
    expect(args.onDelete).not.toHaveBeenCalled()
    expect(args.onOpenChange).not.toHaveBeenCalled()
    await expect(dialog).toBeInTheDocument()
  },
}

/** The last press threw: the line shows, and both buttons stay live for a retry or Cancel. */
export const Failed: Story = {
  args: { phase: 'failed' },
  play: async ({ args }) => {
    const dialog = await findDialog()
    await expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.failed)
    for (const name of [COPY.cancel, COPY.confirm]) {
      expect(within(dialog).getByRole('button', { name })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }
    await userEvent.click(within(dialog).getByRole('button', { name: COPY.confirm }))
    await waitFor(() => expect(args.onDelete).toHaveBeenCalledTimes(1), WAIT)
  },
}

/** alert-dialog.md → Modal-on-every-tier: inside the gutters, the actions stacked. */
export const CountPhone: Story = {
  globals: PHONE,
  play: async () => {
    await waitFor(() => expect(window.innerWidth).toBeLessThan(640), WAIT)
    const dialog = await findDialog()
    await expect(dialog).toHaveAccessibleDescription(expect.stringContaining(COPY.count))
    const box = dialog.getBoundingClientRect()
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(window.innerWidth)
    const confirm = within(dialog).getByRole('button', { name: COPY.confirm })
    const cancel = within(dialog).getByRole('button', { name: COPY.cancel })
    expect(confirm.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      cancel.getBoundingClientRect().top,
    )
  },
}

// Mounted inside the Popover's tree, so the confirm's focus isn't outside it and the Popover stays
// open without the navigator's hold; only the stacking is under test.
function ConfirmFromAPopover(props: BranchDeleteConfirmProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <View className="items-start p-8">
      <Popover ariaLabel="Host popover">
        <PopoverTrigger asChild>
          <Button>
            <Text>Open popover</Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <Text>Under the confirm</Text>
          <Button onPress={() => setConfirming(true)}>
            <Text>Ask</Text>
          </Button>
          <BranchDeleteConfirm {...props} open={confirming} onOpenChange={setConfirming} />
        </PopoverContent>
      </Popover>
    </View>
  )
}

/** layout.md → Stacking: the confirm's scrim covers a Popover held open beneath it. */
export const AboveAnOpenPopover: Story = {
  parameters: { layout: 'fullscreen' },
  render: (args) => <ConfirmFromAPopover {...args} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Open popover' }))
    const under = await screen.findByText('Under the confirm')
    const popover = screen.getByRole('dialog', { name: 'Host popover' })
    // Control: before the confirm, the point is the Popover's own.
    expect(popover.contains(hitAt(centreOf(under)))).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const dialog = await findDialog()
    const covered = withHitTesting(popover, () => hitAt(centreOf(under)))
    expect(covered).not.toBeNull()
    expect(popover.contains(covered)).toBe(false)
    const own = withHitTesting(popover, () => hitAt(centreOf(dialog)))
    expect(dialog.contains(own)).toBe(true)
  },
}

// The owner flips one state on the press: the gate closing (`blockedReason`) or the delete
// starting (`phase`), the two ways `Delete branch` disables under the focus it holds.
function FlipOnDelete({
  flip,
  ...props
}: BranchDeleteConfirmProps & { flip: 'blocked' | 'pending' }) {
  const [flipped, setFlipped] = useState(false)
  return (
    <BranchDeleteConfirm
      {...props}
      blockedReason={flip === 'blocked' && flipped ? BLOCKED_REASON : props.blockedReason}
      phase={flip === 'pending' && flipped ? 'pending' : props.phase}
      onDelete={() => {
        props.onDelete()
        setFlipped(true)
      }}
    />
  )
}

async function expectFocusKeptWhenDeleteDisables(args: BranchDeleteConfirmProps) {
  const dialog = await findDialog()
  const confirm = within(dialog).getByRole('button', { name: COPY.confirm })
  confirm.focus()
  await expect(confirm).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(args.onDelete).toHaveBeenCalledTimes(1), WAIT)
  await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'), WAIT)
  // Chromium blurs the button as it disables; the dialog takes focus back.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true), WAIT)
  expect(document.activeElement).not.toBe(document.body)
  await userEvent.tab()
  expect(dialog.contains(document.activeElement)).toBe(true)
}

/** The gate closes, or a swap goes pending, after the confirm opened: focus doesn't fall to the page. */
export const FocusStaysWhenBlocked: Story = {
  render: (args) => <FlipOnDelete {...args} flip="blocked" />,
  play: async ({ args }) => expectFocusKeptWhenDeleteDisables(args),
}

/** The press starts the delete and both buttons disable: with no control left, the dialog keeps focus. */
export const FocusStaysWhenPending: Story = {
  render: (args) => <FlipOnDelete {...args} flip="pending" />,
  play: async ({ args }) => expectFocusKeptWhenDeleteDisables(args),
}
