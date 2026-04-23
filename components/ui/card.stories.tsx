import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Button } from './button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'
import { Text } from './text'

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="w-96">
        <Story />
      </View>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof Card>

export const Basic: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Next adventure</CardTitle>
        <CardDescription>Pick a destination to start planning.</CardDescription>
      </CardHeader>
      <CardContent>
        <Text>
          The rest of the content lives here — it&apos;s plain RN text so you can put whatever you
          want.
        </Text>
      </CardContent>
    </Card>
  ),
}

export const WithFooter: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Confirm trip</CardTitle>
        <CardDescription>This will lock in your itinerary.</CardDescription>
      </CardHeader>
      <CardContent>
        <Text>Flights, stays, and activities are ready to book.</Text>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost">
          <Text>Cancel</Text>
        </Button>
        <Button>
          <Text>Book it</Text>
        </Button>
      </CardFooter>
    </Card>
  ),
}

export const ContentOnly: Story = {
  render: () => (
    <Card>
      <CardContent className="py-4">
        <Text>Just a surface. No header, no footer.</Text>
      </CardContent>
    </Card>
  ),
}
