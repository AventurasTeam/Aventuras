import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
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

    // A disabled entry's accessible name is its reason; its label stays visible.
    const exportItem = screen.getByRole('menuitem', { name: 'Export not available yet' })
    await expect(exportItem).toBeVisible()
    await expect(exportItem).toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByText('Export thread as JSON')).toBeVisible()
    await expect(screen.getByTitle('Export not available yet')).toBeInTheDocument()

    // userEvent refuses a click on a `pointer-events: none` target; fireEvent
    // bypasses that check, so this pins the Pressable's own `disabled` prop —
    // not the inline style — as what actually blocks the entry from firing.
    fireEvent.click(exportItem)
    expect(args.entries[0].onPress).not.toHaveBeenCalled()

    await userEvent.click(viewJson)
    await waitFor(() => expect(args.entries[1].onPress).toHaveBeenCalledTimes(1))
    // Selecting an entry closes the popover.
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
    await userEvent.click(deleteItem)
    await waitFor(() => expect(args.entries[2].onPress).toHaveBeenCalledTimes(1))
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    // The bottom Sheet's presentation is deferred a tick past the click (gorhom
    // registers with its provider before `present()` can succeed).
    await waitFor(async () => {
      await expect(screen.getByRole('menuitem', { name: 'View raw JSON' })).toBeVisible()
    })
    await expect(screen.getByRole('menuitem', { name: 'Export not available yet' })).toBeVisible()
  },
}
