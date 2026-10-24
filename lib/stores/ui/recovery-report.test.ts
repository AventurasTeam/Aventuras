import { beforeEach, describe, expect, it } from 'vitest'

import type { BootRecoveryReport } from '@/lib/pipeline'

import { recoveryReportStore } from './recovery-report'

const reversedReport: BootRecoveryReport = {
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
  heldStoryIds: [],
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
          refusal: null,
        },
      ],
      heldStoryIds: null,
    }

    recoveryReportStore.publish(failureReport)

    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport).toBe(failureReport)
  })

  // A reset that threw or never ran can hold a branch with no orphan to report.
  it('publishes a report that only has a held story', () => {
    const heldReport = { reversed: [], failures: [], heldStoryIds: ['s1'] }

    recoveryReportStore.publish(heldReport)

    expect(recoveryReportStore.getSnapshot().pendingRecoveryReport).toBe(heldReport)
  })

  it('ignores a report with nothing reversed, failed or held', () => {
    recoveryReportStore.publish({ reversed: [], failures: [], heldStoryIds: [] })
    recoveryReportStore.publish({ reversed: [], failures: [], heldStoryIds: null })

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
