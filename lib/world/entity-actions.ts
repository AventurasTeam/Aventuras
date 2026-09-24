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
import { dedupeTerms } from '@/lib/keyword-terms'

import {
  stackableKey,
  stateOf,
  VISUAL_DRAFT_FIELDS,
  type CharacterDraft,
  type EntityBaseDraft,
  type FactionDraft,
  type ItemDraft,
  type LocationDraft,
  type RelationshipDraft,
  type RelationshipLink,
  type StackableDraft,
} from './entity-draft'

export type EntitySaveInput =
  | {
      kind: 'character'
      draft: CharacterDraft
      /** The committed links at Save. */
      relationships: readonly RelationshipLink[]
      /**
       * The committed links the draft's relationships were based on (the pane freezes them when the
       * list goes dirty); defaults to `relationships`. A pair or view the user left alone keeps
       * whatever is stored at Save.
       */
      relationshipsBase?: readonly RelationshipLink[]
    }
  | { kind: 'location'; draft: LocationDraft }
  | { kind: 'item'; draft: ItemDraft }
  | { kind: 'faction'; draft: FactionDraft }

type EntityActionArgs = EntitySaveInput & {
  branchId: string
  /** The store's current row at Save (never the row at load); null in create mode. */
  row: Entity | null
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

// Free text is stored as NULL (columns) or an absent key (state), never ''.
function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function blankToAbsent(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? undefined : trimmed
}

function cleanList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => v !== '')
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

function normalizedStackables(
  entries: Iterable<readonly [string, number]>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [raw, count] of entries) {
    const key = stackableKey(raw)
    // data-model.md → Stackable items: depletion to 0 removes the key.
    if (key !== '' && count > 0) out[key] = count
  }
  return out
}

function sameRecord(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
  )
}

/** Normalized on both sides: the classifier's verbatim text must not read as a user edit. */
function columnPatch(row: Entity, draft: EntityBaseDraft): ColumnPatch {
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
  const keywords = dedupeTerms(draft.keywords)
  if (!sameList(keywords, dedupeTerms(row.keywords))) patch.keywords = keywords
  if (draft.priority !== row.priority) patch.priority = draft.priority
  return patch
}

/** `current` with only the fields the draft changed applied; null when nothing changed. */
function characterState(current: CharacterState, draft: CharacterDraft): CharacterState | null {
  const next: CharacterState = { ...current, visual: { ...current.visual } }
  let changed = false
  for (const [field, key] of VISUAL_DRAFT_FIELDS) {
    const value = blankToAbsent(draft[field])
    if (value === blankToAbsent(current.visual[key])) continue
    if (value === undefined) delete next.visual[key]
    else next.visual[key] = value
    changed = true
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
  const voice = blankToAbsent(draft.voice)
  if (voice !== blankToAbsent(current.voice)) {
    if (voice === undefined) delete next.voice
    else next.voice = voice
    changed = true
  }
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
  const stackables = normalizedStackables(
    draft.stackables.map((s: StackableDraft) => [s.key, s.count] as const),
  )
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
  const condition = blankToAbsent(draft.condition)
  if (condition !== blankToAbsent(current.condition)) {
    if (condition === undefined) delete next.condition
    else next.condition = condition
    changed = true
  }
  return changed ? next : null
}

function itemState(current: ItemState, draft: ItemDraft): ItemState | null {
  const next: ItemState = { ...current }
  let changed = false
  if (draft.atLocationId !== (current.at_location_id ?? null)) {
    next.at_location_id = draft.atLocationId
    changed = true
  }
  const condition = blankToAbsent(draft.condition)
  if (condition !== blankToAbsent(current.condition)) {
    if (condition === undefined) delete next.condition
    else next.condition = condition
    changed = true
  }
  return changed ? next : null
}

function factionState(current: FactionState, draft: FactionDraft): FactionState | null {
  const next: FactionState = { ...current }
  let changed = false
  const standing = blankToAbsent(draft.standing)
  if (standing !== blankToAbsent(current.standing)) {
    if (standing === undefined) delete next.standing
    else next.standing = standing
    changed = true
  }
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
  was: RelationshipLink | undefined,
  now: RelationshipLink | undefined,
  view: 'selfToOther' | 'otherToSelf',
): { edited: boolean; value: string | null } {
  const value = blankToNull(draft[view])
  const edited = was == null || value !== blankToNull(was[view] ?? '')
  const stored = now?.[view] ?? null
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
  base: readonly RelationshipLink[],
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

/** A create or the changed columns and state paths of an update, plus relationship writes. */
export function entityActions(args: EntityActionArgs): PipelineAction[] {
  const { branchId, row, id, now, draft } = args
  if (row != null && row.kind !== args.kind)
    throw new Error(`entityActions: ${row.kind} row saved as ${args.kind}`)
  const actions: PipelineAction[] = []
  const state = nextState(args)
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
    const patch = { ...columnPatch(row, draft), ...(state != null ? { state } : {}) }
    if (Object.keys(patch).length > 0) {
      actions.push({
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId, id: row.id, patch },
      })
    }
  }
  if (args.kind === 'character') {
    actions.push(
      ...relationshipActions(
        branchId,
        id,
        row == null ? [] : args.relationships,
        row == null ? [] : (args.relationshipsBase ?? args.relationships),
        args.draft.relationships,
      ),
    )
  }
  return actions
}
