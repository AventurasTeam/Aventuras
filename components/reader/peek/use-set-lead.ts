import { useCallback, useRef, useState } from 'react'

import { leadRejectionText } from '@/components/world/world-copy'
import { setStoryLead } from '@/lib/actions'
import { db, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

const ctx = { db, runInTransaction }

/**
 * The peek's `Set as lead` (C5). No toast on success: the reader re-anchoring is the feedback
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
      if (storyId == null || inFlight.current) return
      inFlight.current = true
      setPending(true)
      void setStoryLead(storyId, entityId, ctx)
        .then(
          (result) => {
            if (result.status === 'rejected') toast.error(leadRejectionText(result.code))
          },
          (error: unknown) => {
            logger.error('reader.peek_set_lead_failed', {
              storyId,
              entityId,
              error: error instanceof Error ? error.message : String(error),
            })
            toast.error(t('world:lead.failed'))
          },
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
