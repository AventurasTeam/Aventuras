import { createStore } from 'zustand/vanilla'

import type { RecoveryReport } from '@/lib/pipeline'

export type RecoveryReportSnapshot = {
  pendingRecoveryReport: RecoveryReport | null
  activeRecoveryReport: RecoveryReport | null
}

const INITIAL_SNAPSHOT: RecoveryReportSnapshot = {
  pendingRecoveryReport: null,
  activeRecoveryReport: null,
}

const store = createStore<RecoveryReportSnapshot>()(() => INITIAL_SNAPSHOT)

export const recoveryReportStore = {
  publish: (report: RecoveryReport): void => {
    if (report.reversed.length === 0) return
    store.setState({ pendingRecoveryReport: report })
  },
  claim: (): RecoveryReport | null => {
    const snapshot = store.getState()
    if (snapshot.activeRecoveryReport) return snapshot.activeRecoveryReport
    if (!snapshot.pendingRecoveryReport) return null

    store.setState({
      pendingRecoveryReport: null,
      activeRecoveryReport: snapshot.pendingRecoveryReport,
    })
    return snapshot.pendingRecoveryReport
  },
  acknowledge: (): void => store.setState({ activeRecoveryReport: null }),
  getSnapshot: (): RecoveryReportSnapshot => store.getState(),
  __reset: (): void => store.setState(INITIAL_SNAPSHOT, true),
}
