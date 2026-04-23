import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { Info, ShieldAlert, Sparkles } from 'lucide-react-native'
import { View } from 'react-native'

import { Alert, AlertDescription, AlertTitle } from './alert'

const meta: Meta<typeof Alert> = {
  title: 'UI/Alert',
  component: Alert,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="w-96">
        <Story />
      </View>
    ),
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive'],
    },
  },
}

export default meta

type Story = StoryObj<typeof Alert>

export const Default: Story = {
  args: { icon: Info },
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>New feature available</AlertTitle>
      <AlertDescription>We just shipped a new way to plan your itinerary.</AlertDescription>
    </Alert>
  ),
}

export const Destructive: Story = {
  args: { icon: ShieldAlert, variant: 'destructive' },
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>We couldn&apos;t save your changes. Please try again.</AlertDescription>
    </Alert>
  ),
}

export const TitleOnly: Story = {
  args: { icon: Sparkles },
  render: (args) => (
    <Alert {...args}>
      <AlertTitle>Heads up — this alert has no description.</AlertTitle>
    </Alert>
  ),
}
