import type { PipelineAction } from '@/lib/actions'
import {
  inheritedEntryMetadata,
  type Entity,
  type EntryMetadata,
  type LocationState,
} from '@/lib/db'
import { blankToNull } from '@/lib/text'

import type { EntitySaveInput } from './entity-actions'
import { stateOf, type CharacterDraft, type ItemDraft, type LocationDraft } from './entity-draft'
import { byName } from './overview'
import { parentChainIds, parentIdOf, parentOfLocations, type ParentOf } from './parent-chain'
import { placeModes } from './place-modes'

/** data-model.md → LocationState shape and world.md → Merge: the codes a place rule refuses with. */
export const PLACE_REFUSAL = {
  storyInside: 'story-inside',
  retiredParent: 'retired-parent',
  retiredPlace: 'retired-place',
  placesInside: 'places-inside',
} as const

export type NamedPlace = { id: string; name: string }

// A draft key by name, so renaming the key breaks the refusal that points at it.
type FieldOf<Draft, K extends keyof Draft & string> = K

/** A refused World Save: the draft field the reason shows on, and the places it names. */
export type PlaceSaveRefusal =
  | {
      code: typeof PLACE_REFUSAL.storyInside
      field: FieldOf<LocationDraft, 'status' | 'injectionMode' | 'parentLocationId'>
      place: NamedPlace
      story: NamedPlace
    }
  | {
      code: typeof PLACE_REFUSAL.retiredParent
      field: FieldOf<LocationDraft, 'status' | 'parentLocationId'>
      parent: NamedPlace
    }
  | {
      code: typeof PLACE_REFUSAL.retiredPlace
      field: FieldOf<CharacterDraft, 'currentLocationId'> | FieldOf<ItemDraft, 'atLocationId'>
      place: NamedPlace
    }

type StoryInsideRefusal = Extract<PlaceSaveRefusal, { code: typeof PLACE_REFUSAL.storyInside }>

export type MergePlaceRefusalCode =
  | typeof PLACE_REFUSAL.storyInside
  | typeof PLACE_REFUSAL.placesInside
  | typeof PLACE_REFUSAL.retiredParent

type PlaceSaveArgs = EntitySaveInput & {
  /** The store's row at Save; null in create mode. */
  row: Entity | null
  branchEntities: readonly Entity[]
  /** Where the story is; only a location update reads it. */
  story: StoryPlace
}

/**
 * data-model.md → LocationState shape: where the story is. `tail` is the narrative tail's location,
 * which the next turn inherits; `scene` the scene source's, which the next prompt's map is built
 * around. They differ only while a `user_action` stands at the tail. Minted only by storyPlaceOf.
 */
export type StoryPlace = {
  readonly tail: string | null
  readonly scene: string | null
  readonly __brand: 'StoryPlace'
}

type SceneRow = { metadata: Partial<EntryMetadata> | null }

/** From the branch's narrative tail (resolveHeadTurn) and its scene source (readSceneSource). */
export function storyPlaceOf(rows: {
  tail: SceneRow | null | undefined
  sceneSource: SceneRow | null | undefined
}): StoryPlace {
  const locationOf = (row: SceneRow | null | undefined) =>
    inheritedEntryMetadata(row?.metadata).currentLocationId
  return { tail: locationOf(rows.tail), scene: locationOf(rows.sceneSource) } as StoryPlace
}

/** The story's locations a `story-inside` rule reads, the tail's first. */
function storyLocations(story: StoryPlace): string[] {
  return [...new Set([story.tail, story.scene])].filter((id) => id != null)
}

const namedOf = (e: Pick<Entity, 'id' | 'name'>): NamedPlace => ({ id: e.id, name: e.name })

/** The places inside `id`, by its stored parents; a looping chain stops at the repeat. */
function descendantsOf(id: string, entities: readonly Entity[], parentOf: ParentOf): Entity[] {
  return entities.filter(
    (e) => e.kind === 'location' && e.id !== id && parentChainIds(e.id, parentOf).includes(id),
  )
}

function holdsStory(id: string, storyLocationId: string | null, parentOf: ParentOf): boolean {
  if (storyLocationId == null) return false
  return storyLocationId === id || parentChainIds(storyLocationId, parentOf).includes(id)
}

/** The places whose own mode is `disabled` on the chain from `start` up, `start` read as given. */
function ownDisabledChain(
  start: { id: string; injectionMode: Entity['injectionMode'] },
  parentId: string | null,
  byId: ReadonlyMap<string, Entity>,
  parentOf: ParentOf,
): Set<string> {
  const disabled = new Set<string>(start.injectionMode === 'disabled' ? [start.id] : [])
  if (parentId == null) return disabled
  for (const id of [parentId, ...parentChainIds(parentId, parentOf)]) {
    const row = byId.get(id)
    if (row?.kind === 'location' && row.injectionMode === 'disabled') disabled.add(id)
  }
  return disabled
}

/** The own-`disabled` places the new chain adds over the old; ignores the story's suspension. */
function gainedDisabled(
  oldParentId: string | null,
  newParentId: string | null,
  byId: ReadonlyMap<string, Entity>,
  parentOf: ParentOf,
): string[] {
  const none = { id: '', injectionMode: 'auto' as const }
  const before = ownDisabledChain(none, oldParentId, byId, parentOf)
  const after = ownDisabledChain(none, newParentId, byId, parentOf)
  return [...after].filter((id) => !before.has(id))
}

/** A retired location the value enters, when it changed; null otherwise. */
export function retiredPlaceEntered(
  id: string | null,
  previousId: string | null,
  entities: readonly Entity[],
): Entity | null {
  if (id == null || id === previousId) return null
  const row = entities.find((e) => e.id === id)
  return row?.kind === 'location' && row.status === 'retired' ? row : null
}

type LocationSave = {
  self: NamedPlace
  draft: LocationDraft
  row: Entity | null
  entities: readonly Entity[]
  byId: ReadonlyMap<string, Entity>
  parentOf: ParentOf
  parentChanged: boolean
  /** The new parent chain runs through the place itself: the handler refuses it as a cycle. */
  loops: boolean
}

function locationSave(args: PlaceSaveArgs & { kind: 'location' }): LocationSave {
  const entities = args.branchEntities
  const parentOf = parentOfLocations(entities)
  const parentId = args.draft.parentLocationId
  // A create's place has no id yet, nothing inside it, and so no loop through it.
  const id = args.row?.id ?? ''
  return {
    self: { id, name: args.draft.name.trim() },
    draft: args.draft,
    row: args.row,
    entities,
    byId: new Map(entities.map((e) => [e.id, e])),
    parentOf,
    parentChanged: args.row == null || parentId !== parentIdOf(args.row),
    loops: parentId != null && (parentId === id || parentChainIds(parentId, parentOf).includes(id)),
  }
}

function locationRefusal(save: LocationSave, storyPlace: StoryPlace): PlaceSaveRefusal | null {
  const { self, draft, row, byId, parentOf, parentChanged, loops } = save
  const wasStatus = row?.status ?? null
  const story =
    row == null
      ? undefined
      : storyLocations(storyPlace)
          .map((id) => byId.get(id))
          .find((at) => at !== undefined && holdsStory(row.id, at.id, parentOf))
  const inside = row != null && story !== undefined
  const storyRefusal = (field: StoryInsideRefusal['field']) =>
    inside
      ? ({ code: PLACE_REFUSAL.storyInside, field, place: self, story: namedOf(story) } as const)
      : null

  if (wasStatus !== 'retired' && draft.status === 'retired' && inside) return storyRefusal('status')
  if (!loops && draft.status !== 'retired') {
    const parent = draft.parentLocationId == null ? undefined : byId.get(draft.parentLocationId)
    const bringsBack = wasStatus === 'retired'
    if (parent?.kind === 'location' && parent.status === 'retired' && (parentChanged || bringsBack))
      return {
        code: PLACE_REFUSAL.retiredParent,
        field: parentChanged ? 'parentLocationId' : 'status',
        parent: namedOf(parent),
      }
  }
  if (!inside) return null
  if (row.injectionMode !== 'disabled' && draft.injectionMode === 'disabled')
    return storyRefusal('injectionMode')
  if (!loops && gainedDisabled(parentIdOf(row), draft.parentLocationId, byId, parentOf).length > 0)
    return storyRefusal('parentLocationId')
  return null
}

/**
 * data-model.md → LocationState shape, judged on the state the Save would leave. Each rule fires
 * on the change it guards, so a row already in breach still saves other fields. First match wins.
 */
export function placeSaveRefusal(args: PlaceSaveArgs): PlaceSaveRefusal | null {
  const { row, branchEntities } = args
  switch (args.kind) {
    case 'character': {
      const was = row == null ? null : (stateOf(row, 'character').current_location_id ?? null)
      const place = retiredPlaceEntered(args.draft.currentLocationId, was, branchEntities)
      return place == null
        ? null
        : { code: PLACE_REFUSAL.retiredPlace, field: 'currentLocationId', place: namedOf(place) }
    }
    case 'item': {
      const was = row == null ? null : (stateOf(row, 'item').at_location_id ?? null)
      const place = retiredPlaceEntered(args.draft.atLocationId, was, branchEntities)
      return place == null
        ? null
        : { code: PLACE_REFUSAL.retiredPlace, field: 'atLocationId', place: namedOf(place) }
    }
    case 'location':
      return locationRefusal(locationSave(args), args.story)
    case 'faction':
      return null
  }
}

/**
 * data-model.md → LocationState shape: a Save retiring a place retires every place inside it that
 * isn't retired yet, with the same reason, in the same action, so one undo restores them all.
 */
export function retireCascade(args: {
  branchId: string
  row: Entity | null
  draft: Pick<LocationDraft, 'status' | 'retiredReason'>
  branchEntities: readonly Entity[]
}): PipelineAction[] {
  const { branchId, row, draft, branchEntities } = args
  if (row == null || row.status === 'retired' || draft.status !== 'retired') return []
  const retiredReason = blankToNull(draft.retiredReason)
  return descendantsOf(row.id, branchEntities, parentOfLocations(branchEntities))
    .filter((e) => e.status !== 'retired')
    .map((e) => ({
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId, id: e.id, patch: { status: 'retired', retiredReason } },
    }))
}

/** The places a retire takes with it, by name. */
type RetirePart = { place: NamedPlace; inside: readonly NamedPlace[] }
/** How many places inside a disable takes out of the story that weren't out already. */
type DisablePart = { place: NamedPlace; count: number }
/**
 * The disabled place a move puts the place inside, and how many places inside it go too.
 * `suspended`: the story is in the region or inside it, so the place stays in until it leaves.
 */
type MovePart = { region: NamedPlace; place: NamedPlace; count: number; suspended: boolean }

/** What a Save asks: at least one part is set. */
export type PlaceSaveConfirm =
  | { retire: RetirePart; disable: DisablePart | null; move: MovePart | null }
  | { retire: null; disable: DisablePart; move: MovePart | null }
  | { retire: null; disable: null; move: MovePart }

function confirmOf({
  retire,
  disable,
  move,
}: {
  retire: RetirePart | null
  disable: DisablePart | null
  move: MovePart | null
}): PlaceSaveConfirm | null {
  if (retire != null) return { retire, disable, move }
  if (disable != null) return { retire, disable, move }
  if (move != null) return { retire, disable, move }
  return null
}

/**
 * world.md → Settings: what a location update's Save asks before it writes, one confirm for all
 * of it; null when it asks nothing, or when the Save will be refused anyway.
 */
export function placeSaveConfirm(args: PlaceSaveArgs): PlaceSaveConfirm | null {
  if (args.kind !== 'location' || args.row == null) return null
  if (placeSaveRefusal(args) != null) return null
  const row = args.row
  const save = locationSave(args)
  const { draft, entities, byId, parentOf } = save
  const inside = descendantsOf(row.id, entities, parentOf)

  const retiring = row.status !== 'retired' && draft.status === 'retired'
  const taken = retiring ? inside.filter((e) => e.status !== 'retired').sort(byName) : []
  const retire = taken.length > 0 ? { place: save.self, inside: taken.map(namedOf) } : null

  let disable: DisablePart | null = null
  if (row.injectionMode !== 'disabled' && draft.injectionMode === 'disabled') {
    const modes = placeModes(entities, args.story.scene)
    const count = inside.filter((e) => !modes.isDisabled(e.id)).length
    if (count > 0) disable = { place: save.self, count }
  }

  let move: MovePart | null = null
  const parentId = draft.parentLocationId
  const gained = save.loops ? [] : gainedDisabled(parentIdOf(row), parentId, byId, parentOf)
  if (parentId != null && gained.length > 0) {
    const regionId = [parentId, ...parentChainIds(parentId, parentOf)].find((id) =>
      gained.includes(id),
    )
    const region = regionId == null ? undefined : byId.get(regionId)
    // Before the move, with the draft's own mode: a place already out of the story loses nothing.
    const withMode = entities.map((e) =>
      e.id === row.id ? { ...e, injectionMode: draft.injectionMode } : e,
    )
    const before = placeModes(withMode, args.story.scene)
    if (region !== undefined && !before.isDisabled(row.id))
      move = {
        region: namedOf(region),
        place: save.self,
        count: inside.filter((e) => !before.isDisabled(e.id)).length,
        suspended: holdsStory(region.id, args.story.scene, parentOf),
      }
  }

  return confirmOf({ retire, disable, move })
}

export type MergedPlace = {
  status: Entity['status']
  injectionMode: Entity['injectionMode']
  parentId: string | null
}

/** The canonical location as a built merge leaves it: its own patch over the row, any promotion. */
export function mergedPlaceOf(actions: readonly PipelineAction[], canonical: Entity): MergedPlace {
  let merged: MergedPlace = {
    status: canonical.status,
    injectionMode: canonical.injectionMode,
    parentId: parentIdOf(canonical),
  }
  for (const action of actions) {
    if (action.kind === 'promoteStagedEntity' && action.payload.id === canonical.id)
      merged = { ...merged, status: 'active' }
    if (action.kind !== 'updateEntity' || action.payload.id !== canonical.id) continue
    const { patch } = action.payload
    merged = {
      status: patch.status ?? merged.status,
      injectionMode: patch.injectionMode ?? merged.injectionMode,
      parentId:
        patch.state === undefined
          ? merged.parentId
          : ((patch.state as LocationState).parent_location_id ?? null),
    }
  }
  return merged
}

type MergePair = { canonical: Entity; loser: Entity }

/** Whether the merge puts the story's place at `at` inside a disabled place it wasn't inside. */
function storyGainsDisabled(
  at: string,
  { canonical, loser }: MergePair,
  merged: MergedPlace,
  byId: ReadonlyMap<string, Entity>,
  parentOf: ParentOf,
): boolean {
  const inLoser = holdsStory(loser.id, at, parentOf)
  const inCanonical = holdsStory(canonical.id, at, parentOf)
  if (!inLoser && !inCanonical) return false
  // The story's side, read before and after; the pair is one place after, so the loser counts as
  // the canonical. A nested pair holds the story under both, and its chain runs through the inner.
  const canonicalInsideLoser = parentChainIds(canonical.id, parentOf).includes(loser.id)
  const side = inCanonical && (!inLoser || canonicalInsideLoser) ? canonical : loser
  const sideChain = ownDisabledChain(
    { id: canonical.id, injectionMode: side.injectionMode },
    parentIdOf(side),
    byId,
    parentOf,
  )
  const before = new Set([...sideChain].map((id) => (id === loser.id ? canonical.id : id)))
  const after = ownDisabledChain(
    { id: canonical.id, injectionMode: merged.injectionMode },
    merged.parentId,
    byId,
    parentOf,
  )
  return [...after].some((id) => !before.has(id))
}

/**
 * world.md → Merge, on the place the merge would leave: retired with the story in either place, or
 * with a place inside either that isn't retired; not retired under a retired parent, moved or not;
 * or the story's place gaining a disabled place.
 */
export function mergePlaceRefusal(args: {
  canonical: Entity
  loser: Entity
  /** The built merge, which the canonical's merged status, mode and parent are read off. */
  actions: readonly PipelineAction[]
  branchEntities: readonly Entity[]
  story: StoryPlace
}): MergePlaceRefusalCode | null {
  const { canonical, loser, branchEntities } = args
  const merged = mergedPlaceOf(args.actions, canonical)
  const parentOf = parentOfLocations(branchEntities)
  const byId = new Map(branchEntities.map((e) => [e.id, e]))
  const storyAt = storyLocations(args.story)

  if (merged.status === 'retired') {
    const holds = (id: string) => storyAt.some((at) => holdsStory(id, at, parentOf))
    if (holds(loser.id) || holds(canonical.id)) return PLACE_REFUSAL.storyInside
    const pair = new Set([canonical.id, loser.id])
    const inside = [
      ...descendantsOf(canonical.id, branchEntities, parentOf),
      ...descendantsOf(loser.id, branchEntities, parentOf),
    ]
    if (inside.some((e) => !pair.has(e.id) && e.status !== 'retired'))
      return PLACE_REFUSAL.placesInside
  } else {
    const parent = merged.parentId == null ? undefined : byId.get(merged.parentId)
    if (parent?.kind === 'location' && parent.status === 'retired')
      return PLACE_REFUSAL.retiredParent
  }

  const gains = (at: string) => storyGainsDisabled(at, { canonical, loser }, merged, byId, parentOf)
  return storyAt.some(gains) ? PLACE_REFUSAL.storyInside : null
}
