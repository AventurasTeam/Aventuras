import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, screen, userEvent } from 'storybook/test'

import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Text } from './text'

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Text>Open dialog</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave this trip?</DialogTitle>
          <DialogDescription>
            Your draft itinerary will be discarded. You can always start a new one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">
              <Text>Stay</Text>
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive">
              <Text>Leave</Text>
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const OpenByDefault: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Text>Reopen</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome back</DialogTitle>
          <DialogDescription>Shown open so you can inspect the layout.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
}

export const OpensOnClick: Story = {
  name: 'Opens on click (interactive)',
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Text>Trigger</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You did it</DialogTitle>
          <DialogDescription>Click handling works.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button>
              <Text>Close</Text>
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas }) => {
    const trigger = await canvas.findByRole('button', { name: 'Trigger' })
    await userEvent.click(trigger)
    // Dialog content mounts in a portal at document.body, not under the
    // story canvas root, so query via the document-scoped `screen`.
    const title = await screen.findByText('You did it')
    await expect(title).toBeInTheDocument()
  },
}
