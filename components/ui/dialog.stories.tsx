import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

const meta: Meta<typeof Dialog> = {
  title: 'Primitives/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Text>Open dialog</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>Pick one of the options below.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary">
            <Text>Cancel</Text>
          </Button>
          <Button variant="primary">
            <Text>Confirm</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const WithFooterOnly: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Text>Open</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notice</DialogTitle>
        </DialogHeader>
        <Text variant="muted">
          Single-button footer; the corner × is the only other dismissal affordance.
        </Text>
        <DialogFooter>
          <Button variant="primary">
            <Text>Close</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 320 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">
                <Text>Open</Text>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm action</DialogTitle>
                <DialogDescription>Pick one of the options below.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary">
                  <Text>Cancel</Text>
                </Button>
                <Button variant="primary">
                  <Text>Confirm</Text>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </View>
      ))}
    </View>
  ),
}
