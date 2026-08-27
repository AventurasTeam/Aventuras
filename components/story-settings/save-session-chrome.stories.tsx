import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'

import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
  useStorySettingsSection,
} from './save-session'
import { StorySettingsLeaveDialog, StorySettingsSaveBar } from './save-session-chrome'

/**
 * `useStorySettingsSection` fixture with two visible controls in place of a
 * real settings field, so a play function can drive the surface dirty or
 * invalid without reaching into React state.
 */
function FixtureSection() {
  const [state, setState] = useState<{ dirtyFields: string[]; invalidReason?: string }>({
    dirtyFields: [],
  })
  useStorySettingsSection({
    id: 'fixture',
    tab: 'generation',
    dirtyFields: state.dirtyFields,
    invalidReason: state.invalidReason,
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
  onCommit: (patch: Partial<StorySettings>) => Promise<unknown>
  onProceed: () => void
  enabled?: boolean
  blocked?: boolean
}

function Harness({ onCommit, onProceed, enabled = true, blocked = false }: HarnessProps) {
  const disabledReason = blocked ? t('generationGate.inFlight') : undefined
  return (
    <View className="rounded-md border border-border bg-bg-base" style={{ width: 720 }}>
      <StorySettingsSaveSessionProvider onCommit={onCommit}>
        <FixtureSection />
        <RequestLeaveButton onProceed={onProceed} />
        <StorySettingsSaveBar enabled={enabled} blocked={blocked} disabledReason={disabledReason} />
        <StorySettingsLeaveDialog blocked={blocked} disabledReason={disabledReason} />
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
    expect(screen.getByLabelText(/Undo doesn't reach story settings/)).toBeInTheDocument()
  },
}

export const InvalidDisablesSaveBarSave: Story = {
  args: { onCommit: fn(), onProceed: fn() },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Make invalid' }))
    expect(await screen.findByLabelText('dup labels')).toBeInTheDocument()
    // One notice slot, ranked: the blocking reason outranks the standing
    // no-undo note, which would otherwise hide why Save went dead.
    expect(screen.queryByLabelText(/Undo doesn't reach/)).not.toBeInTheDocument()
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
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith({ suggestionCount: 5 }))
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
    expect(screen.getByLabelText('Generation is in flight. Cancel to edit.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Undo doesn't reach/)).not.toBeInTheDocument()

    await userEvent.keyboard('{Meta>}s{/Meta}')
    expect(args.onCommit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Discard' })).not.toBeDisabled()
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

    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith({ suggestionCount: 5 }))
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

    const reasonText = within(dialog).getByText('dup labels')
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
    expect(screen.getByLabelText('dup labels')).toBeInTheDocument()
  },
}
