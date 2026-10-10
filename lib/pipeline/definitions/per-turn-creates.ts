import type { PipelineAction } from '@/lib/actions'
import {
  clampEmbeddedCharacter,
  decideNewItem,
  scoreDescriptions,
  type EmbedDescriptions,
  type ItemMatchFlag,
} from '@/lib/classifier'
import type { CollisionReason, Entity, ItemState, LocationState } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  isCreateHandle,
  type NewItemEmission,
  type NewItemReport,
  type NewLocationEmission,
  type NewLocationReport,
  type ParsedStateBlock,
  type TurnCreatesReport,
} from '@/lib/piggyback'
import {
  checkParentChain,
  itemNamesakes,
  matchNewLocation,
  nameBasis,
  parentOfLocations,
} from '@/lib/world'

export type TurnCreatePlan = {
  /** The block with every declared handle resolved or removed; no newLocations / newItems. */
  block: ParsedStateBlock
  /** createEntity actions: parents before children, locations before items. */
  creates: PipelineAction[]
  /** The rows `creates` insert, for buildPiggybackActions' lookups. */
  createdRows: Entity[]
  /** Staged siblings a location create reused, to promote. */
  reusedIds: string[]
  report: TurnCreatesReport
}

type LocationFate = {
  outcome: 'created' | 'reused'
  id: string
  /** Where the row sits; null at the root. */
  parentId: string | null
  parentDropped: boolean
}

type Settling = { emission: NewLocationEmission; parentUnresolved: boolean }

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

function logDropped(kind: 'location' | 'item', emission: { handle: string; name: string }): void {
  logger.debug('classifier.create_dropped', { kind, handle: emission.handle, name: emission.name })
}

function logParentDropped(
  emission: NewLocationEmission,
  cause: 'unresolved' | 'chain-broken',
): void {
  logger.warn('classifier.create_parent_dropped', {
    handle: emission.handle,
    parent: emission.parent,
    cause,
  })
}

/** piggyback.md → Kept only if used: the current location and every place it is part of. */
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

/** A new item stays only when a transfer hands it to a character. */
function keptItemHandles(block: ParsedStateBlock, byId: ReadonlyMap<string, Entity>): Set<string> {
  const declared = new Set((block.newItems ?? []).map((i) => i.handle))
  const kept = new Set<string>()
  for (const transfer of block.transfers?.items ?? []) {
    if (!declared.has(transfer.id) || transfer.to === undefined) continue
    if (byId.get(transfer.to)?.kind === 'character') kept.add(transfer.id)
  }
  return kept
}

function inHandleCycle(
  create: NewLocationEmission,
  waiting: readonly NewLocationEmission[],
): boolean {
  const parentOf = new Map(waiting.map((e) => [e.handle, e.parent]))
  const seen = new Set<string>()
  let at = create.parent
  while (at !== undefined && !seen.has(at)) {
    if (at === create.handle) return true
    seen.add(at)
    at = parentOf.get(at)
  }
  return false
}

/**
 * Top-down passes over emission order, so a child listed before its parent settles on a later
 * pass. A parent that never resolves (an undeclared handle, an id naming no location, a handle
 * cycle) sends its create to the root; a child of that create still hangs under it.
 */
function settlingOrder(
  creates: readonly NewLocationEmission[],
  isLocationId: (id: string) => boolean,
): Settling[] {
  const order: Settling[] = []
  const settled = new Set<string>()
  const settle = (emission: NewLocationEmission, parentUnresolved: boolean) => {
    order.push({ emission, parentUnresolved })
    settled.add(emission.handle)
  }
  const resolvable = (parent: string | undefined) =>
    parent === undefined || settled.has(parent) || (!isCreateHandle(parent) && isLocationId(parent))

  let waiting = [...creates]
  while (waiting.length > 0) {
    const before = order.length
    for (const emission of waiting) if (resolvable(emission.parent)) settle(emission, false)
    if (order.length === before) {
      const handles = new Set(waiting.map((e) => e.handle))
      const orphans = waiting.filter((e) => e.parent === undefined || !handles.has(e.parent))
      // No orphan: every waiting create is in a handle cycle or hangs off one.
      const stuck = orphans.length > 0 ? orphans : waiting.filter((e) => inHandleCycle(e, waiting))
      for (const emission of stuck) settle(emission, true)
    }
    waiting = waiting.filter((e) => !settled.has(e.handle))
  }
  return order
}

function planLocations(args: {
  emissions: readonly NewLocationEmission[]
  kept: ReadonlySet<string>
  entities: readonly Entity[]
  byId: ReadonlyMap<string, Entity>
  branchId: string
  now: () => number
  newId: (prefix: 'loc') => string
}): { fates: Map<string, LocationFate>; rows: Entity[]; reusedIds: string[] } {
  const { entities, byId } = args
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
    let parentId =
      parentUnresolved || parent === undefined ? null : (fates.get(parent)?.id ?? parent)
    let parentDropped = parentUnresolved
    if (parentUnresolved) {
      logParentDropped(emission, 'unresolved')
    } else if (
      parentId !== null &&
      // The new row has no children, so only a loop already stored above its parent fails.
      checkParentChain(emission.handle, parentId, parentOfLocations([...entities, ...rows])) !==
        'ok'
    ) {
      logParentDropped(emission, 'chain-broken')
      parentId = null
      parentDropped = true
    }

    const text = storedText(emission)
    const twin = placed.find(
      (p) => p.parentId === parentId && nameBasis(p.name, text.name) === 'same-name',
    )
    let fate: LocationFate
    if (twin !== undefined) {
      fate = { outcome: 'reused', id: twin.id, parentId, parentDropped }
    } else {
      const match = matchNewLocation({ name: text.name, parentId }, entities)
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
  return decideNewItem(namesakes.map((entity, i) => ({ entity, similarity: scores[i] ?? null })))
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
  const ids = new Map<string, string>()
  const rows: Entity[] = []
  for (const emission of args.emissions) {
    if (!args.kept.has(emission.handle)) continue
    const text = storedText(emission)
    const flag = await itemFlag(text, args.entities, args.embed)
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
  block: ParsedStateBlock,
  ids: ReadonlyMap<string, string>,
  itemIds: ReadonlyMap<string, string>,
): ParsedStateBlock {
  const resolve = (ref: string, from: ReadonlyMap<string, string>): string | undefined =>
    isCreateHandle(ref) ? from.get(ref) : ref
  const out: ParsedStateBlock = { ...block }
  delete out.newLocations
  delete out.newItems
  if (block.sceneEntities !== undefined) {
    out.sceneEntities = block.sceneEntities.flatMap((ref) => {
      const id = resolve(ref, ids)
      return id === undefined ? [] : [id]
    })
  }
  if (block.currentLocation !== undefined) {
    const id = resolve(block.currentLocation, ids)
    if (id === undefined) delete out.currentLocation
    else out.currentLocation = id
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
  return out
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
 * and resolves every handle the block's other fields name. Expects a block whose ids are already
 * substituted and whose creates passed `normalizeCreates`.
 */
export async function planTurnCreates(input: {
  block: ParsedStateBlock
  /** The branch's entities (entitiesStore, whole branch). */
  entities: readonly Entity[]
  branchId: string
  source: 'piggyback_tagged_block' | 'per_turn_classifier'
  embed: EmbedDescriptions
  now: () => number
  newId: (prefix: 'loc' | 'item') => string
}): Promise<TurnCreatePlan> {
  const { block, entities, branchId, source, embed, now, newId } = input
  const byId = new Map(entities.map((e) => [e.id, e]))
  const locations = block.newLocations ?? []
  const items = block.newItems ?? []
  const keptLocations = keptLocationHandles(block)
  const keptItems = keptItemHandles(block, byId)
  for (const emission of locations) {
    if (!keptLocations.has(emission.handle)) logDropped('location', emission)
  }
  for (const emission of items) {
    if (!keptItems.has(emission.handle)) logDropped('item', emission)
  }

  const places = planLocations({
    emissions: locations,
    kept: keptLocations,
    entities,
    byId,
    branchId,
    now,
    newId,
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
      (entry): PipelineAction => ({ kind: 'createEntity', source, payload: { entry } }),
    ),
    createdRows,
    reusedIds: places.reusedIds,
    report: {
      newLocations: locations.map((e) => locationReport(e, places.fates.get(e.handle))),
      newItems: items.map((e) => itemReport(e, things.ids.get(e.handle))),
    },
  }
}

/** A failed fold: nothing is created; every create reports `dropped`, every declared handle is dropped where it stands. */
export function skipTurnCreates(block: ParsedStateBlock): TurnCreatePlan {
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
