import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { expectTopmost, pressSheetScrim } from '@/components/ui/sheet-scrim-probe'
import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN } from '@/lib/calendar'

import { WorldTimeEditSheet } from './worldtime-edit-sheet'

// Module scope keeps `calendar` / `worldTimeOrigin` referentially stable —
// WorldTimeEditForm's tuple memo keys on their identity.
const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 3000 }

// gorhom registers the modal with the provider stack in its own mount effects,
// so `present()` is deferred a tick — every play function waits for a field.
const secondField = () => screen.getByRole('textbox', { name: 'Second' })
async function openSheet() {
  await waitFor(() => expect(secondField()).toBeVisible(), WAIT)
}

async function typeSecond(value: string) {
  await userEvent.clear(secondField())
  await userEvent.type(secondField(), value)
  await waitFor(() => expect(secondField()).toHaveValue(value), WAIT)
}

const meta: Meta<typeof WorldTimeEditSheet> = {
  title: 'Compounds/Reader/WorldTimeEditSheet',
  component: WorldTimeEditSheet,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    frame: { calendar: EARTH_GREGORIAN, origin: ORIGIN },
    // 90 s past the origin — 00:01:30, so the `second` tier seeds at 30.
    worldTimeRaw: 90,
    onSave: fn(async () => true),
    onClose: fn(),
  },
}

export default meta
type Story = StoryObj<typeof WorldTimeEditSheet>

/** The phone fork's overlay: the host mounts it on `onRequestEditTime`. */
export const Default: Story = {
  play: openSheet,
}

export const SaveReportsSeconds: Story = {
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    // 00:01:45 past the origin.
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith(105), WAIT)
  },
}

export const CancelCloses: Story = {
  play: async ({ args }) => {
    await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** A failed write stays in the sheet and explains the failure inline. */
export const SaveFailureStaysOpen: Story = {
  args: { onSave: fn(async () => false) },
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith(105), WAIT)

    expect(args.onClose).not.toHaveBeenCalled()
    expect(secondField()).toHaveValue('45')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't update the entry's time.")
  },
}

const pendingSheetSave: { finish?: (ok: boolean) => void } = {}

/** Cancel and pan-down cannot replace the editor while its save is pending. */
export const SavingLocksTheSheet: Story = {
  args: {
    onSave: fn(
      () =>
        new Promise<boolean>((resolve) => {
          pendingSheetSave.finish = resolve
        }),
    ),
  },
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith(105), WAIT)

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(args.onClose).not.toHaveBeenCalled()

    pendingSheetSave.finish?.(true)
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
  },
}

/**
 * A no-change save reports through `onCancel`, not `onSave` — the form guards
 * it at tuple level, so the host closes without writing.
 */
export const UntouchedSaveClosesWithoutWriting: Story = {
  play: async ({ args }) => {
    await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

const LANDMARK = 'Reader behind the editor'

/** The reader under the editor: a tap outside the sheet lands on this canvas. */
const overCanvas: Story['render'] = (args) => (
  <View className="gap-4 p-4" style={{ minHeight: 640 }}>
    <Text>{LANDMARK}</Text>
    <WorldTimeEditSheet {...args} />
  </View>
)

/** Untouched, a tap outside the editor closes it, as drag-down does. */
export const BackdropClosesUntouched: Story = {
  parameters: { layout: 'fullscreen' },
  render: overCanvas,
  play: async ({ args }) => {
    await openSheet()
    await pressSheetScrim(screen.getByText(LANDMARK))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
  },
}

const guard = () => screen.getByRole('alertdialog', { name: 'Unsaved changes' })
const guardButton = (name: string) => within(guard()).getByRole('button', { name })

async function raiseGuard() {
  await pressSheetScrim(screen.getByText(LANDMARK))
  await waitFor(() => expect(guard()).toBeVisible(), WAIT)
}

/** An edit holds the sheet: tap-outside raises the unsaved-changes guard over it instead. */
export const BackdropRaisesGuardWhileEdited: Story = {
  parameters: { layout: 'fullscreen' },
  render: overCanvas,
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await raiseGuard()
    expectTopmost(guardButton('Discard'))
    expect(args.onClose).not.toHaveBeenCalled()

    // Cancel keeps editing: the guard goes, the sheet and its draft stay.
    await userEvent.click(guardButton('Cancel'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), WAIT)
    expect(secondField()).toHaveValue('45')
    expect(args.onClose).not.toHaveBeenCalled()

    await raiseGuard()
    await userEvent.click(guardButton('Discard'))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** The guard's Save writes the draft and closes, as the sheet's own Save does. */
export const GuardSaveWritesTheDraft: Story = {
  parameters: { layout: 'fullscreen' },
  render: overCanvas,
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await raiseGuard()
    await userEvent.click(guardButton('Save'))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    expect(args.onSave).toHaveBeenCalledWith(105)
  },
}

/** A failed write keeps the guard up, saying why, with the draft still behind it. */
export const GuardSaveFailureStaysRaised: Story = {
  parameters: { layout: 'fullscreen' },
  render: overCanvas,
  args: { onSave: fn(async () => false) },
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await raiseGuard()
    await userEvent.click(guardButton('Save'))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith(105), WAIT)
    await waitFor(
      () => expect(guard()).toHaveTextContent("Couldn't update the entry's time."),
      WAIT,
    )
    expect(args.onClose).not.toHaveBeenCalled()
  },
}

/** A draft the form's Save would refuse leaves the guard Discard and Cancel, and says why. */
export const GuardSaveBlockedByInvalidDraft: Story = {
  parameters: { layout: 'fullscreen' },
  render: overCanvas,
  play: async ({ args }) => {
    await openSheet()
    await userEvent.clear(secondField())
    await raiseGuard()
    expect(guardButton('Save')).toBeDisabled()
    expect(guard()).toHaveTextContent('Enter a valid second between 0 and 59.')
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** Dirty means different from the opening time: typing it back frees the sheet again. */
export const BackdropClosesAfterRevert: Story = {
  parameters: { layout: 'fullscreen' },
  render: overCanvas,
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await typeSecond('30')
    await pressSheetScrim(screen.getByText(LANDMARK))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
  },
}
