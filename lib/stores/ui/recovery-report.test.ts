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

  it('ignores reports without reversed runs even when recovery failures exist', () => {
    recoveryReportStore.publish({
      reversed: [],
      failures: [{ runId: 'r-failed', kind: 'per-turn', error: new Error('failed') }],
    })

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
