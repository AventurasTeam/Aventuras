import type { OverflowMenuEntry } from '@/components/compounds/overflow-menu'
import { ENTITY_REJECTION, LEAD_REJECTION, type LeadRejectionCode } from '@/lib/actions'
import type { WholeTierSpan } from '@/lib/calendar'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  holdersOf,
  isWorldIssue,
  stateOf,
  type CharacterDraft,
  type EntityBaseDraft,
  type FactionDraft,
  type ItemDraft,
  type LocationDraft,
  type WorldIssue,
} from '@/lib/world'

import type { EntityTab } from './detail/entity-tabs'

/** A draft-schema issue message (a key) → its text; unknown messages pass through. */
export function validationText(message: string): string {
  return isWorldIssue(message) ? t(`world:validation.${message}`) : message
}

export function issueLabel(message: string | undefined): string | undefined {
  return message == null ? undefined : validationText(message)
}

const ISSUE_TAB: Partial<Record<WorldIssue, EntityTab>> = {
  characterRequired: 'connections',
  relationshipPovRequired: 'connections',
  duplicateRelationship: 'connections',
  parentCycle: 'connections',
  stackableKeyRequired: 'carrying',
  stackableCount: 'carrying',
  duplicateStackable: 'carrying',
  priorityRange: 'settings',
}

/** The save bar's notice: an issue on another tab names it, or the user can't find the field. */
export function entityIssueText(message: string): string {
  const text = validationText(message)
  const tab = isWorldIssue(message) ? ISSUE_TAB[message] : undefined
  return tab == null
    ? text
    : t('world:validation.inTab', { tab: t(`world:detail.tabs.${tab}`), issue: text })
}

/** A refused save's user-facing text; the actions' own reasons are developer strings. */
export function saveRejectionText(code: string | undefined): string {
  if (code === ENTITY_REJECTION.inFlight) return t('world:save.inFlight')
  if (code === ENTITY_REJECTION.parentCycle) return t('world:save.parentCycle')
  return t('world:save.failed')
}

export function saveFailureText(): string {
  return t('world:save.failed')
}

export function leadRejectionText(code: LeadRejectionCode): string {
  if (code === LEAD_REJECTION.inFlight) return t('world:lead.inFlight')
  if (code === LEAD_REJECTION.notActive) return t('world:lead.notActive')
  return t('world:lead.failed')
}

const BASE_LABEL: Record<keyof EntityBaseDraft, () => string> = {
  name: () => t('world:fields.name'),
  description: () => t('world:fields.description'),
  status: () => t('world:fields.status'),
  retiredReason: () => t('world:fields.retiredReason'),
  injectionMode: () => t('world:fields.injectionMode'),
  keywords: () => t('world:fields.keywords'),
  tags: () => t('world:fields.tags'),
  priority: () => t('world:fields.priority'),
}

// Exhaustive per draft: a new draft field fails typecheck until it has a label.
const CHARACTER_LABEL: Record<keyof CharacterDraft, () => string> = {
  ...BASE_LABEL,
  visualPhysique: () => t('world:fields.visual.physique'),
  visualFace: () => t('world:fields.visual.face'),
  visualHair: () => t('world:fields.visual.hair'),
  visualEyes: () => t('world:fields.visual.eyes'),
  visualAttire: () => t('world:fields.visual.attire'),
  visualDistinguishing: () => t('world:fields.visual.distinguishing'),
  traits: () => t('world:fields.traits'),
  drives: () => t('world:fields.drives'),
  voice: () => t('world:fields.voice'),
  currentLocationId: () => t('world:fields.currentLocation'),
  factionId: () => t('world:fields.faction'),
  equippedItems: () => t('world:fields.equipped'),
  inventory: () => t('world:fields.carried'),
  stackables: () => t('world:fields.stackables'),
  relationships: () => t('world:fields.relationships'),
}

const LOCATION_LABEL: Record<keyof LocationDraft, () => string> = {
  ...BASE_LABEL,
  parentLocationId: () => t('world:fields.parentLocation'),
  condition: () => t('world:fields.condition'),
}

const ITEM_LABEL: Record<keyof ItemDraft, () => string> = {
  ...BASE_LABEL,
  atLocationId: () => t('world:fields.atLocation'),
  condition: () => t('world:fields.condition'),
}

const FACTION_LABEL: Record<keyof FactionDraft, () => string> = {
  ...BASE_LABEL,
  standing: () => t('world:fields.standing'),
  agenda: () => t('world:fields.agenda'),
}

const FIELD_LABELS: Record<EntityKind, Record<string, () => string>> = {
  character: CHARACTER_LABEL,
  location: LOCATION_LABEL,
  item: ITEM_LABEL,
  faction: FACTION_LABEL,
}

/** save-sessions.md → Save bar: user-recognizable field names. */
export function entityFieldLabel(kind: EntityKind, field: string): string {
  const labels = FIELD_LABELS[kind]
  return Object.hasOwn(labels, field) ? labels[field]() : field
}

type LeadEntry = { onSetLead: () => void; disabledReason?: string }

/** world.md → Detail head structure: Set as lead (characters only), Export, View raw JSON, Delete. */
export function entityMenuEntries(
  kind: EntityKind,
  { onViewJson, lead }: { onViewJson: () => void; lead?: LeadEntry },
): OverflowMenuEntry[] {
  const leadEntries: OverflowMenuEntry[] =
    kind === 'character' && lead != null
      ? [
          {
            key: 'lead',
            label: t('world:detail.menu.setLead'),
            disabled: lead.disabledReason != null,
            disabledReason: lead.disabledReason,
            onPress: lead.onSetLead,
          },
        ]
      : []
  return [
    ...leadEntries,
    {
      key: 'export',
      label: t('world:detail.menu.exportEntity'),
      disabled: true,
      disabledReason: t('world:detail.menu.exportReason'),
      onPress: () => {},
    },
    { key: 'json', label: t('world:detail.menu.viewJson'), onPress: onViewJson },
    {
      key: 'delete',
      label: t('world:detail.menu.deleteEntity'),
      destructive: true,
      disabled: true,
      disabledReason: t('world:detail.menu.deleteReason'),
      onPress: () => {},
    },
  ]
}

/** Why `Set as lead` is unavailable for this committed row, or undefined when it is. */
export function leadDisabledReason(
  row: Entity,
  leadId: string | null,
  blocked: boolean,
  blockedReason?: string,
): string | undefined {
  if (blocked) return blockedReason
  if (row.id === leadId) return t('world:detail.menu.setLeadAlready')
  if (row.status !== 'active') return t('world:detail.menu.setLeadInactive')
  return undefined
}

/** world.md → Relationships: the current character's view first; a null view is "not recorded". */
export function relationshipDescription(
  selfToOther: string | null | undefined,
  otherToSelf: string | null | undefined,
): string {
  const self = selfToOther?.trim() || null
  const other = otherToSelf?.trim() || null
  if (self != null && other != null) return t('world:relationships.both', { self, other })
  if (self != null) return t('world:relationships.onlySelf', { self })
  return t('world:relationships.onlyOther', { other: other ?? '' })
}

const SPAN_TIERS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const
type SpanTier = (typeof SPAN_TIERS)[number]

function isSpanTier(tier: string): tier is SpanTier {
  return (SPAN_TIERS as readonly string[]).includes(tier)
}

export function spanText(span: WholeTierSpan): string {
  return isSpanTier(span.tier)
    ? t(`world:overview.span.${span.tier}`, { count: span.count })
    : t('world:overview.spanFallback', { count: span.count, tier: span.tier })
}

/** The Overview's `last seen N … ago`, or null when never seen or the span runs backwards. */
export function lastSeenText(span: WholeTierSpan | null): string | null {
  if (span == null) return null
  if (span.count === 0) return t('world:overview.lastSeenJustNow')
  return t('world:overview.lastSeen', { span: spanText(span) })
}

/** Connections → Last seen: `<location> · entry #n · N … ago in-world`, from the parts known. */
export function lastSeenDetail(parts: {
  location: string | undefined
  position: number | undefined
  span: WholeTierSpan | null
}): string {
  const ago =
    parts.span == null
      ? undefined
      : parts.span.count === 0
        ? t('world:connections.justNow')
        : t('world:connections.ago', { span: spanText(parts.span) })
  const entry =
    parts.position == null ? undefined : t('world:connections.entry', { position: parts.position })
  return [parts.location, entry, ago].filter((p): p is string => p != null && p !== '').join(' · ')
}

/** An item row's whereabouts for the Carrying picker; `selfId`'s own hold doesn't count. */
export function itemPositionHint(
  item: Entity,
  entities: readonly Entity[],
  selfId: string | null,
): string | undefined {
  const holders = holdersOf(item.id, entities).filter((h) => h.id !== selfId)
  if (holders.length > 0)
    return t('world:carrying.position.heldBy', { name: holders.map((h) => h.name).join(', ') })
  const at = stateOf(item, 'item').at_location_id
  if (at == null) return undefined
  const place = entities.find((e) => e.id === at)
  return t('world:carrying.position.at', { name: place?.name ?? t('world:carrying.missing') })
}
