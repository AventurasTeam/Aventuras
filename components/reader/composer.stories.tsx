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

/** No story to draft against — the whole composer is inert and says why. */
export const Disabled: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    disabled: true,
    disabledReason: 'Loading this branch…',
  },
}

/**
 * The reader's edit gate is held (a suggestion re-roll, say). Only Send is
 * refused — the draft and the mode picker stay live, since neither writes
 * anything until send.
 */
export const SendBlocked: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    sendBlocked: true,
    disabledReason: 'Unavailable while generating.',
  },
}
