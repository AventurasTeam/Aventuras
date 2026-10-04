import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { createRef, useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

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
  play: async ({ canvas }) => {
    const send = canvas.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await expect(send.parentElement?.getAttribute('title')).toBe('Unavailable while generating.')
  },
}

/** An empty draft disables Send with nothing to explain, so the gate's reason stays off it. */
export const EmptyDraftShowsNoReason: Story = {
  args: {
    modesEnabled: false,
    isGenerating: false,
    disabledReason: 'Unavailable while generating.',
  },
  play: async ({ canvas }) => {
    const send = canvas.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await expect(send.parentElement?.getAttribute('title')).toBeNull()
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

const LEAD_MISSING_REASON =
  "The story's lead isn't on this branch, so actions can't be written for them. Set a new lead in World."

const leadMissingRef = createRef<ComposerHandle>()

/** A dangling lead leaves the third-person wrap with no subject: modes disable, sends go free. */
export const LeadMissing: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    modesUnavailableReason: LEAD_MISSING_REASON,
  },
  render: (args) => <Composer ref={leadMissingRef} {...args} />,
  play: async ({ args, canvasElement }) => {
    // renderTrigger's label + selected-option compose with no separator ('Mode'+'Free' → 'Mode Free');
    // value stays gated to 'free' regardless of draft mode, so the name never becomes 'Mode Do'.
    const mode = await screen.findByRole('button', { name: 'Mode Free' })
    expect(mode).toHaveAttribute('aria-disabled', 'true')
    const input = canvasElement.querySelector('textarea')
    if (input == null) throw new Error('composer input not found')
    // Seeds a non-free mode directly (picker is inert while unavailable, UI can't do this) — proves
    // both gates hold against the real draft state, not just the picker's own default value.
    leadMissingRef.current?.restoreDraft('draw my blade', 'do')
    await waitFor(() => expect(input.value).toBe('draw my blade'))
    expect(screen.getByRole('button', { name: 'Mode Free' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText(args.modesUnavailableReason as string)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(args.onSend).toHaveBeenCalledWith('draw my blade', 'free'))
  },
}

const leadReturnsRef = createRef<ComposerHandle>()

function LeadToggleHarness(props: ComponentProps<typeof Composer>) {
  const [leadMissing, setLeadMissing] = useState(false)
  return (
    <View className="gap-4">
      <Button variant="secondary" onPress={() => setLeadMissing((missing) => !missing)}>
        <Text>Toggle lead</Text>
      </Button>
      <Composer
        ref={leadReturnsRef}
        {...props}
        modesUnavailableReason={leadMissing ? LEAD_MISSING_REASON : undefined}
      />
    </View>
  )
}

/** Losing the lead resets the mode to Free, so the lead coming back (undo, Set as lead) keeps Free. */
export const LeadReturnsKeepsFree: Story = {
  args: { modesEnabled: true, isGenerating: false },
  render: (args) => <LeadToggleHarness {...args} />,
  play: async ({ args, canvasElement }) => {
    const input = canvasElement.querySelector('textarea')
    if (input == null) throw new Error('composer input not found')
    leadReturnsRef.current?.restoreDraft('', 'do')
    await screen.findByRole('button', { name: 'Mode Do' })

    const toggle = screen.getByRole('button', { name: 'Toggle lead' })
    await userEvent.click(toggle)
    await waitFor(() => expect(screen.getByText(LEAD_MISSING_REASON)).toBeVisible())
    await userEvent.click(toggle)
    await waitFor(() => expect(screen.queryByText(LEAD_MISSING_REASON)).not.toBeInTheDocument())

    const mode = screen.getByRole('button', { name: 'Mode Free' })
    expect(mode).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.type(input, 'draw my blade')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(args.onSend).toHaveBeenCalledWith('draw my blade', 'free'))
  },
}

/**
 * A pending embedder swap on a third-person story with no lead sets both reasons — e.g. the
 * reader route's `disabled={!hydrationSucceeded || swapPending}`. The disabled reason wins.
 */
export const DisabledReasonWinsOverLeadMissing: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    disabled: true,
    disabledReason: 'Switching writer models…',
    modesUnavailableReason: LEAD_MISSING_REASON,
  },
  play: async ({ args }) => {
    await waitFor(() => expect(screen.getByText(args.disabledReason as string)).toBeVisible(), {
      timeout: 3000,
    })
    expect(screen.queryByText(args.modesUnavailableReason as string)).not.toBeInTheDocument()
  },
}
