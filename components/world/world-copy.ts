import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import {
  deleteEntry,
  type OverflowMenuEntry,
  type RemoveEntry,
} from '@/components/compounds/overflow-menu-entry'
import {
  ENTITY_REJECTION,
  LEAD_REJECTION,
  type ImportRejectionCode,
  type LeadRejectionCode,
  type RowSaveRejectionCode,
} from '@/lib/actions'
import type { WholeTierSpan } from '@/lib/calendar'
import type { CharacterState, Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  holdersOf,
  isWorldIssue,
  lastSeenSpan,
  stateOf,
  type CharacterDraft,
  type EntityBaseDraft,
  type FactionDraft,
  type ItemDraft,
  type LocationDraft,
  type LoreDraft,
  type WorldIssue,
} from '@/lib/world'

import type { EntityPaneData } from './detail/entity-pane-props'
import type { EntityTab } from './detail/entity-tabs'
import type { LoreTab } from './detail/lore-detail-pane'

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
  parentChainBroken: 'connections',
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

// The title is the head's name slot, on every tab, so its issue names no tab.
const LORE_ISSUE_TAB: Partial<Record<WorldIssue, LoreTab>> = {
  bodyRequired: 'body',
  priorityRange: 'settings',
}

/** The lore save bar's notice, naming the tab an issue lives on as entityIssueText does. */
export function loreIssueText(message: string): string {
  const text = validationText(message)
  const tab = isWorldIssue(message) ? LORE_ISSUE_TAB[message] : undefined
  return tab == null
    ? text
    : t('world:validation.inTab', { tab: t(`world:lore.tabs.${tab}`), issue: text })
}

// Exhaustive: a new RowSaveRejectionCode fails typecheck until it has text here.
const SAVE_REJECTION_TEXT: Record<RowSaveRejectionCode, () => string> = {
  [ENTITY_REJECTION.inFlight]: () => t('world:save.inFlight'),
  [ENTITY_REJECTION.parentCycle]: () => t('world:save.parentCycle'),
  [ENTITY_REJECTION.parentChainBroken]: () => t('world:save.parentChainBroken'),
  [ENTITY_REJECTION.notFound]: () => t('world:save.notFound'),
  [ENTITY_REJECTION.failed]: () => t('world:save.failed'),
}

/** A refused save's user-facing text; the actions' own reasons are developer strings. */
export function saveRejectionText(code: RowSaveRejectionCode): string {
  return SAVE_REJECTION_TEXT[code]()
}

export function saveFailureText(): string {
  return t('world:save.failed')
}

const IMPORT_REJECTION_TEXT: Record<ImportRejectionCode, () => string> = {
  [ENTITY_REJECTION.inFlight]: () => t('world:import.inFlight'),
  [ENTITY_REJECTION.failed]: () => t('world:import.failed'),
}

/** A refused import's text; the dialog has closed, so unlike a save nothing is kept to retry. */
export function importRejectionText(code: ImportRejectionCode): string {
  return IMPORT_REJECTION_TEXT[code]()
}

export function importFailureText(): string {
  return t('world:import.failed')
}

// Exhaustive: a new LeadRejectionCode fails typecheck until it has text here.
const LEAD_REJECTION_TEXT: Record<LeadRejectionCode, () => string> = {
  [LEAD_REJECTION.inFlight]: () => t('world:lead.inFlight'),
  [LEAD_REJECTION.draftStory]: () => t('world:lead.failed'),
  [LEAD_REJECTION.wrongBranch]: () => t('world:lead.failed'),
  [LEAD_REJECTION.notCharacter]: () => t('world:lead.failed'),
  [LEAD_REJECTION.notActive]: () => t('world:lead.notActive'),
  [LEAD_REJECTION.invalidDefinition]: () => t('world:lead.failed'),
}

export function leadRejectionText(code: LeadRejectionCode): string {
  return LEAD_REJECTION_TEXT[code]()
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

const LORE_LABEL: Record<keyof LoreDraft, () => string> = {
  title: () => t('world:lore.fields.title'),
  body: () => t('world:lore.fields.body'),
  category: () => t('world:lore.fields.category'),
  injectionMode: () => t('world:lore.fields.injectionMode'),
  priority: () => t('world:lore.fields.priority'),
  keywords: () => t('world:lore.fields.keywords'),
  tags: () => t('world:lore.fields.tags'),
}

/** save-sessions.md → Save bar: user-recognizable field names. */
export function loreFieldLabel(field: string): string {
  return Object.hasOwn(LORE_LABEL, field) ? LORE_LABEL[field as keyof LoreDraft]() : field
}

type LeadEntry = { onSetLead: () => void; disabledReason?: string }

/** world.md → Detail head structure. */
export function entityMenuEntries(
  kind: EntityKind,
  {
    onViewJson,
    onExport,
    lead,
    remove,
  }: { onViewJson: () => void; onExport: () => void; lead?: LeadEntry; remove?: RemoveEntry },
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
    { key: 'export', label: t('world:detail.menu.exportEntity'), onPress: onExport },
    { key: 'json', label: t('world:detail.menu.viewJson'), onPress: onViewJson },
    ...deleteEntry(t('world:detail.menu.deleteEntity'), remove),
  ]
}

/** world.md → Detail head — lore: no `Set as lead`. */
export function loreMenuEntries({
  onViewJson,
  onExport,
  remove,
}: {
  onViewJson: () => void
  onExport: () => void
  remove?: RemoveEntry
}): OverflowMenuEntry[] {
  return [
    { key: 'export', label: t('world:detail.menu.exportLore'), onPress: onExport },
    { key: 'json', label: t('world:detail.menu.viewJson'), onPress: onViewJson },
    ...deleteEntry(t('world:detail.menu.deleteLore'), remove),
  ]
}

/** Why `Set as lead` is unavailable for this committed row, or undefined when it is. */
export function leadDisabledReason(
  row: Entity,
  leadId: string | null,
  blocked: boolean,
  blockedReason?: string,
): string | undefined {
  const gateReason = gateDisabledReason(blocked, blockedReason)
  if (gateReason != null) return gateReason
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
  if (other != null) return t('world:relationships.onlyOther', { other })
  return t('world:relationships.neither')
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

function agoText(span: WholeTierSpan | null): string | undefined {
  if (span == null) return undefined
  if (span.count === 0) return t('world:connections.justNow')
  return t('world:connections.ago', { span: spanText(span) })
}

/** Connections → Last seen: `<location> · entry #n · N … ago in-world`, from the parts known. */
export function lastSeenDetail(parts: {
  location: string | undefined
  position: number | undefined
  span: WholeTierSpan | null
}): string {
  const ago = agoText(parts.span)
  const entry =
    parts.position == null ? undefined : t('world:connections.entry', { position: parts.position })
  return [parts.location, entry, ago].filter((p): p is string => p != null && p !== '').join(' · ')
}

/** Connections → Last seen for a character, or null when never seen. */
export function lastSeenLine(
  state: CharacterState,
  data: Pick<EntityPaneData, 'entities' | 'entryIndex' | 'worldTime' | 'calendar'>,
): string | null {
  const seen = state.lastSeenAt
  if (seen == null) return null
  const detail = lastSeenDetail({
    location:
      seen.locationId == null
        ? undefined
        : data.entities.find((e) => e.id === seen.locationId)?.name,
    position: data.entryIndex.get(seen.entryId)?.position,
    span: lastSeenSpan(seen, data.worldTime, data.calendar),
  })
  return detail === '' ? t('world:connections.lastSeenUnknown') : detail
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
  return place == null
    ? t('world:entityMissing')
    : t('world:carrying.position.at', { name: place.name })
}
