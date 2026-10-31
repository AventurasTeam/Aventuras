import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { StrictMode, useEffect, useState } from 'react'
import { expect, fn, screen, spyOn, userEvent, waitFor } from 'storybook/test'

import { logger } from '@/lib/diagnostics'
import type { BootRecoveryReport } from '@/lib/pipeline'
import { recoveryReportStore } from '@/lib/stores'

import { CrashRecoveryModal } from './crash-recovery-modal'
import { CrashRecoveryModalHost } from './crash-recovery-modal-host'

const singleReport: BootRecoveryReport = {
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
  heldStoryIds: [],
}

const multiReport: BootRecoveryReport = {
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
  heldStoryIds: [],
}

// Nothing reversed (orphan's writes survive, branch held): must not title itself "Story recovered".
const degradedReport: BootRecoveryReport = {
  reversed: [],
  failures: [
    {
      runId: 'run-classifier',
      kind: 'periodic-classifier',
      actionId: 'action-classifier',
      storyId: 's1',
      error: new Error('could not reverse'),
      refusal: null,
    },
  ],
  heldStoryIds: ['s1'],
}

// Every boot refuses it again, so the copy must not promise that restarting retries.
const refusedReport: BootRecoveryReport = {
  reversed: [],
  failures: [{ ...degradedReport.failures[0], refusal: 'write-back' }],
  heldStoryIds: ['s1'],
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

export const BranchHeld: Story = {
  args: {
    report: degradedReport,
    storyNames: { s1: 'Mornstone' },
  },
  play: async () => {
    expect(screen.getByText('Recovery incomplete')).toBeInTheDocument()
    const description = screen.getByText(/Its branch can't take turns until it is/)
    expect(description.textContent).toContain('Mornstone')
    expect(description.textContent).toContain('restarting the app retries automatically')
  },
}

export const BranchHeldRefused: Story = {
  args: {
    report: refusedReport,
    storyNames: { s1: 'Mornstone' },
  },
  play: async () => {
    expect(screen.getByText('Recovery incomplete')).toBeInTheDocument()
    const description = screen.getByText(/Its branch can't take turns —/)
    expect(description.textContent).toContain('Mornstone')
    expect(description.textContent).toContain('your story content is intact')
    expect(description.textContent).not.toContain('restart')
  },
}

/** The pass itself threw: no orphan was read, so there's no story to name. */
export const PassFailed: Story = {
  args: {
    report: { reversed: [], failures: [], heldStoryIds: [], passFailed: true },
    storyNames: {},
  },
  play: async () => {
    expect(screen.getByText('Recovery incomplete')).toBeInTheDocument()
    const description = screen.getByText(/couldn't check for updates left unfinished/)
    expect(description.textContent).toContain('Restarting the app retries automatically')
    expect(description.textContent).not.toContain('intact')
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
