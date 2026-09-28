import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { createRef } from 'react'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Composer, type ComposerHandle } from './composer'

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
 * Send hands the draft up and clears the input. The keyboard dismissal that
 * rides along on native has no web equivalent, so this pins the surviving half:
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

const leadMissingRef = createRef<ComposerHandle>()

/** A dangling lead leaves the third-person wrap with no subject: modes disable, sends go free. */
export const LeadMissing: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    modesUnavailableReason: "The story's lead no longer exists. Set a new lead in World.",
  },
  render: (args) => <Composer ref={leadMissingRef} {...args} />,
  play: async ({ args, canvasElement }) => {
    // The trigger's accessible name is the label plus the selected option's text; with
    // modes unusable the value falls back to 'free' ("Mode Free"), read off ModesVisible.
    const mode = await screen.findByRole('button', { name: 'Mode Free' })
    expect(mode).toHaveAttribute('aria-disabled', 'true')
    const input = canvasElement.querySelector('textarea')
    if (input == null) throw new Error('composer input not found')
    // Seed a non-free mode directly (the picker is inert while unavailable, so nothing in the
    // UI can do this) — proves the send-time gate, not just the picker's own default, forces
    // 'free': a dropped gate would leave this send going out as 'do'.
    leadMissingRef.current?.restoreDraft('draw my blade', 'do')
    await waitFor(() => expect(input.value).toBe('draw my blade'))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(args.onSend).toHaveBeenCalledWith('draw my blade', 'free'))
  },
}
