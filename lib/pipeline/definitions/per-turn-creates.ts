import type { PipelineAction } from '@/lib/actions'
import {
  clampEmbeddedCharacter,
  decideNewItem,
  scoreDescriptions,
  type EmbedDescriptions,
  type ItemMatchFlag,
} from '@/lib/classifier'
import type { CollisionReason, Entity, ItemState, LocationState } from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
import {
  boundStateText,
  isCreateHandle,
  type NewItemEmission,
  type NewItemReport,
  type NewLocationEmission,
  type NewLocationReport,
  type ParsedStateBlock,
  type PlannedStateBlock,
  type PlannedTurn,
  type SubstitutedStateBlock,
} from '@/lib/piggyback'
import {
  checkParentChain,
  itemNamesakes,
  locationMapView,
  matchNewPlace,
  parentOfLocations,
  placeNewLocation,
  settlingOrder,
  TOP_LEVEL,
  withPlacement,
  type ParentDropCause,
  type PlacePlacement,
  type SettledNewPlace,
} from '@/lib/world'

type CreateEntityAction = Extract<PipelineAction, { kind: 'createEntity' }>
type PlaceLocationAction = Extract<PipelineAction, { kind: 'placeLocation' }>

export type TurnCreatePlan = PlannedTurn & {
  /** Insert `createdRows`: parents before children, locations before items. */
  creates: CreateEntityAction[]
  /** A reused unplaced place's placement; emitted after `creates`, before every other write. */
  placements: PlaceLocationAction[]
}

type LocationFate = {
  outcome: 'created' | 'reused'
  id: string
  /** The create's settled placement, unplaced if its parent dropped; a reused row keeps its own. */
  placement: PlacePlacement
  parentDropped: boolean
}

// piggyback.md → Parent: a parent the planner can't use leaves the place unplaced.
const UNPLACED: PlacePlacement = { kind: 'unplaced' }

type StoredText = { name: string; description: string }

type RowShape = { kind: 'location'; state: LocationState } | { kind: 'item'; state: ItemState }

// piggyback.md → Creating a place or an item: the bounds a classifier character create uses.
function storedText(emission: StoredText): StoredText {
  return clampEmbeddedCharacter({ name: emission.name, description: emission.description.trim() })
}

function newRow(args: {
  id: string
  branchId: string
  shape: RowShape
  text: StoredText
  flag: { partnerId: string; reason: CollisionReason } | null
  at: number
}): Entity {
  const { id, branchId, shape, text, flag, at } = args
  return {
    id,
    branchId,
    kind: shape.kind,
    name: text.name,
    description: text.description === '' ? null : text.description,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: flag === null ? 0 : 1,
    nameCollisionPartnerId: flag?.partnerId ?? null,
    nameCollisionReason: flag?.reason ?? null,
    state: shape.state,
    tags: [],
    keywords: [],
    priority: 0,
    // Nothing embeds on the write path: the sync stage owns the vector.
    embeddingStale: 1,
    createdAt: at,
    updatedAt: at,
  }
}

function logDropped(
  log: Logger,
  kind: 'location' | 'item',
  emission: { handle: string; name: string },
): void {
  log.debug('classifier.create_dropped', { kind, handle: emission.handle, name: emission.name })
}

function logParentDropped(
  log: Logger,
  handle: string,
  drop: { parent: string; cause: ParentDropCause | 'cycle' },
): void {
  log.warn('classifier.create_parent_dropped', { handle, parent: drop.parent, cause: drop.cause })
}

// data-model.md → LocationState shape: a machine writer walks a placement first and drops a loop.
function placementLoop(
  id: string,
  parentId: string,
  parentOf: (id: string) => string | null,
): { parent: string; cause: 'cycle' | 'chain-broken' } | null {
  const walk = checkParentChain(id, parentId, parentOf)
  if (walk === 'ok') return null
  return { parent: parentId, cause: walk === 'cycle' ? 'cycle' : 'chain-broken' }
}

// piggyback.md → Creating a place or an item: a condition the prose shows, under a visual value's
// bound.
function createdCondition(
  emission: { handle: string; condition?: string },
  log: Logger,
): { condition?: string } {
  if (emission.condition === undefined) return {}
  const { text, cut } = boundStateText(emission.condition)
  if (cut)
    log.warn('classifier.condition_truncated', {
      handle: emission.handle,
      length: emission.condition.length,
      keptLength: text.length,
    })
  return { condition: text }
}

/** piggyback.md → Kept only if used. */
function keptLocationHandles(block: ParsedStateBlock): Set<string> {
  const parentOf = new Map((block.newLocations ?? []).map((l) => [l.handle, l.parent]))
  const kept = new Set<string>()
  let at = block.currentLocation
  while (at !== undefined && parentOf.has(at) && !kept.has(at)) {
    kept.add(at)
    at = parentOf.get(at)
  }
  return kept
}

/** A new item stays only when the last transfer naming it, a drop included, leaves it with a character. */
function keptItemHandles(block: ParsedStateBlock, byId: ReadonlyMap<string, Entity>): Set<string> {
  const declared = new Set((block.newItems ?? []).map((i) => i.handle))
  const last = new Map<string, { seq: number; to: string | undefined }>()
  const note = (id: string, seq: number, to: string | undefined) => {
    const prior = last.get(id)
    if (declared.has(id) && (prior === undefined || seq >= prior.seq)) last.set(id, { seq, to })
  }
  for (const transfer of block.transfers?.items ?? []) note(transfer.id, transfer.seq, transfer.to)
  for (const drop of block.transfers?.drops ?? []) note(drop.id, drop.seq, undefined)
  const kept = new Set<string>()
  for (const [handle, { to }] of last)
    if (to !== undefined && byId.get(to)?.kind === 'character') kept.add(handle)
  return kept
}

function planLocations(args: {
  emissions: readonly NewLocationEmission[]
  kept: ReadonlySet<string>
  entities: readonly Entity[]
  byId: ReadonlyMap<string, Entity>
  mapCurrentLocationId: string | null
  branchId: string
  source: PlaceLocationAction['source']
  now: () => number
  newId: (prefix: 'loc') => string
  log: Logger
}): {
  fates: Map<string, LocationFate>
  rows: Entity[]
  reusedIds: string[]
  placements: PlaceLocationAction[]
} {
  const { entities, byId } = args
  const view = locationMapView(entities, args.mapCurrentLocationId)
  const fates = new Map<string, LocationFate>()
  const rows: Entity[] = []
  const reused = new Set<string>()
  const placed: SettledNewPlace[] = []
  const placements: PlaceLocationAction[] = []
  // Where this turn's placements put a reused place, so a later walk sees it there.
  const placedParents = new Map<string, string | null>()
  // The rows this turn placed, as matching must see them: no longer unplaced.
  const placedRows = new Map<string, Entity>()

  // normalizeCreates already dropped a second declaration of a handle, so none is a duplicate.
  const { order } = settlingOrder(
    args.emissions.filter((e) => args.kept.has(e.handle)),
    (id) => byId.get(id)?.kind === 'location',
  )
  for (const place of order) {
    const { emission } = place
    const storedParentOf = parentOfLocations([...entities, ...rows])
    const parentOf = (id: string): string | null =>
      placedParents.has(id) ? (placedParents.get(id) ?? null) : storedParentOf(id)
    const placement = placeNewLocation({
      place,
      resolve: (parent) => fates.get(parent)?.id ?? parent,
      statusOf: (id) => byId.get(id)?.status,
      parentOf,
    })
    let parentDropped = placement.kind === 'dropped'
    if (placement.kind === 'dropped') logParentDropped(args.log, emission.handle, placement)
    const candidate = placement.kind === 'kept' ? placement.placement : UNPLACED

    const text = storedText(emission)
    // Stale hiddenBetween above a row placed here is harmless: the one chain settles top-down.
    const match = matchNewPlace(
      { name: text.name, placement: candidate },
      placed,
      placedRows.size === 0
        ? view
        : { ...view, locations: view.locations.map((e) => placedRows.get(e.id) ?? e) },
      placedParents,
    )
    let id: string
    if (match.kind === 'create') {
      const row = newRow({
        id: args.newId('loc'),
        branchId: args.branchId,
        shape: {
          kind: 'location',
          state: withPlacement(
            { parent_location_id: null, ...createdCondition(emission, args.log) },
            candidate,
          ),
        },
        text,
        flag: match.flag,
        at: args.now(),
      })
      rows.push(row)
      id = row.id
    } else {
      id = match.id
      if (match.kind === 'reuse' && byId.get(id)?.status === 'staged') reused.add(id)
      // data-model.md → Authorship contract: the writer places only an unplaced place it reuses:
      // a row, or this block's own create taken over.
      if (match.place && candidate.kind !== 'unplaced') {
        const loop =
          candidate.kind === 'under' ? placementLoop(id, candidate.parentId, parentOf) : null
        if (loop === null) {
          placedParents.set(id, candidate.kind === 'under' ? candidate.parentId : null)
          const row = byId.get(id)
          if (row !== undefined)
            placedRows.set(id, {
              ...row,
              state: withPlacement(row.state as LocationState, candidate),
            })
          placements.push({
            kind: 'placeLocation',
            source: args.source,
            payload: { branchId: args.branchId, id, placement: candidate, proseEntryId: null },
          })
        } else {
          parentDropped = true
          logParentDropped(args.log, emission.handle, loop)
        }
      }
    }
    fates.set(emission.handle, {
      outcome: match.kind === 'create' ? 'created' : 'reused',
      id,
      placement: candidate,
      parentDropped,
    })
    placed.push({ name: text.name, placement: candidate, id })
  }
  return { fates, rows, reusedIds: [...reused], placements }
}

/** piggyback.md → Matching before creating: an item is never reused, only flagged. */
async function itemFlag(
  text: StoredText,
  entities: readonly Entity[],
  embed: EmbedDescriptions,
  log: Logger,
): Promise<ItemMatchFlag | null> {
  const namesakes = itemNamesakes(text.name, entities)
  if (namesakes.length === 0) return null
  const scores = await scoreDescriptions(
    text.description,
    namesakes.map((n) => n.description),
    embed,
    log,
  )
  return decideNewItem(namesakes.map((entity, i) => ({ entity, similarity: scores[i] })))
}

async function planItems(args: {
  emissions: readonly NewItemEmission[]
  kept: ReadonlySet<string>
  entities: readonly Entity[]
  branchId: string
  embed: EmbedDescriptions
  now: () => number
  newId: (prefix: 'item') => string
  log: Logger
}): Promise<{ ids: Map<string, string>; rows: Entity[] }> {
  const scored = await Promise.all(
    args.emissions
      .filter((emission) => args.kept.has(emission.handle))
      .map(async (emission) => {
        const text = storedText(emission)
        return { emission, text, flag: await itemFlag(text, args.entities, args.embed, args.log) }
      }),
  )
  // Ids are drawn once every score is in, so they follow emission order, not embed timing.
  const ids = new Map<string, string>()
  const rows: Entity[] = []
  for (const { emission, text, flag } of scored) {
    const row = newRow({
      id: args.newId('item'),
      branchId: args.branchId,
      shape: {
        kind: 'item',
        state: { at_location_id: null, ...createdCondition(emission, args.log) },
      },
      text,
      flag,
      at: args.now(),
    })
    rows.push(row)
    ids.set(emission.handle, row.id)
  }
  return { ids, rows }
}

function rewriteHandles(
  block: SubstitutedStateBlock,
  ids: ReadonlyMap<string, string>,
  itemIds: ReadonlyMap<string, string>,
  log: Logger,
): PlannedStateBlock {
  const resolve = (ref: string, from: ReadonlyMap<string, string>): string | undefined =>
    isCreateHandle(ref) ? from.get(ref) : ref
  const { newLocations, newItems, ...rest } = block
  const out: ParsedStateBlock = rest
  if (block.sceneEntities !== undefined) {
    out.sceneEntities = block.sceneEntities.flatMap((ref) => {
      const id = resolve(ref, ids)
      return id === undefined ? [] : [id]
    })
  }
  if (block.currentLocation !== undefined) {
    const ref = block.currentLocation
    const id = resolve(ref, ids)
    // An item's handle stays for apply.ts to reject, as an item's id is: piggyback.md → Where a
    // handle is used.
    if (id !== undefined) out.currentLocation = id
    else if (!(newItems ?? []).some((item) => item.handle === ref)) delete out.currentLocation
  }
  if (block.transfers !== undefined) {
    out.transfers = {
      ...block.transfers,
      // Only an item's handle names something a holder can carry.
      items: block.transfers.items.flatMap((transfer) => {
        const id = resolve(transfer.id, itemIds)
        return id === undefined ? [] : [{ ...transfer, id }]
      }),
      // A new item the block didn't keep stays prose with its drop, so no handle reaches apply.ts,
      // whose position write to a missing row would fail the turn.
      drops: block.transfers.drops.flatMap((drop) => {
        const id = resolve(drop.id, itemIds)
        if (id !== undefined) return [{ ...drop, id }]
        log.debug('classifier.drop_dropped', { handle: drop.id, reason: 'not-created' })
        return []
      }),
    }
  }
  return out as PlannedStateBlock
}

// data-model.md → Entry metadata shape: a placed create's parent id, `top` for a top-level one,
// none for an unplaced one.
function reportedParent(placement: PlacePlacement): string | undefined {
  if (placement.kind === 'under') return placement.parentId
  return placement.kind === 'top' ? TOP_LEVEL : undefined
}

function locationReport(
  emission: NewLocationEmission,
  fate: LocationFate | undefined,
): NewLocationReport {
  const { handle, name, description } = emission
  if (fate === undefined) {
    return {
      handle,
      name,
      description,
      ...(emission.parent !== undefined ? { parent: emission.parent } : {}),
      outcome: 'dropped',
    }
  }
  // A dropped parent reports what was emitted; a kept one, where the planner settled the create.
  const parent = fate.parentDropped ? emission.parent : reportedParent(fate.placement)
  return {
    handle,
    name,
    description,
    ...(parent !== undefined ? { parent } : {}),
    outcome: fate.outcome,
    id: fate.id,
    ...(fate.parentDropped ? { parentDropped: true as const } : {}),
  }
}

function itemReport(emission: NewItemEmission, id: string | undefined): NewItemReport {
  const { handle, name, description } = emission
  return id === undefined
    ? { handle, name, description, outcome: 'dropped' }
    : { handle, name, description, outcome: 'created', id }
}

/**
 * piggyback.md → New locations and items: keeps, nests, matches and writes the block's creates,
 * and resolves every handle the block's other fields name, bar an uncreated item's as the location.
 */
export async function planTurnCreates(input: {
  block: SubstitutedStateBlock
  /** The branch's entities (entitiesStore, whole branch). */
  entities: readonly Entity[]
  /** The location the prompt's `# Places` map was built around, so reuse sees what it showed. */
  mapCurrentLocationId: string | null
  branchId: string
  source: 'piggyback_tagged_block' | 'per_turn_classifier'
  embed: EmbedDescriptions
  now: () => number
  newId: (prefix: 'loc' | 'item') => string
  /** The phase's logger, so a dropped create's entry carries the action. */
  log: Logger
}): Promise<TurnCreatePlan> {
  const { block, entities, mapCurrentLocationId, branchId, source, embed, now, newId, log } = input
  const byId = new Map(entities.map((e) => [e.id, e]))
  const locations = block.newLocations ?? []
  const items = block.newItems ?? []
  const keptLocations = keptLocationHandles(block)
  const keptItems = keptItemHandles(block, byId)
  for (const emission of locations) {
    if (!keptLocations.has(emission.handle)) logDropped(log, 'location', emission)
  }
  for (const emission of items) {
    if (!keptItems.has(emission.handle)) logDropped(log, 'item', emission)
  }

  const places = planLocations({
    emissions: locations,
    kept: keptLocations,
    entities,
    byId,
    mapCurrentLocationId,
    branchId,
    source,
    now,
    newId,
    log,
  })
  const things = await planItems({
    emissions: items,
    kept: keptItems,
    entities,
    branchId,
    embed,
    now,
    newId,
    log,
  })

  const ids = new Map(things.ids)
  for (const [handle, fate] of places.fates) ids.set(handle, fate.id)
  const createdRows = [...places.rows, ...things.rows]
  return {
    block: rewriteHandles(block, ids, things.ids, log),
    creates: createdRows.map(
      (entry): CreateEntityAction => ({ kind: 'createEntity', source, payload: { entry } }),
    ),
    createdRows,
    reusedIds: places.reusedIds,
    placements: places.placements,
    report: {
      newLocations: locations.map((e) => locationReport(e, places.fates.get(e.handle))),
      newItems: items.map((e) => itemReport(e, things.ids.get(e.handle))),
    },
  }
}

/**
 * A failed fold: nothing is created; every create reports `dropped`, every declared handle is
 * dropped where it stands, bar an item's as the location.
 */
export function skipTurnCreates(block: SubstitutedStateBlock, log: Logger): TurnCreatePlan {
  const none = new Map<string, string>()
  return {
    block: rewriteHandles(block, none, none, log),
    creates: [],
    createdRows: [],
    reusedIds: [],
    placements: [],
    report: {
      newLocations: (block.newLocations ?? []).map((e) => locationReport(e, undefined)),
      newItems: (block.newItems ?? []).map((e) => itemReport(e, undefined)),
    },
  }
}
