import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { StrictMode, useEffect, useState } from 'react'
import { expect, fn, screen, spyOn, userEvent, waitFor } from 'storybook/test'

import { logger } from '@/lib/diagnostics'
import type { RecoveryReport } from '@/lib/pipeline'
import { recoveryReportStore } from '@/lib/stores'

import { CrashRecoveryModal } from './crash-recovery-modal'
import { CrashRecoveryModalHost } from './crash-recovery-modal-host'

const singleReport: RecoveryReport = {
  reversed: [
    {
      runId: 'run-per-turn',
      kind: 'per-turn',
      actionId: 'action-per-turn',
      storyId: 's1',
      deltas: 2,
    },
  ],
  failures: [],
}

const multiReport: RecoveryReport = {
  reversed: [
    ...singleReport.reversed,
    {
      runId: 'run-chapter-close',
      kind: 'chapter-close',
      actionId: 'action-chapter-close',
      storyId: null,
      deltas: 1,
    },
  ],
  failures: [],
}

const meta: Meta<typeof CrashRecoveryModal> = {
  title: 'Compounds/Story/CrashRecoveryModal',
  component: CrashRecoveryModal,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    onAcknowledge: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

function StrictModeReplayHost() {
  const [mountKey, setMountKey] = useState(0)
  useEffect(() => setMountKey(1), [])
  return <CrashRecoveryModalHost key={mountKey} />
}

export const NamedPerTurn: Story = {
  args: {
    report: singleReport,
    storyNames: { s1: 'Mornstone' },
  },
  play: async ({ args }) => {
    expect(screen.getByText(/detected in Mornstone/)).toBeInTheDocument()
    const ok = screen.getByRole('button', { name: 'OK' })
    expect(ok).toHaveFocus()
    await userEvent.click(ok)
    expect(args.onAcknowledge).toHaveBeenCalledTimes(1)
  },
}

export const MultipleRuns: Story = {
  args: {
    report: multiReport,
    storyNames: { s1: 'Mornstone' },
  },
  play: async () => {
    const description = screen.getByText(/chapter-close pass was reverted/)
    expect(description.textContent).toContain('last AI response was reverted')
  },
}

export const MissingStoryName: Story = {
  args: {
    report: singleReport,
    storyNames: {},
  },
  play: async () => {
    const description = screen.getByText(/An interrupted shutdown was detected\./)
    expect(description.textContent?.startsWith('An interrupted shutdown was detected.')).toBe(true)
  },
}

export const HostStrictModeLifecycle: Story = {
  args: {
    report: singleReport,
    storyNames: {},
  },
  beforeEach: () => {
    recoveryReportStore.__reset()
    recoveryReportStore.publish(singleReport)
    const warnSpy = spyOn(logger, 'warn')
    const claimSpy = spyOn(recoveryReportStore, 'claim')
    return () => {
      warnSpy.mockRestore()
      claimSpy.mockRestore()
      recoveryReportStore.__reset()
    }
  },
  render: () => (
    <StrictMode>
      <StrictModeReplayHost />
    </StrictMode>
  ),
  play: async () => {
    const copy =
      'An interrupted shutdown was detected. Your last AI response was reverted to keep the story consistent.'
    const notice = await screen.findByText(copy)

    expect(screen.getAllByText(copy)).toHaveLength(1)
    expect(recoveryReportStore.claim).toHaveBeenCalledTimes(3)
    expect(recoveryReportStore.getSnapshot().activeRecoveryReport).toBe(singleReport)
    await waitFor(() => {
      expect(logger.warn).toHaveBeenCalledTimes(1)
    })
    expect(logger.warn).toHaveBeenCalledWith('bootstrap.recovery_story_names_failed', {
      error: expect.stringContaining('Failed query'),
    })

    await userEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(recoveryReportStore.getSnapshot().activeRecoveryReport).toBeNull()
    expect(notice).not.toBeInTheDocument()
  },
}
