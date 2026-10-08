import type { RailData } from '@/components/reader/rail/use-rail-data'
import { leadDisabledReason } from '@/components/world/world-copy'
import type {
  Entity,
  Happening,
  HappeningAwareness,
  HappeningInvolvement,
  Lore,
  Thread,
} from '@/lib/db'
import type { RailPeek } from '@/lib/reader-rail'
import type { RecentlyClassified } from '@/lib/row-signals'
import type { LeadLabel } from '@/lib/world'

export type PeekModel =
  | {
      kind: 'entity'
      row: Entity
      recentlyClassified: RecentlyClassified | undefined
      /** Set only on the story's resolved lead. */
      leadLabel: LeadLabel | null
    }
  | { kind: 'lore'; row: Lore; recentlyClassified: RecentlyClassified | undefined }
  | { kind: 'thread'; row: Thread; recentlyClassified: RecentlyClassified | undefined }
  | {
      kind: 'happening'
      row: Happening
      recentlyClassified: RecentlyClassified | undefined
      involved: number
      aware: number
    }

export type PeekLinks = {
  involvements: ReadonlyMap<string, HappeningInvolvement>
  awareness: ReadonlyMap<string, HappeningAwareness>
}

function linkCount(
  rows: Iterable<{ branchId: string; happeningId: string }>,
  branchId: string,
  happeningId: string,
): number {
  let count = 0
  for (const row of rows) {
    if (row.branchId === branchId && row.happeningId === happeningId) count += 1
  }
  return count
}

/** The row `peek` names on `data`'s branch; null once it no longer resolves. */
export function peekModelOf(peek: RailPeek, data: RailData, links: PeekLinks): PeekModel | null {
  const { lead, recentlyClassified } = data.rowSignals(peek.id)
  switch (peek.category) {
    case 'character':
    case 'location':
    case 'item':
    case 'faction': {
      const kind = peek.category
      const row = data.entities.find((e) => e.id === peek.id && e.kind === kind)
      return row == null
        ? null
        : { kind: 'entity', row, recentlyClassified, leadLabel: lead ?? null }
    }
    case 'lore': {
      const row = data.lore.find((l) => l.id === peek.id)
      return row == null ? null : { kind: 'lore', row, recentlyClassified }
    }
    case 'thread': {
      const row = data.threads.find((r) => r.id === peek.id)
      return row == null ? null : { kind: 'thread', row, recentlyClassified }
    }
    case 'happening': {
      const row = data.happenings.find((r) => r.id === peek.id)
      if (row == null) return null
      return {
        kind: 'happening',
        row,
        recentlyClassified,
        involved: linkCount(links.involvements.values(), data.branchId, row.id),
        aware: linkCount(links.awareness.values(), data.branchId, row.id),
      }
    }
  }
}

/** What the peek calls the row: an entity's name, the other kinds' title. */
export function peekNameOf(model: PeekModel): string {
  return model.kind === 'entity' ? model.row.name : model.row.title
}

export type PeekLeadControl = {
  /** `RailData.entityListSignals.leadId`. */
  leadId: string | null
  blocked: boolean
  blockedReason: string | undefined
  /** A `Set as lead` call is in flight. */
  pending: boolean
  onSetLead: (entityId: string) => void
}

export type PeekLead =
  | { state: 'lead'; label: LeadLabel }
  | {
      state: 'candidate'
      onSetLead: () => void
      /** Why it can't be pressed; undefined while it can. */
      disabledReason: string | undefined
      pending: boolean
    }

/** Whether `Set as lead` can't be pressed: the head and the drawer's focus effect share it. */
export function isLeadActionDisabled(lead: PeekLead | undefined): boolean {
  return lead?.state === 'candidate' && (lead.disabledReason != null || lead.pending)
}

/** The head's lead affordance: characters only. */
export function peekLeadOf(model: PeekModel, control: PeekLeadControl): PeekLead | undefined {
  if (model.kind !== 'entity' || model.row.kind !== 'character') return undefined
  if (model.leadLabel != null) return { state: 'lead', label: model.leadLabel }
  const { row } = model
  return {
    state: 'candidate',
    onSetLead: () => control.onSetLead(row.id),
    disabledReason: leadDisabledReason(row, control.leadId, control.blocked, control.blockedReason),
    pending: control.pending,
  }
}
