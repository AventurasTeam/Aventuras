import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { type StorySettingsSessionPatch } from '@/lib/actions'
import type { StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'

import { flaggedFieldsFor } from './flagged-fields'
import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
  useStorySettingsSection,
} from './save-session'
import { StorySettingsDialogs, StorySettingsSaveBar } from './save-session-chrome'

const DUP_LABELS_ON_TAB = t('storySettings:save.invalidOnTab', {
  tab: t('storySettings:tabs.generation'),
  reason: 'dup labels',
})

/**
 * `useStorySettingsSection` fixture: visible controls in place of a real settings field, so
 * a play function can drive the surface dirty, invalid or flagged without touching state.
 */
function FixtureSection() {
  const [state, setState] = useState<{
    dirtyFields: string[]
    invalidReason?: string
    flagged?: boolean
  }>({ dirtyFields: [] })
  useStorySettingsSection({
    id: 'fixture',
    tab: 'generation',
    dirtyFields: state.dirtyFields,
    invalidReason: state.invalidReason,
    flaggedFields: state.flagged ? flaggedFieldsFor(['composerWrapPov']) : undefined,
    getPatch: (): Partial<StorySettings> =>
      state.invalidReason != null ? { suggestionCategories: [] } : { suggestionCount: 5 },
    reset: () => setState({ dirtyFields: [] }),
  })
  return (
    <View className="flex-row gap-2 p-3">
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setState({ dirtyFields: ['suggestion count'] })}
      >
        <Text>Make dirty</Text>
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onPress={() =>
          setState({ dirtyFields: ['suggestion categories'], invalidReason: 'dup labels' })
        }
      >
        <Text>Make invalid</Text>
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setState({ dirtyFields: ['wrap point of view'], flagged: true })}
      >
        <Text>Make flagged</Text>
      </Button>
    </View>
  )
}

/**
 * Stands in for the surface's back arrow / window-close guard, which drive
 * `requestLeave` from outside this component in production.
 */
function RequestLeaveButton({ onProceed }: { onProceed: () => void }) {
  const session = useStorySettingsSaveSession()
  return (
    <Button variant="secondary" size="sm" onPress={() => session.requestLeave(onProceed)}>
      <Text>Request leave</Text>
    </Button>
  )
}

type HarnessProps = {
  onCommit: (patch: StorySettingsSessionPatch) => Promise<unknown>
  onProceed: () => void
  enabled?: boolean
  blocked?: boolean
  confirmFlagged?: boolean
}

function Harness({
  onCommit,
  onProceed,
  enabled = true,
  blocked = false,
  confirmFlagged = false,
}: HarnessProps) {
  const disabledReason = blocked ? t('generationGate.inFlight') : undefined
  return (
    <View className="rounded-md border border-border bg-bg-base" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={onCommit} confirmFlagged={confirmFlagged}>
        <FixtureSection />
        <RequestLeaveButton onProceed={onProceed} />
        <StorySettingsSaveBar enabled={enabled} blocked={blocked} disabledReason={disabledReason} />
        <StorySettingsDialogs blocked={blocked} disabledReason={disabledReason} />
      </StorySettingsSaveSessionProvider>
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/StorySettings/SaveSessionChrome',
  component: Harness,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Harness>

export const CleanStaysHidden: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async () => {
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const DirtyMountsSaveBar: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeInTheDocument()
    expect(screen.getByText(/suggestion count/)).toBeInTheDocument()
  },
}

export const InvalidDisablesSaveBarSave: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Make invalid' }))
    expect(await screen.findByLabelText(DUP_LABELS_ON_TAB)).toBeInTheDocument()
    const save = screen.getByRole('button', { name: /^Save/ })
    expect(save).toBeDisabled()
  },
}

export const ValidCommitsThroughSaveBar: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    const save = await screen.findByRole('button', { name: /^Save/ })
    await userEvent.click(save)
    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({ settings: { suggestionCount: 5 } }),
    )
  },
}

export const SaveBarDiscardThrowsAwayTheDraft: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    const discard = await screen.findByRole('button', { name: 'Discard' })

    await userEvent.click(discard)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument(),
    )
    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const DisabledSuppressesTheSaveShortcut: Story = {
  args: { onCommit: fn(), onProceed: fn(), enabled: false },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    await screen.findByRole('button', { name: 'Discard' })

    await userEvent.keyboard('{Meta>}s{/Meta}')

    expect(args.onCommit).not.toHaveBeenCalled()
  },
}

export const HardGateDisablesEverySavePath: Story = {
  args: { onCommit: fn(), onProceed: fn(), blocked: true },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    expect(await screen.findByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(screen.getByLabelText(t('generationGate.inFlight'))).toBeInTheDocument()

    await userEvent.keyboard('{Meta>}s{/Meta}')
    expect(args.onCommit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Discard' })).not.toBeDisabled()
    expect(dialog).toHaveTextContent(t('generationGate.inFlight'))
  },
}

export const NoPendingLeaveStaysClosed: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async () => {
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const OpensOnDirtyLeaveRequest: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(args.onProceed).not.toHaveBeenCalled()
  },
}

export const CleanLeaveProceedsImmediately: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    await waitFor(() => expect(args.onProceed).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const CancelKeepsTheSession: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.onProceed).not.toHaveBeenCalled()
    // Still dirty — cancel didn't discard it.
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  },
}

export const DiscardResetsAndProceeds: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(args.onProceed).toHaveBeenCalledTimes(1))
    expect(args.onCommit).not.toHaveBeenCalled()
    // The section reset, so the surface is clean again: no save bar left.
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  },
}

export const SaveCommitsAndProceeds: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make dirty' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(args.onCommit).toHaveBeenCalledWith({ settings: { suggestionCount: 5 } }),
    )
    expect(args.onProceed).toHaveBeenCalledTimes(1)
  },
}

/**
 * Mirrors `unsaved-changes-dialog.stories.tsx`'s `InvalidDraft` story: the
 * reason must be inside the dialog's `aria-describedby` target, not orphaned.
 */
export const InvalidDisablesDialogSaveAndShowsReason: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Make invalid' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')

    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const reasonText = within(dialog).getByText(DUP_LABELS_ON_TAB)
    expect(reasonText).toBeInTheDocument()
    const describedById = dialog.getAttribute('aria-describedby')
    expect(describedById).toBeTruthy()
    const describedByElement = document.getElementById(describedById!)
    expect(describedByElement).toBeTruthy()
    expect(describedByElement).toContainElement(reasonText)
  },
}

export const InvalidStillLetsDiscardProceed: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make invalid' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(args.onProceed).toHaveBeenCalledTimes(1))
    expect(args.onCommit).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  },
}

export const InvalidStillLetsCancelProceed: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Make invalid' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(args.onProceed).not.toHaveBeenCalled()
    expect(args.onCommit).not.toHaveBeenCalled()
    // Still dirty and still invalid — cancel didn't touch the draft.
    expect(screen.getByLabelText(DUP_LABELS_ON_TAB)).toBeInTheDocument()
  },
}

export const InvalidReasonNamesTheTab: Story = {
  args: { onCommit: fn(async () => {}), onProceed: fn() },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Make invalid' }))
    const bar = await screen.findByTestId('save-bar')
    await waitFor(() => expect(within(bar).getByLabelText(DUP_LABELS_ON_TAB)).toBeInTheDocument())
    expect(DUP_LABELS_ON_TAB).toContain(t('storySettings:tabs.generation'))
  },
}

export const FlaggedFieldAsksBeforeCommit: Story = {
  args: { onCommit: fn(async () => {}), onProceed: fn(), confirmFlagged: true },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Make flagged' }))
    const bar = await screen.findByTestId('save-bar')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('storySettings:confirm.title'))
    expect(args.onCommit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('confirm-save-anyway'))
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
  },
}

export const LeaveSaveHandsOffToTheConfirmation: Story = {
  args: { onCommit: fn(async () => {}), onProceed: fn(), confirmFlagged: true },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Make flagged' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const leave = await screen.findByRole('alertdialog')
    await userEvent.click(within(leave).getByRole('button', { name: 'Save' }))

    // `hidden`: an open modal marks the rest aria-hidden, so a stacked leave
    // dialog would drop out of the default query and pass unseen.
    await waitFor(() => {
      const dialogs = screen.getAllByRole('alertdialog', { hidden: true })
      expect(dialogs).toHaveLength(1)
      expect(dialogs[0]).toHaveTextContent(t('storySettings:confirm.title'))
    })
    expect(args.onCommit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByTestId('confirm-save-anyway'))
    await waitFor(() => expect(args.onProceed).toHaveBeenCalledTimes(1))
    expect(args.onCommit).toHaveBeenCalledTimes(1)
  },
}

let releaseCommit: (() => void) | undefined

export const ConfirmationHoldsThroughTheCommit: Story = {
  args: {
    onCommit: fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCommit = resolve
        }),
    ),
    onProceed: fn(),
    confirmFlagged: true,
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Make flagged' }))
    const bar = await screen.findByTestId('save-bar')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('storySettings:generation.field.composerWrapPov'))
    expect(dialog).toHaveTextContent(t('storySettings:confirm.consequence.composerWrapPov'))
    await userEvent.click(screen.getByTestId('confirm-save-anyway'))
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByTestId('confirm-save-anyway')).toBeDisabled())
    expect(screen.getByRole('button', { name: t('cancel') })).toBeDisabled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    releaseCommit?.()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument())
  },
}

export const ConfirmationCancelKeepsTheDraft: Story = {
  args: { onCommit: fn(async () => {}), onProceed: fn(), confirmFlagged: true },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Make flagged' }))
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const leave = await screen.findByRole('alertdialog')
    await userEvent.click(within(leave).getByRole('button', { name: 'Save' }))
    await screen.findByTestId('confirm-save-anyway')
    await userEvent.click(screen.getByRole('button', { name: t('cancel') }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { hidden: true })).not.toBeInTheDocument(),
    )
    expect(args.onCommit).not.toHaveBeenCalled()
    expect(args.onProceed).not.toHaveBeenCalled()
    expect(screen.getByTestId('save-bar')).toBeInTheDocument()
  },
}
