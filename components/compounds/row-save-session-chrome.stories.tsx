import { zodResolver } from '@hookform/resolvers/zod'
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import {
  useRowSaveSession,
  type RowCommitResult,
  type RowSaveConfirm,
} from '@/hooks/use-row-save-session'
import { t } from '@/lib/i18n'

import { RowConfirmDialog, RowLeaveDialog, RowSaveBar } from './row-save-session-chrome'

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 5000 }

type Draft = { title: string }
const VALUES: Draft = { title: 'Port Vellis' }
const resolver = zodResolver(z.object({ title: z.string() }))
const ASK: RowSaveConfirm = {
  title: 'Retire Port Vellis and the places inside it?',
  lines: ['They are retired with the same reason.'],
  items: ['Harbor Market'],
  confirmLabel: 'Retire',
}

type HarnessProps = {
  commit: (draft: Draft) => Promise<RowCommitResult>
  onProceed: () => void
  /** Every answer the confirm dialog hands the session, before the session sees it. */
  onAnswer: (outcome: 'save' | 'cancel') => void
}

/** A row session that asks before every Save; the buttons stand in for an edit and a row switch. */
function Harness({ commit, onProceed, onAnswer }: HarnessProps) {
  const session = useRowSaveSession<Draft>({
    rowKey: 'row_port_vellis',
    values: VALUES,
    resolver,
    fieldLabel: (field) => field,
    issueText: (message) => message,
    failureText: () => 'Save failed.',
    commit,
    confirmBeforeCommit: () => ASK,
  })
  const answered = {
    ...session,
    resolveConfirm: (outcome: 'save' | 'cancel') => {
      onAnswer(outcome)
      session.resolveConfirm(outcome)
    },
  }
  return (
    <View className="rounded-md border border-border bg-bg-base" style={{ width: 640 }}>
      <View className="flex-row gap-2 p-3">
        <Button
          variant="secondary"
          size="sm"
          onPress={() =>
            session.form.setValue('title', 'Port Vellis (retired)', { shouldDirty: true })
          }
        >
          <Text>Make dirty</Text>
        </Button>
        <Button variant="secondary" size="sm" onPress={() => session.requestLeave(onProceed)}>
          <Text>Request leave</Text>
        </Button>
      </View>
      <RowSaveBar session={session} />
      <RowLeaveDialog session={session} />
      <RowConfirmDialog session={answered} />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/RowSaveSessionChrome',
  component: Harness,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof Harness>

/** Dirty, a leave, and Save in its dialog: the Save parks behind its question. */
async function parkFromTheLeaveDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Make dirty' }, WAIT))
  await screen.findByTestId('save-bar', undefined, WAIT)
  await userEvent.click(screen.getByRole('button', { name: 'Request leave' }))
  const leave = await screen.findByRole('alertdialog', undefined, WAIT)
  expect(leave).toHaveTextContent(t('unsavedChanges.title'))
  await userEvent.click(within(leave).getByRole('button', { name: t('unsavedChanges.save') }))
  await screen.findByRole('button', { name: ASK.confirmLabel }, WAIT)
}

/** Only the confirm is up; `hidden` because a modal marks a stacked one aria-hidden. */
async function expectOnlyTheConfirm() {
  await waitFor(() => {
    const dialogs = screen.getAllByRole('alertdialog', { hidden: true })
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]).toHaveTextContent(ASK.title)
  }, WAIT)
}

/** save-sessions.md → Navigate-away guard: the leave dialog yields to the Save's question. */
export const LeaveDialogYieldsToTheConfirm: Story = {
  args: {
    commit: fn(async (): Promise<RowCommitResult> => ({ status: 'ok' })),
    onProceed: fn(),
    onAnswer: fn(),
  },
  play: async ({ args }) => {
    await parkFromTheLeaveDialog()
    await expectOnlyTheConfirm()
    expect(args.commit).not.toHaveBeenCalled()

    // Cancel drops the leave that was waiting on the Save, so no dialog comes back.
    await userEvent.click(screen.getByRole('button', { name: t('cancel') }))
    await waitFor(
      () => expect(screen.queryByRole('alertdialog', { hidden: true })).not.toBeInTheDocument(),
      WAIT,
    )
    expect(args.onProceed).not.toHaveBeenCalled()
    expect(args.commit).not.toHaveBeenCalled()
    expect(screen.getByTestId('save-bar')).toBeInTheDocument()
  },
}

let releaseCommit: ((result: RowCommitResult) => void) | undefined

/** The question stays up, inert, until the confirmed write lands; the leave then runs. */
export const ConfirmHoldsThroughTheWrite: Story = {
  args: {
    commit: fn(
      () =>
        new Promise<RowCommitResult>((resolve) => {
          releaseCommit = resolve
        }),
    ),
    onProceed: fn(),
    onAnswer: fn(),
  },
  play: async ({ args }) => {
    await parkFromTheLeaveDialog()
    await userEvent.click(screen.getByRole('button', { name: ASK.confirmLabel }))
    await waitFor(() => expect(args.commit).toHaveBeenCalledTimes(1), WAIT)

    await waitFor(
      () => expect(screen.getByRole('button', { name: ASK.confirmLabel })).toBeDisabled(),
      WAIT,
    )
    const confirm = screen.getByRole('alertdialog')
    expect(within(confirm).getByRole('button', { name: t('cancel') })).toBeDisabled()
    await expectOnlyTheConfirm()

    await userEvent.keyboard('{Escape}')
    await expectOnlyTheConfirm()
    expect(args.onAnswer).toHaveBeenCalledTimes(1)
    expect(args.onAnswer).toHaveBeenCalledWith('save')

    releaseCommit?.({ status: 'ok' })
    await waitFor(() => expect(args.onProceed).toHaveBeenCalledTimes(1), WAIT)
    await waitFor(
      () => expect(screen.queryByRole('alertdialog', { hidden: true })).not.toBeInTheDocument(),
      WAIT,
    )
  },
}
