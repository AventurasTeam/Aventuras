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

    // WCAG 2.5.3: the accessible name leads with the visible label, then the reason.
    const exportItem = screen.getByRole('menuitem', {
      name: 'Export thread as JSON, Export not available yet',
    })
    await expect(exportItem).toBeVisible()
    await expect(exportItem).toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByText('Export thread as JSON')).toBeVisible()
    await expect(screen.getByTitle('Export not available yet')).toBeInTheDocument()

    // RN-Web's own Pressable applies pointer-events blocking when `disabled`, which
    // userEvent's click respects; fireEvent bypasses that so this pins the `onPress`
    // guard itself, not a CSS accident, as what blocks a disabled entry from firing.
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
    // The Popover branch always wraps its trigger in a `title`-bearing ReasonTooltip;
    // the Sheet branch never does — a real, structural phone-tier discriminator that
    // beats a synchronous click racing RN-Web's Dimensions cache (see lessons-learned).
    await waitFor(() => expect(screen.queryByTitle('More actions')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    // The bottom Sheet's presentation is deferred a tick past the click (gorhom
    // registers with its provider before `present()` can succeed).
    const viewJson = await waitFor(() => screen.getByRole('menuitem', { name: 'View raw JSON' }))
    await waitFor(() => expect(viewJson).toBeVisible())

    // The Sheet content carries no dialog role; a match here means the Popover
    // branch rendered instead of the Sheet.
    expect(screen.queryByRole('dialog')).toBeNull()

    expect(viewJson.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    await expect(
      screen.getByRole('menuitem', { name: 'Export thread as JSON, Export not available yet' }),
    ).toBeVisible()
  },
}
