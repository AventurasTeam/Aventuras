import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { EntitySaveResult } from '@/lib/actions'
import type { CalendarSystem } from '@/lib/calendar'
import type { Entity } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import type { RecentlyClassified } from '@/lib/row-signals'
import type { EntitySaveInput, RelationshipLink } from '@/lib/world'

import type { EntityInvolvement } from '../world-route-data'
import type { EntityTab } from './entity-tabs'

/** What the route reads from the working set for one pane. */
export type EntityPaneData = {
  entities: readonly Entity[]
  /** The selected character's committed relationships; empty for other kinds. */
  relationships: readonly RelationshipLink[]
  involvements: readonly EntityInvolvement[]
  /** Last seen's `entry #n`; an unread index just omits it. */
  entryIndex: EntryIndex
  /** The branch's current world time in seconds (`branchWorldTime`). */
  worldTime: number
  calendar: CalendarSystem
  leadId: string | null
}

export type EntityPaneProps = {
  /** Null in create mode (`[+] Blank`). */
  row: Entity | null
  /** The create selection's `seq`; a new value resets the create draft. */
  createSeq?: number
  data: EntityPaneData
  recentlyClassified?: RecentlyClassified
  /** `isUserEditBlocked`: every control and Save disable with `blockedReason`. */
  blocked: boolean
  blockedReason?: string
  /** A deep link's `tab`. */
  initialTab?: EntityTab
  onSave: (input: EntitySaveInput) => Promise<EntitySaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, category switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
  onOpenEntity: (id: string) => void
  onOpenHappening: (id: string) => void
  onSetLead: (id: string) => void
  /** The host screen's focus state, for the save bar's Cmd/Ctrl-S. */
  hotkeysEnabled?: boolean
}
