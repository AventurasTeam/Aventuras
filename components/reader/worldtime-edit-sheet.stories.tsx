import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'

import { WorldTimeEditSheet } from './worldtime-edit-sheet'

// Module scope keeps `calendar` / `worldTimeOrigin` referentially stable —
// WorldTimeEditForm's tuple memo keys on their identity.
const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

// gorhom registers the modal with the provider stack in its own mount effects,
// so `present()` is deferred a tick — every play function waits for a field.
const secondField = () => screen.getByRole('textbox', { name: 'Second' })
async function openSheet() {
  await waitFor(() => expect(secondField()).toBeVisible())
}

async function typeSecond(value: string) {
  await userEvent.clear(secondField())
  await userEvent.type(secondField(), value)
  await waitFor(() => expect(secondField()).toHaveValue(value))
}

const meta: Meta<typeof WorldTimeEditSheet> = {
  title: 'Compounds/Reader/WorldTimeEditSheet',
  component: WorldTimeEditSheet,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    calendar: EARTH_GREGORIAN,
    worldTimeOrigin: ORIGIN,
    // 90 s past the origin — 00:01:30, so the `second` tier seeds at 30.
    worldTimeRaw: 90,
    onSave: fn(async () => {}),
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
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith(105))
  },
}

export const CancelCloses: Story = {
  play: async ({ args }) => {
    await openSheet()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1))
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/**
 * The sheet never closes itself on Save — it reports and waits. That is what
 * lets the host keep it open on a rejected write (the route only drops the
 * pending id when the action returns ok), so a failed save costs no retyping.
 */
export const SaveDefersClosingToTheHost: Story = {
  play: async ({ args }) => {
    await openSheet()
    await typeSecond('45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledWith(105))

    expect(args.onClose).not.toHaveBeenCalled()
    expect(secondField()).toHaveValue('45')
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
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1))
    expect(args.onSave).not.toHaveBeenCalled()
  },
}
