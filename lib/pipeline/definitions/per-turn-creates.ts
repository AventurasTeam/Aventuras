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
  itemNamesakes,
  locationMapView,
  matchNewLocation,
  nameBasis,
  parentOfLocations,
  placeNewLocation,
  settlingOrder,
  type ParentDropCause,
} from '@/lib/world'

type CreateEntityAction = Extract<PipelineAction, { kind: 'createEntity' }>

export type TurnCreatePlan = PlannedTurn & {
  /** Insert `createdRows`: parents before children, locations before items. */
  creates: CreateEntityAction[]
}

type LocationFate = {
  outcome: 'created' | 'reused'
  id: string
  /** Where the row sits; null at the root. */
  parentId: string | null
  parentDropped: boolean
}

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
  emission: NewLocationEmission,
  cause: ParentDropCause,
): void {
  log.warn('classifier.create_parent_dropped', {
    handle: emission.handle,
    parent: emission.parent,
    cause,
  })
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

/** A new item stays only when the last transfer naming it leaves it with a character. */
function keptItemHandles(block: ParsedStateBlock, byId: ReadonlyMap<string, Entity>): Set<string> {
  const declared = new Set((block.newItems ?? []).map((i) => i.handle))
  const lastTo = new Map<string, string | undefined>()
  for (const transfer of block.transfers?.items ?? [])
    if (declared.has(transfer.id)) lastTo.set(transfer.id, transfer.to)
  const kept = new Set<string>()
  for (const [handle, to] of lastTo)
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
  now: () => number
  newId: (prefix: 'loc') => string
  log: Logger
}): { fates: Map<string, LocationFate>; rows: Entity[]; reusedIds: string[] } {
  const { entities, byId } = args
  const view = locationMapView(entities, args.mapCurrentLocationId)
  const fates = new Map<string, LocationFate>()
  const rows: Entity[] = []
  const reused = new Set<string>()
  const placed: { name: string; parentId: string | null; id: string }[] = []

  const order = settlingOrder(
    args.emissions.filter((e) => args.kept.has(e.handle)),
    (id) => byId.get(id)?.kind === 'location',
  )
  for (const { emission, parentUnresolved } of order) {
    const { parent } = emission
    const placement = placeNewLocation({
      handle: emission.handle,
      parentId: parentUnresolved || parent === undefined ? null : (fates.get(parent)?.id ?? parent),
      parentUnresolved,
      statusOf: (id) => byId.get(id)?.status,
      parentOf: parentOfLocations([...entities, ...rows]),
    })
    const { parentId } = placement
    const parentDropped = placement.dropped !== null
    if (placement.dropped !== null) logParentDropped(args.log, emission, placement.dropped)

    const text = storedText(emission)
    const twin = placed.find(
      (p) => p.parentId === parentId && nameBasis(p.name, text.name) === 'same-name',
    )
    let fate: LocationFate
    if (twin !== undefined) {
      fate = { outcome: 'reused', id: twin.id, parentId, parentDropped }
    } else {
      const match = matchNewLocation({ name: text.name, parentId }, view)
      if (match.kind === 'reuse') {
        if (byId.get(match.id)?.status === 'staged') reused.add(match.id)
        fate = { outcome: 'reused', id: match.id, parentId, parentDropped }
      } else {
        const row = newRow({
          id: args.newId('loc'),
          branchId: args.branchId,
          shape: { kind: 'location', state: { parent_location_id: parentId } },
          text,
          flag: match.flag,
          at: args.now(),
        })
        rows.push(row)
        fate = { outcome: 'created', id: row.id, parentId, parentDropped }
      }
    }
    fates.set(emission.handle, fate)
    placed.push({ name: text.name, parentId, id: fate.id })
  }
  return { fates, rows, reusedIds: [...reused] }
}

/** piggyback.md → Matching before creating: an item is never reused, only flagged. */
async function itemFlag(
  text: StoredText,
  entities: readonly Entity[],
  embed: EmbedDescriptions,
): Promise<ItemMatchFlag | null> {
  const namesakes = itemNamesakes(text.name, entities)
  if (namesakes.length === 0) return null
  const scores = await scoreDescriptions(
    text.description,
    namesakes.map((n) => n.description),
    embed,
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
}): Promise<{ ids: Map<string, string>; rows: Entity[] }> {
  const scored = await Promise.all(
    args.emissions
      .filter((emission) => args.kept.has(emission.handle))
      .map(async (emission) => {
        const text = storedText(emission)
        return { emission, text, flag: await itemFlag(text, args.entities, args.embed) }
      }),
  )
  // Ids are drawn once every score is in, so they follow emission order, not embed timing.
  const ids = new Map<string, string>()
  const rows: Entity[] = []
  for (const { emission, text, flag } of scored) {
    const row = newRow({
      id: args.newId('item'),
      branchId: args.branchId,
      shape: { kind: 'item', state: { at_location_id: null } },
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
    }
  }
  return out as PlannedStateBlock
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
  // A dropped parent reports what was emitted; a resolved one, the id it resolved to.
  const parent = fate.parentDropped ? emission.parent : (fate.parentId ?? undefined)
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
  })

  const ids = new Map(things.ids)
  for (const [handle, fate] of places.fates) ids.set(handle, fate.id)
  const createdRows = [...places.rows, ...things.rows]
  return {
    block: rewriteHandles(block, ids, things.ids),
    creates: createdRows.map(
      (entry): CreateEntityAction => ({ kind: 'createEntity', source, payload: { entry } }),
    ),
    createdRows,
    reusedIds: places.reusedIds,
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
export function skipTurnCreates(block: SubstitutedStateBlock): TurnCreatePlan {
  const none = new Map<string, string>()
  return {
    block: rewriteHandles(block, none, none),
    creates: [],
    createdRows: [],
    reusedIds: [],
    report: {
      newLocations: (block.newLocations ?? []).map((e) => locationReport(e, undefined)),
      newItems: (block.newItems ?? []).map((e) => itemReport(e, undefined)),
    },
  }
}
