import { useMemo } from 'react'

import type { RailData } from '@/components/reader/rail/use-rail-data'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { DEFAULT_CALENDAR_ID, resolveCalendar, type CalendarSystem } from '@/lib/calendar'
import type { Entity } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import type { RailPeek } from '@/lib/reader-rail'
import {
  currentStoryStore,
  entriesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'
import { branchWorldTime } from '@/lib/world'

import { peekModelOf, type PeekModel } from './peek-model'

export type PeekEntityContext = {
  entities: readonly Entity[]
  worldTime: number
  calendar: CalendarSystem
}

/** The branch's entry index, for a happening's when-marker. */
export type PeekEntryIndex =
  | { state: 'reading' }
  | { state: 'ready'; index: EntryIndex }
  | { state: 'failed' }

const READING: PeekEntryIndex = { state: 'reading' }
const FAILED: PeekEntryIndex = { state: 'failed' }

export type PeekView = {
  model: PeekModel | null
  entityContext: PeekEntityContext
  entryIndex: PeekEntryIndex
}

/** Everything a peek renders. Calls context-bound hooks: call it above any rn-primitives Portal. */
export function usePeekView(peek: RailPeek | null, data: RailData): PeekView {
  const { branchId } = data
  // Raw maps are stable between patches; derived values via useMemo.
  const involvements = happeningInvolvementsStore.useInvolvements((m) => m)
  const awareness = happeningAwarenessStore.useAwareness((m) => m)
  const entryRows = entriesStore.useEntries((m) => m)
  const worldTime = useMemo(
    () =>
      branchWorldTime(
        [...entryRows.values()]
          .filter((e) => e.branchId === branchId)
          .sort((a, b) => a.position - b.position),
      ),
    [entryRows, branchId],
  )
  // Another branch's open story says nothing about this branch's calendar.
  const calendarId = currentStoryStore.useCurrentStory((s) =>
    s?.branchId === branchId ? s.definition.calendarSystemId : DEFAULT_CALENDAR_ID,
  )
  const calendar = useMemo(() => resolveCalendar(calendarId), [calendarId])
  // A full-branch read per turn, so only while a happening's when-marker needs it.
  const { ready, failed, index } = useEntryIndex(branchId, {
    enabled: peek?.category === 'happening',
    seedFromLastRead: true,
  })
  const entryIndex = useMemo<PeekEntryIndex>(() => {
    if (ready) return { state: 'ready', index }
    return failed ? FAILED : READING
  }, [ready, failed, index])

  const model = useMemo(
    () => (peek == null ? null : peekModelOf(peek, data, { involvements, awareness })),
    [peek, data, involvements, awareness],
  )
  const entityContext = useMemo<PeekEntityContext>(
    () => ({ entities: data.entities, worldTime, calendar }),
    [data.entities, worldTime, calendar],
  )
  return useMemo(() => ({ model, entityContext, entryIndex }), [model, entityContext, entryIndex])
}
