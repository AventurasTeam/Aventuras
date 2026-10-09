import { useCallback, useMemo, useRef, useState } from 'react'

import { leadRejectionText } from '@/components/world/world-copy'
import { setStoryLead } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

import type { PeekLeadControl } from './peek-model'

const ctx = { db, runInTransaction }

function reportSetLeadFailure(storyId: string | null, entityId: string, error: string): void {
  logger.error('reader.peek_set_lead_failed', { storyId, entityId, error })
  toast.error(t('world:lead.failed'))
}

/**
 * The peek's `Set as lead`. No toast on success: the reader re-anchoring is the feedback
 * (reader-composer.md → Peek drawer — lead affordance for characters).
 */
export function useSetLead(storyId: string | null): {
  pending: boolean
  setLead: (entityId: string) => void
} {
  const [pending, setPending] = useState(false)
  // A ref, not `pending`: a second press can land before the pending render.
  const inFlight = useRef(false)

  const setLead = useCallback(
    (entityId: string) => {
      if (inFlight.current) return
      // The reader's story-id read can fail; a press then must not vanish silently.
      if (storyId == null) {
        reportSetLeadFailure(null, entityId, 'no story id')
        return
      }
      inFlight.current = true
      setPending(true)
      void setStoryLead(storyId, entityId, ctx)
        .then(
          (result) => {
            if (result.status === 'rejected') toast.error(leadRejectionText(result.code))
          },
          (error: unknown) =>
            reportSetLeadFailure(
              storyId,
              entityId,
              error instanceof Error ? error.message : String(error),
            ),
        )
        .finally(() => {
          inFlight.current = false
          setPending(false)
        })
    },
    [storyId],
  )

  return { pending, setLead }
}

/** The head's lead control as both peek hosts build it. */
export function usePeekLeadControl(
  storyId: string | null,
  blocked: boolean,
  blockedReason: string | undefined,
): PeekLeadControl {
  const { pending, setLead } = useSetLead(storyId)
  return useMemo(
    () => ({ blocked, blockedReason, pending, onSetLead: setLead }),
    [blocked, blockedReason, pending, setLead],
  )
}
