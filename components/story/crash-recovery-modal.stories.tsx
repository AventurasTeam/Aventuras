import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent } from 'storybook/test'

import type { RecoveryReport } from '@/lib/pipeline'

import { CrashRecoveryModal } from './crash-recovery-modal'

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

export const NamedPerTurn: Story = {
  args: {
    report: singleReport,
    storyNames: { s1: 'Mornstone' },
  },
  play: async ({ args }) => {
    expect(screen.getByText(/detected in Mornstone/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
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
