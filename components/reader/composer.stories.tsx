import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { fn } from 'storybook/test'

import { Composer } from './composer'

const meta = {
  title: 'Compounds/Reader/Composer',
  component: Composer,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  args: { onSend: fn(), onCancel: fn() },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

export const ModesVisible: Story = { args: { modesEnabled: true, isGenerating: false } }

export const ModesHidden: Story = { args: { modesEnabled: false, isGenerating: false } }

export const Generating: Story = { args: { modesEnabled: true, isGenerating: true } }

export const Disabled: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    disabled: true,
    disabledReason: 'Generation is in flight. Cancel to edit.',
  },
}
