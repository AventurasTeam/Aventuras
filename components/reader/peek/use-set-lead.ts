import { useCallback, useMemo, useRef, useState } from 'react'

import { leadRejectionText } from '@/components/world/world-copy'
import { setBranchLead } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import type { PeekLeadControl } from './peek-model'

const ctx = { db, runInTransaction }

function reportSetLeadFailure(branchId: string | null, entityId: string, error: string): void {
  logger.error('reader.peek_set_lead_failed', { branchId, entityId, error })
  toast.error(t('world:lead.failed'))
}

/**
 * The peek's `Set as lead`, on the branch the host reads. No toast on success: the reader
 * re-anchoring is the feedback (reader-composer.md → Peek drawer — lead affordance for characters).
 */
export function useSetLead(branchId: string | null): {
  pending: boolean
  setLead: (entityId: string) => void
} {
  const [pending, setPending] = useState(false)
  // A ref, not `pending`: a second press can land before the pending render.
  const inFlight = useRef(false)

  const setLead = useCallback(
    (entityId: string) => {
      if (inFlight.current) return
      // A press with no branch to write must not vanish silently.
      if (branchId == null) {
        reportSetLeadFailure(null, entityId, 'no branch id')
        return
      }
      inFlight.current = true
      setPending(true)
      void setBranchLead(branchId, entityId, ctx)
        .then(
          (result) => {
            if (result.status === 'rejected') toast.error(leadRejectionText(result.code))
          },
          (error: unknown) =>
            reportSetLeadFailure(
              branchId,
              entityId,
              error instanceof Error ? error.message : String(error),
            ),
        )
        .finally(() => {
          inFlight.current = false
          setPending(false)
        })
    },
    [branchId],
  )

  return { pending, setLead }
}

export function usePeekLeadControl(
  branchId: string | null,
  blocked: boolean,
  blockedReason: string | undefined,
): PeekLeadControl {
  const { pending, setLead } = useSetLead(branchId)
  return useMemo(
    () => ({ blocked, blockedReason, pending, onSetLead: setLead }),
    [blocked, blockedReason, pending, setLead],
  )
}
