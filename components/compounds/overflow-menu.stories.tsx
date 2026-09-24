import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test'

import { OverflowMenu, type OverflowMenuEntry } from './overflow-menu'

const ENTRIES: OverflowMenuEntry[] = [
  {
    key: 'export',
    label: 'Export thread as JSON',
    disabled: true,
    disabledReason: 'Export not available yet',
    onPress: fn(),
  },
  { key: 'json', label: 'View raw JSON', onPress: fn() },
  {
    key: 'delete',
    label: 'Delete thread',
    destructive: true,
    disabled: true,
    disabledReason: 'Delete not available yet',
    onPress: fn(),
  },
]

const meta: Meta<typeof OverflowMenu> = {
  title: 'Compounds/OverflowMenu',
  component: OverflowMenu,
  parameters: { layout: 'padded' },
  args: { label: 'More actions', entries: ENTRIES },
  decorators: [
    (Story) => (
      <View className="items-end p-4">
        <Story />
      </View>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof OverflowMenu>

export const Default: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    // The popover fades in; querying for the role alone can outrace opacity settling.
    const viewJson = await screen.findByRole('menuitem', { name: 'View raw JSON' })
    await waitFor(() => expect(viewJson).toBeVisible())

    // WCAG 2.5.3: the accessible name leads with the visible label, then the reason.
    const exportItem = screen.getByRole('menuitem', {
      name: 'Export thread as JSON, Export not available yet',
    })
    await expect(exportItem).toBeVisible()
    await expect(exportItem).toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByText('Export thread as JSON')).toBeVisible()
    await expect(screen.getByTitle('Export not available yet')).toBeInTheDocument()

    // RN-Web's Pressable blocks pointer-events when `disabled`; userEvent respects that, fireEvent
    // bypasses it — pins the `onPress` guard itself, not a CSS accident, as what blocks the entry.
    fireEvent.click(exportItem)
    expect(args.entries[0].onPress).not.toHaveBeenCalled()

    await userEvent.click(viewJson)
    await waitFor(() => expect(args.entries[1].onPress).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'View raw JSON' })).not.toBeInTheDocument(),
    )
  },
}

export const AllEnabled: Story = {
  args: { entries: ENTRIES.map((e) => ({ ...e, disabled: false, disabledReason: undefined })) },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const deleteItem = await screen.findByRole('menuitem', { name: 'Delete thread' })
    await expect(screen.getByText('Delete thread')).toHaveClass('text-danger')

    await userEvent.click(deleteItem)
    await waitFor(() => expect(args.entries[2].onPress).toHaveBeenCalledTimes(1))
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    // Only the Popover trigger gets a title-bearing ReasonTooltip — a real phone-tier
    // signal (lessons-learned/storybook-viewport-usetier-async.md).
    await waitFor(() => expect(screen.queryByTitle('More actions')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    // The bottom Sheet's presentation is deferred a tick past the click (gorhom
    // registers with its provider before `present()` can succeed).
    const viewJson = await waitFor(() => screen.getByRole('menuitem', { name: 'View raw JSON' }))
    await waitFor(() => expect(viewJson).toBeVisible())

    // Both surfaces are dialogs; only the Popover sits inside Radix's popper wrapper.
    expect(viewJson.closest('[data-radix-popper-content-wrapper]')).toBeNull()

    // Regular density's phone floor (`control-h-lg`) is 48px; `control-h-md` is 44px
    // at that density too, so a >=44 check alone can't tell the two rows apart.
    expect(viewJson.getBoundingClientRect().height).toBeGreaterThanOrEqual(48)

    await expect(
      screen.getByRole('menuitem', { name: 'Export thread as JSON, Export not available yet' }),
    ).toBeVisible()
  },
}

// F2 flips `disabled` via a capture-phase listener; a button click would itself dismiss the
// popover/sheet (Radix outside-click / gorhom backdrop), passing vacuously either way.
function DisableToggleHarness() {
  const [disabled, setDisabled] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setDisabled((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <View className="items-end p-4">
      <OverflowMenu label="More actions" entries={ENTRIES} disabled={disabled} />
    </View>
  )
}

/**
 * A trigger that disables while its menu is open must close it (PopoverMenu's own
 * effect, not the primitive's outside-click dismissal) and reopen once re-enabled.
 */
export const ClosesWhenDisabled: Story = {
  render: () => <DisableToggleHarness />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await screen.findByRole('menuitem', { name: 'View raw JSON' })

    await userEvent.keyboard('{F2}')
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'View raw JSON' })).not.toBeInTheDocument(),
    )

    await userEvent.keyboard('{F2}')
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const reopened = await screen.findByRole('menuitem', { name: 'View raw JSON' })
    await waitFor(() => expect(reopened).toBeVisible())
  },
}

/**
 * Same close-on-disable contract, run against SheetMenu's own effect. Asserts via
 * `aria-expanded` (Radix's open context) rather than the menuitem leaving the DOM — gorhom's
 * Sheet content doesn't reliably unmount here, a tracked substrate gap, not this effect's bug.
 */
export const ClosesWhenDisabledPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => <DisableToggleHarness />,
  play: async () => {
    await waitFor(() => expect(screen.queryByTitle('More actions')).toBeNull())
    const trigger = screen.getByRole('button', { name: 'More actions' })

    await userEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))

    await userEvent.keyboard('{F2}')
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))

    await userEvent.keyboard('{F2}')
    await userEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
  },
}
