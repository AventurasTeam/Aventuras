import { useCallback, useEffect, useMemo, useState } from 'react'

import type { EditResult } from '@/components/reader/reader-document-types'
import {
  decorateWorldTime,
  type WorldTimeDecoration,
} from '@/components/reader/worldtime-decoration'
import { updateEntryWorldTime, type DbCtx } from '@/lib/actions'
import {
  DEFAULT_CALENDAR_ID,
  getCalendar,
  type CalendarSystem,
  type TierTuple,
} from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { toast } from '@/lib/toast'

export type WorldTimeEditing = {
  /** Registry-resolved with the default applied; null hides/inerts every footer. */
  calendar: CalendarSystem | null
  worldTimeOrigin: TierTuple | null
  /** Side table keyed by entry id, so row identity — and ReaderRow's memo — is untouched. */
  worldTimeDecorations: Record<string, WorldTimeDecoration>
  /** The entry whose host Sheet is open, with the decoration it was opened on. */
  timeEdit: { entryId: string; decoration: WorldTimeDecoration } | null
  editWorldTime: (entryId: string, next: number) => Promise<EditResult>
  requestEditWorldTime: (entryId: string) => Promise<void>
  closeTimeEdit: () => void
}

/**
 * Host half of the per-entry world-time footer (reader-composer.md → Per-entry
 * world-time footer): label decoration for the document, plus the phone tier's
 * bridged-out Sheet. `entries` MUST be in ascending position order — the walk
 * says so, and out-of-order input mis-flags silently.
 */
export function useWorldTimeEditing(
  branchId: string,
  entries: StoryEntry[],
  calendarSystemId: string | undefined,
  origin: TierTuple | undefined,
  ctx: DbCtx,
): WorldTimeEditing {
  // Unknown ids resolve to the default, mirroring the wizard's own fallback.
  const calendar = useMemo(
    () =>
      calendarSystemId != null
        ? (getCalendar(calendarSystemId) ?? getCalendar(DEFAULT_CALENDAR_ID) ?? null)
        : null,
    [calendarSystemId],
  )
  const worldTimeOrigin = origin ?? null
  // One walk per entries-collection identity. A side table leaves row identity
  // untouched, so ReaderRow's memo still short-circuits unchanged rows.
  const worldTimeDecorations = useMemo(
    () =>
      calendar != null && worldTimeOrigin != null
        ? decorateWorldTime(entries, calendar, worldTimeOrigin)
        : {},
    [entries, calendar, worldTimeOrigin],
  )

  const [timeEditId, setTimeEditId] = useState<string | null>(null)

  // Carries failure in the result channel, never the rejection channel: there is
  // no global unhandled-rejection handler, and across the expo-dom bridge a
  // rejected promise is unobservable — a thrown write would leave Save inert.
  const editWorldTime = useCallback(
    async (entryId: string, next: number): Promise<EditResult> => {
      try {
        const result = await updateEntryWorldTime(branchId, entryId, next, ctx)
        if (result.status !== 'ok') {
          logger.warn('action_layer.world_time_edit_rejected', {
            branchId,
            entryId,
            reason: result.reason,
            code: result.code,
          })
          toast.error(t('reader:worldTimeEdit.failed'))
          return { ok: false }
        }
        return { ok: true }
      } catch (err) {
        logger.error('action_layer.world_time_edit_failed', {
          branchId,
          entryId,
          error: err instanceof Error ? err.message : String(err),
        })
        toast.error(t('reader:worldTimeEdit.failed'))
        return { ok: false }
      }
    },
    [branchId, ctx],
  )

  // Presented whatever the host's own tier is: EntryCard's useTier() measures
  // the reader document, not the device, so it owns the fork.
  const requestEditWorldTime = useCallback(async (entryId: string) => {
    setTimeEditId(entryId)
  }, [])
  const closeTimeEdit = useCallback(() => setTimeEditId(null), [])

  const decoration = timeEditId != null ? worldTimeDecorations[timeEditId] : undefined
  // An undo, a rollback or a branch switch can drop the entry under an open
  // sheet. Dropping the id with it keeps a later redo from resurrecting the
  // overlay on an entry the user has since navigated away from.
  useEffect(() => {
    if (timeEditId != null && decoration == null) setTimeEditId(null)
  }, [timeEditId, decoration])

  return {
    calendar,
    worldTimeOrigin,
    worldTimeDecorations,
    timeEdit: timeEditId != null && decoration != null ? { entryId: timeEditId, decoration } : null,
    editWorldTime,
    requestEditWorldTime,
    closeTimeEdit,
  }
}
