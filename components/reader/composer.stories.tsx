import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

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

/**
 * Send hands the draft up and clears the input. Send also dismisses the soft
 * keyboard, which no browser has — this pins the surviving half, that the
 * dismissal never swallows the submit.
 */
export const SendHandsUpDraftAndClears: Story = {
  args: { modesEnabled: false, isGenerating: false },
  play: async ({ args, canvasElement }) => {
    const input = canvasElement.querySelector('textarea')
    if (input == null) throw new Error('composer input not found')

    await userEvent.click(input)
    await userEvent.type(input, 'I step into the dim light.')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(args.onSend).toHaveBeenCalledWith('I step into the dim light.', 'free'),
    )
    await waitFor(() => expect(input.value).toBe(''))
  },
}

/** An empty draft is not sendable, so Send is inert rather than dispatching. */
export const EmptyDraftDoesNotSend: Story = {
  args: { modesEnabled: false, isGenerating: false },
  play: ({ args }) => {
    const send = screen.getByRole('button', { name: 'Send' })
    // The shipped gate is an inline pointer-events style, not just an attribute
    // (rn-primitives doesn't reliably block disabled clicks on web).
    expect(getComputedStyle(send).pointerEvents).toBe('none')
    expect(args.onSend).not.toHaveBeenCalled()
  },
}
