import { beforeEach, describe, expect, it } from 'vitest'

import type { RecoveryReport } from '@/lib/pipeline'

import { recoveryReportStore } from './recovery-report'

const reversedReport: RecoveryReport = {
  reversed: [
    {
      runId: 'r1',
      kind: 'per-turn',
      actionId: 'a1',
      storyId: 's1',
      deltas: 1,
    },
  ],
  failures: [],
}

describe('recoveryReportStore', () => {
  beforeEach(() => recoveryReportStore.__reset())

  // A failure is the degradation worth reporting: the orphan's writes stay on disk
  // and a classifier orphan leaves its branch held back from the cadence.
  it('publishes a report that only has failures', () => {
    const failureReport = {
      reversed: [],
      failures: [
        {
          runId: 'r-failed',
          kind: 'periodic-classifier',
          actionId: 'act_failed',
          storyId: 's1',
          error: new Error('failed'),
        },
      ],
    }

    recoveryReportStore.publish(failureReport)

    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport).toBe(failureReport)
  })

  it('ignores a report with nothing reversed and nothing failed', () => {
    recoveryReportStore.publish({ reversed: [], failures: [] })

    expect(recoveryReportStore.getSnapshot()).toEqual({
      pendingRecoveryReport: null,
      activeRecoveryReport: null,
    })
  })

  it('claims a pending report replay-safely until it is acknowledged', () => {
    recoveryReportStore.publish(reversedReport)

    expect(recoveryReportStore.claim()).toBe(reversedReport)
    expect(recoveryReportStore.claim()).toBe(reversedReport)
    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport).toBeNull()

    recoveryReportStore.acknowledge()

    expect(recoveryReportStore.claim()).toBeNull()
  })
})
