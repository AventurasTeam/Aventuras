import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { createRef, useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { expect, fireEvent, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

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

// Canon's copy (principles.md → Composer mode), hand-written: the stories render the locale's.
const CANON_LEAD_LINE =
  'This story needs a lead on this branch before it can continue. Set one in World.'
const LEAD_MISSING_REASON = t('reader:composerLeadMissing')

const leadMissingRef = createRef<ComposerHandle>()

/**
 * The branch needs a lead and has none: Send refuses with the draft kept, the picker disables on
 * Free, the mode resets, and the reason line says why.
 */
export const LeadMissing: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    leadMissingReason: LEAD_MISSING_REASON,
  },
  render: (args) => <Composer ref={leadMissingRef} {...args} />,
  play: async ({ args, canvasElement }) => {
    // renderTrigger's label + selected-option compose with no separator ('Mode'+'Free' → 'Mode Free').
    const mode = await screen.findByRole('button', { name: 'Mode Free' })
    expect(mode).toHaveAttribute('aria-disabled', 'true')
    const input = canvasElement.querySelector('textarea')
    if (input == null) throw new Error('composer input not found')
    // A non-free mode seeded past the inert picker: the reset must hold against the draft itself.
    leadMissingRef.current?.restoreDraft('draw my blade', 'do')
    await waitFor(() => expect(input.value).toBe('draw my blade'))
    expect(screen.getByRole('button', { name: 'Mode Free' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(leadMissingRef.current?.getDraft().mode).toBe('free')
    expect(screen.getByText(CANON_LEAD_LINE)).toBeVisible()

    const send = screen.getByRole('button', { name: t('reader:send') })
    expect(send).toBeDisabled()
    expect(send.parentElement?.getAttribute('title')).toBe(LEAD_MISSING_REASON)
    // userEvent won't press through pointer-events: none; fireEvent does, and Send must still drop
    // it (the disabled control or handleSubmit's backstop).
    fireEvent.click(send)
    expect(args.onSend).not.toHaveBeenCalled()
    expect(input.value).toBe('draw my blade')
  },
}

/** Modes hidden (creative, or the story's toggle off): the line shows and Send still refuses. */
export const LeadMissingModesHidden: Story = {
  args: {
    modesEnabled: false,
    isGenerating: false,
    leadMissingReason: LEAD_MISSING_REASON,
  },
  play: async ({ args, canvasElement }) => {
    const input = canvasElement.querySelector('textarea')
    if (input == null) throw new Error('composer input not found')
    await userEvent.type(input, 'I knock.')
    await waitFor(() => expect(input.value).toBe('I knock.'))
    expect(screen.getByText(CANON_LEAD_LINE)).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Mode/ })).not.toBeInTheDocument()

    const send = screen.getByRole('button', { name: t('reader:send') })
    expect(send).toBeDisabled()
    fireEvent.click(send)
    expect(args.onSend).not.toHaveBeenCalled()
    expect(input.value).toBe('I knock.')
  },
}

/** A turn generating doesn't take the line: the lead's reason stays under Cancel. */
export const LeadMissingWhileGenerating: Story = {
  args: {
    modesEnabled: true,
    isGenerating: true,
    leadMissingReason: LEAD_MISSING_REASON,
  },
  play: async () => {
    expect(await screen.findByRole('button', { name: t('cancel') })).toBeVisible()
    expect(screen.getByText(CANON_LEAD_LINE)).toBeVisible()
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
        leadMissingReason={leadMissing ? LEAD_MISSING_REASON : undefined}
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
 * A pending embedder swap on a branch with no lead sets both reasons — e.g. the reader route's
 * `disabled={!hydrationSucceeded || swapPending}`. The disabled reason wins.
 */
export const DisabledReasonWinsOverLeadMissing: Story = {
  args: {
    modesEnabled: true,
    isGenerating: false,
    disabled: true,
    disabledReason: 'Switching writer models…',
    leadMissingReason: LEAD_MISSING_REASON,
  },
  play: async ({ args }) => {
    await waitFor(() => expect(screen.getByText(args.disabledReason as string)).toBeVisible(), {
      timeout: 3000,
    })
    expect(screen.queryByText(args.leadMissingReason as string)).not.toBeInTheDocument()
  },
}
