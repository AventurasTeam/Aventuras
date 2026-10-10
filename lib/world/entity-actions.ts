import type { PipelineAction } from '@/lib/actions'
import {
  emptyEntityState,
  type CharacterState,
  type Entity,
  type EntityState,
  type FactionState,
  type ItemState,
  type LocationState,
  type NewEntity,
} from '@/lib/db'
import { dedupeTerms, newTerms, normalizeTerm } from '@/lib/keyword-terms'
import { blankToNull } from '@/lib/text'

import { brokenFlags, withFlagClears } from './collision-flags'
import { cleanList, sameList } from './draft-text'
import {
  heldItems,
  stackableKey,
  stateOf,
  VISUAL_DRAFT_FIELDS,
  type CharacterDraft,
  type EntityBaseDraft,
  type FactionDraft,
  type ItemDraft,
  type LocationDraft,
  type RelationshipDraft,
  type RelationshipBaseLink,
  type RelationshipLink,
} from './entity-draft'

export type EntitySaveInput = (
  | {
      kind: 'character'
      draft: CharacterDraft
      /** The committed links at Save. */
      relationships: readonly RelationshipLink[]
      /**
       * Committed links the draft was based on (frozen once dirty; `relationships` while clean).
       * Untouched pairs/views keep what is stored; an edited pair whose row is gone is rewritten.
       */
      relationshipsBase: readonly RelationshipBaseLink[]
    }
  | { kind: 'location'; draft: LocationDraft }
  | { kind: 'item'; draft: ItemDraft }
  | { kind: 'faction'; draft: FactionDraft }
) & {
  /**
   * The stored keywords the draft's list was based on (frozen once dirty). A term the classifier
   * appended since stays unless the user removed it.
   */
  keywordsBase: readonly string[]
}

type EntityActionArgs = EntitySaveInput & {
  branchId: string
  /** The store's current row at Save (never the row at load); null in create mode. */
  row: Entity | null
  /** The branch's entities at Save, for moving an item out of its other position. */
  branchEntities: readonly Entity[]
  /** The row id — pre-generated in create mode so relationship writes can reference it. */
  id: string
  now: number
}

type ColumnPatch = Partial<
  Pick<
    Entity,
    | 'name'
    | 'description'
    | 'status'
    | 'retiredReason'
    | 'injectionMode'
    | 'tags'
    | 'keywords'
    | 'priority'
  >
>

/** State free text is stored as an absent key when blank, never `''`. */
function blankToAbsent(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

/** Sets `key` to the draft's text, or removes it when blank; false when it already reads so. */
function writeText<K extends string>(
  state: Partial<Record<K, string>>,
  key: K,
  draftValue: string,
): boolean {
  const value = blankToAbsent(draftValue)
  if (value === blankToAbsent(state[key])) return false
  if (value === undefined) delete state[key]
  else state[key] = value
  return true
}

function normalizedStackables(
  entries: Iterable<readonly [string, number]>,
): Record<string, number> {
  // A Map, so a "__proto__" key is stored rather than setting the record's prototype.
  const out = new Map<string, number>()
  for (const [raw, count] of entries) {
    const key = stackableKey(raw)
    // data-model.md → Stackable items: depletion to 0 removes the key.
    if (key !== '' && count > 0) out.set(key, count)
  }
  return Object.fromEntries(out)
}

function sameRecord(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
  )
}

/**
 * The stored list with the user's changes against `base` applied: their removals dropped, their
 * additions appended, their spelling of a kept term used. As edited while nothing moved underneath.
 */
function mergedKeywords(
  stored: readonly string[],
  base: readonly string[],
  draft: readonly string[],
): string[] {
  if (sameList(stored, base)) return [...draft]
  const drafted = new Map(draft.map((term) => [normalizeTerm(term), term]))
  const removed = new Set(base.map(normalizeTerm).filter((key) => !drafted.has(key)))
  const kept = stored
    .filter((term) => !removed.has(normalizeTerm(term)))
    .map((term) => drafted.get(normalizeTerm(term)) ?? term)
  return [...kept, ...newTerms(kept, newTerms(base, draft))]
}

/** Normalized on both sides: the classifier's verbatim text must not read as a user edit. */
function columnPatch(
  row: Entity,
  draft: EntityBaseDraft,
  keywordsBase: readonly string[],
): ColumnPatch {
  const patch: ColumnPatch = {}
  const name = draft.name.trim()
  if (name !== row.name.trim()) patch.name = name
  const description = blankToNull(draft.description)
  if (description !== blankToNull(row.description ?? '')) patch.description = description
  if (draft.status !== row.status) patch.status = draft.status
  const retiredReason = blankToNull(draft.retiredReason)
  if (retiredReason !== blankToNull(row.retiredReason ?? '')) patch.retiredReason = retiredReason
  if (draft.injectionMode !== row.injectionMode) patch.injectionMode = draft.injectionMode
  const tags = cleanList(draft.tags)
  if (!sameList(tags, cleanList(row.tags))) patch.tags = tags
  const stored = dedupeTerms(row.keywords)
  const keywords = mergedKeywords(stored, dedupeTerms(keywordsBase), dedupeTerms(draft.keywords))
  if (!sameList(keywords, stored)) patch.keywords = keywords
  if (draft.priority !== row.priority) patch.priority = draft.priority
  return patch
}

/** `current` with only the fields the draft changed applied; null when nothing changed. */
function characterState(current: CharacterState, draft: CharacterDraft): CharacterState | null {
  const next: CharacterState = { ...current, visual: { ...current.visual } }
  let changed = false
  for (const [field, key] of VISUAL_DRAFT_FIELDS) {
    if (writeText(next.visual, key, draft[field])) changed = true
  }
  const traits = cleanList(draft.traits)
  if (!sameList(traits, cleanList(current.traits))) {
    next.traits = traits
    changed = true
  }
  const drives = cleanList(draft.drives)
  if (!sameList(drives, cleanList(current.drives))) {
    next.drives = drives
    changed = true
  }
  if (writeText(next, 'voice', draft.voice)) changed = true
  if (draft.currentLocationId !== (current.current_location_id ?? null)) {
    next.current_location_id = draft.currentLocationId
    changed = true
  }
  if (draft.factionId !== (current.faction_id ?? null)) {
    next.faction_id = draft.factionId
    changed = true
  }
  if (!sameList(draft.equippedItems, current.equipped_items ?? [])) {
    next.equipped_items = [...draft.equippedItems]
    changed = true
  }
  if (!sameList(draft.inventory, current.inventory ?? [])) {
    next.inventory = [...draft.inventory]
    changed = true
  }
  const stackables = normalizedStackables(draft.stackables.map((s) => [s.key, s.count] as const))
  if (!sameRecord(stackables, normalizedStackables(Object.entries(current.stackables ?? {})))) {
    if (Object.keys(stackables).length === 0) delete next.stackables
    else next.stackables = stackables
    changed = true
  }
  return changed ? next : null
}

function locationState(current: LocationState, draft: LocationDraft): LocationState | null {
  const next: LocationState = { ...current }
  let changed = false
  if (draft.parentLocationId !== (current.parent_location_id ?? null)) {
    next.parent_location_id = draft.parentLocationId
    changed = true
  }
  if (writeText(next, 'condition', draft.condition)) changed = true
  return changed ? next : null
}

function itemState(current: ItemState, draft: ItemDraft): ItemState | null {
  const next: ItemState = { ...current }
  let changed = false
  if (draft.atLocationId !== (current.at_location_id ?? null)) {
    next.at_location_id = draft.atLocationId
    changed = true
  }
  if (writeText(next, 'condition', draft.condition)) changed = true
  return changed ? next : null
}

function factionState(current: FactionState, draft: FactionDraft): FactionState | null {
  const next: FactionState = { ...current }
  let changed = false
  if (writeText(next, 'standing', draft.standing)) changed = true
  const agenda = cleanList(draft.agenda)
  if (!sameList(agenda, cleanList(current.agenda))) {
    if (agenda.length === 0) delete next.agenda
    else next.agenda = agenda
    changed = true
  }
  return changed ? next : null
}

function nextState(args: EntityActionArgs): EntityState | null {
  switch (args.kind) {
    case 'character':
      return characterState(stateOf(args.row, 'character'), args.draft)
    case 'location':
      return locationState(stateOf(args.row, 'location'), args.draft)
    case 'item':
      return itemState(stateOf(args.row, 'item'), args.draft)
    case 'faction':
      return factionState(stateOf(args.row, 'faction'), args.draft)
  }
}

/** Whether the user edited a view relative to the baseline, and the value Save sends for it. */
function viewWrite(
  draft: RelationshipDraft,
  was: RelationshipBaseLink | undefined,
  now: RelationshipLink | undefined,
  view: 'selfToOther' | 'otherToSelf',
): { edited: boolean; value: string | null } {
  const value = blankToNull(draft[view])
  // A pair new to the draft compares as blank, so a view left empty keeps what is stored.
  const edited = value !== blankToNull(was?.[view] ?? '')
  // A gone row is rewritten from the draft, which holds the view the user saw.
  if (now == null) return { edited, value }
  const stored = now[view]
  // An untouched view keeps the stored raw text, as does an edit that normalizes to it.
  return { edited, value: edited && value !== blankToNull(stored ?? '') ? value : stored }
}

/**
 * Three-way: only the user's changes relative to the links the draft was based on are written; the
 * rest of what is stored stays. Diffed by the other character, so a pair is written at most once.
 */
function relationshipActions(
  branchId: string,
  selfId: string,
  current: readonly RelationshipLink[],
  base: readonly RelationshipBaseLink[],
  drafts: readonly RelationshipDraft[],
): PipelineAction[] {
  const actions: PipelineAction[] = []
  const nowByOther = new Map(current.map((r) => [r.otherId, r]))
  const wasByOther = new Map(base.map((r) => [r.otherId, r]))
  const remove = (id: string): PipelineAction => ({
    kind: 'deleteCharacterRelationship',
    source: 'user_edit',
    payload: { branchId, id },
  })
  for (const draft of drafts) {
    const was = wasByOther.get(draft.otherId)
    const now = nowByOther.get(draft.otherId)
    const self = viewWrite(draft, was, now, 'selfToOther')
    const other = viewWrite(draft, was, now, 'otherToSelf')
    // Left alone, a pair stays as stored, even when its row has gone since the baseline.
    if (!self.edited && !other.edited) continue
    if (self.value === null && other.value === null) {
      // The handler refuses a both-null upsert: the pair has no view left.
      if (now != null) actions.push(remove(now.rowId))
      continue
    }
    if (now != null && self.value === now.selfToOther && other.value === now.otherToSelf) continue
    actions.push({
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId,
        subjectId: selfId,
        objectId: draft.otherId,
        kind: self.value,
        inverseKind: other.value,
      },
    })
  }
  const kept = new Set(drafts.map((d) => d.otherId))
  for (const was of base) {
    if (kept.has(was.otherId)) continue
    const now = nowByOther.get(was.otherId)
    if (now != null) actions.push(remove(now.rowId))
  }
  return actions
}

/**
 * data-model.md → ItemState: an item has one position. Holding it clears where it lay and
 * takes it off every other holder; placing it takes it off every holder.
 */
function positionActions(args: EntityActionArgs): PipelineAction[] {
  const { branchId, id, branchEntities } = args
  const items = new Set<string>()
  let clearLocation = false
  if (args.kind === 'character') {
    const before = new Set(heldItems(stateOf(args.row, 'character')))
    for (const itemId of [...args.draft.equippedItems, ...args.draft.inventory])
      if (!before.has(itemId)) items.add(itemId)
    clearLocation = true
  } else if (args.kind === 'item') {
    const placed = args.draft.atLocationId
    if (placed != null && placed !== (stateOf(args.row, 'item').at_location_id ?? null))
      items.add(id)
  }
  if (items.size === 0) return []

  const actions: PipelineAction[] = []
  for (const other of branchEntities) {
    if (other.kind !== 'character') continue
    const state = other.state as CharacterState
    const held = heldItems(state)
    if (!held.some((itemId) => items.has(itemId))) continue
    actions.push({
      kind: 'updateEntityInventory',
      source: 'user_edit',
      payload: {
        branchId,
        id: other.id,
        equipped_items: (state.equipped_items ?? []).filter((itemId) => !items.has(itemId)),
        inventory: (state.inventory ?? []).filter((itemId) => !items.has(itemId)),
      },
    })
  }
  if (clearLocation) {
    for (const item of branchEntities) {
      if (!items.has(item.id) || item.kind !== 'item') continue
      if ((item.state as ItemState).at_location_id == null) continue
      actions.push({
        kind: 'updateItemPosition',
        source: 'user_edit',
        payload: { branchId, id: item.id, atLocationId: null },
      })
    }
  }
  return actions
}

/**
 * A create, or an update's changed columns and state paths, plus relationship writes; on a rename,
 * also a flag clear on each row the saved name and keywords no longer make its partner's namesake.
 */
export function entityActions(args: EntityActionArgs): PipelineAction[] {
  const { branchId, row, id, now, draft } = args
  if (row != null && row.kind !== args.kind)
    throw new Error(`entityActions: ${row.kind} row saved as ${args.kind}`)
  const actions: PipelineAction[] = []
  const state = nextState(args)
  const columns = row == null ? null : columnPatch(row, draft, args.keywordsBase)
  if (row == null) {
    const entry: NewEntity = {
      id,
      branchId,
      kind: args.kind,
      name: draft.name.trim(),
      description: blankToNull(draft.description),
      status: draft.status,
      retiredReason: blankToNull(draft.retiredReason),
      injectionMode: draft.injectionMode,
      tags: cleanList(draft.tags),
      keywords: dedupeTerms(draft.keywords),
      priority: draft.priority,
      state: state ?? emptyEntityState(args.kind),
      embeddingStale: 1,
      createdAt: now,
      updatedAt: now,
    }
    actions.push({ kind: 'createEntity', source: 'user_edit', payload: { entry } })
  } else {
    const patch = { ...columns, ...(state != null ? { state } : {}) }
    if (Object.keys(patch).length > 0) {
      actions.push({
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId, id: row.id, patch },
      })
    }
  }
  actions.push(...positionActions(args))
  if (args.kind === 'character') {
    actions.push(
      ...relationshipActions(
        branchId,
        id,
        row == null ? [] : args.relationships,
        row == null ? [] : args.relationshipsBase,
        args.draft.relationships,
      ),
    )
  }
  if (row == null || columns?.name === undefined) return actions
  const saved = { name: columns.name, keywords: columns.keywords ?? row.keywords }
  const broken = brokenFlags({ entities: args.branchEntities, after: new Map([[row.id, saved]]) })
  return withFlagClears(actions, branchId, broken)
}
