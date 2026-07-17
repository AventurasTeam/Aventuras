import { useEffect, useState } from 'react'

import { db } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { RecoveryReport } from '@/lib/pipeline'
import { loadRecoveryStoryNames, type RecoveryStoryNames } from '@/lib/recovery'
import { recoveryReportStore } from '@/lib/stores'

import { CrashRecoveryModal } from './crash-recovery-modal'

export function CrashRecoveryModalHost() {
  const [report, setReport] = useState<RecoveryReport | null>(null)
  const [storyNames, setStoryNames] = useState<RecoveryStoryNames>({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const claimed = recoveryReportStore.claim()
    if (claimed === null) return

    setReport(claimed)
    void loadRecoveryStoryNames(claimed, db)
      .then((names) => {
        if (!cancelled) setStoryNames(names)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        logger.warn('bootstrap.recovery_story_names_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (report === null) return null

  return (
    <CrashRecoveryModal
      open={ready}
      report={report}
      storyNames={storyNames}
      onAcknowledge={() => {
        recoveryReportStore.acknowledge()
        setReport(null)
        setReady(false)
      }}
    />
  )
}
