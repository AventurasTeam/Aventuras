import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { CharacterState, Entity, EntryMetadata, ItemState } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { normalizeTerm } from '@/lib/keyword-terms'

import { dedupeSceneEntities, scenePromotionActions, sceneTrackingActions } from './scene-tracking'
import { MAX_RETRIEVAL_QUERIES, type ParsedStateBlock } from './types'
import { resolvePiggybackWorldTimeDelta } from './world-time'

// Two producers write this field; only the tagged-block parser filters itself (trims,
// dedupes, caps) — the classifier fallback only counts, so blanks/dupes reach here raw.
// Dedupe before the cap so a repeat doesn't spend a slot a distinct ask needed (retrieval.md → Q4).
function normalizeRetrievalQueries(queries: readonly string[]): string[] {
  const distinct = new Set(queries.map((q) => q.trim()).filter((q) => q !== ''))
  return [...distinct].slice(0, MAX_RETRIEVAL_QUERIES)
}

type PreviousMetadata = {
  entryId?: string
  sceneEntities: string[]
  currentLocationId: string | null
  worldTime: number
}

type BuildArgs = {
  entryId: string
  block: ParsedStateBlock
  entities: readonly Entity[]
  previousMetadata: PreviousMetadata
  branchId: string
  // Caller-supplied, not hardcoded: the two producers are distinct agents whose deltas'
  // provenance must say so (docs/memory/piggyback.md).
  source: DeltaSource
}

type BuildResult = {
  metadata: Pick<
    EntryMetadata,
    'sceneEntities' | 'currentLocationId' | 'worldTime' | 'summary' | 'retrievalQueries'
  >
  actions: PipelineAction[]
  /** What validation did to the emitted values, for stateReport — so the reader renders
   *  the emitted-vs-applied divergence as fact instead of inferring a cause from it. */
  applied: { worldTimeDelta: number; currentLocationRejected: boolean }
}

export function buildPiggybackActions(args: BuildArgs): BuildResult {
  const { entryId, block, entities, previousMetadata, branchId, source } = args

  const sceneEntities = dedupeSceneEntities(block.sceneEntities ?? previousMetadata.sceneEntities)
  const rawDelta = block.worldTimeDelta ?? 0
  const appliedDelta = resolvePiggybackWorldTimeDelta(rawDelta, entryId, previousMetadata.worldTime)
  const worldTime = previousMetadata.worldTime + appliedDelta

  const actions: PipelineAction[] = []
  const byId = new Map(entities.map((e) => [e.id, e]))

  // The block is model output, so the id here is whatever it answered with — the
  // prompt asking for a location does not constrain it. Unchecked, a character
  // or item id lands in metadata.currentLocationId, gets written as
  // state.current_location_id on every in-scene character, and seats that row as
  // the location if buildStructuralFloor finds it active. Inheriting the
  // previous location is the safe fallback: it is the value the turn would have
  // carried had the model said nothing. `entities` must therefore be the whole
  // branch — openStory hydrates entitiesStore unwindowed, unlike entriesStore —
  // or a legitimate id the prompt just offered would be refused here.
  const named = block.currentLocation
  const namedIsLocation = named !== undefined && byId.get(named)?.kind === 'location'
  const currentLocationRejected = named !== undefined && !namedIsLocation
  if (currentLocationRejected) {
    logger.warn('classifier.current_location_rejected', {
      entryId,
      currentLocation: named,
      kind: byId.get(named)?.kind ?? null,
    })
  }
  const currentLocationId = namedIsLocation ? named : previousMetadata.currentLocationId

  const metadata: BuildResult['metadata'] = { sceneEntities, currentLocationId, worldTime }
  if (block.summary !== undefined) metadata.summary = block.summary
  const retrievalQueries = normalizeRetrievalQueries(block.retrievalQueries ?? [])
  if (retrievalQueries.length > 0) metadata.retrievalQueries = retrievalQueries
  // visual/inventory/stackables only exist on CharacterState (entity-state-schema.ts) —
  // an id that resolves but belongs to a location/item/faction would otherwise get
  // those fields merged onto its state unvalidated (state-patch-actions.ts never
  // parses the merged result against the target's own kind-specific schema).
  const isCharacter = (id: string): boolean => byId.get(id)?.kind === 'character'

  actions.push(...scenePromotionActions({ branchId, source, entities, sceneEntities }))

  // Computed bookkeeping. Shared with the scene editor, which passes a distinct
  // `before` — here this entry's scene IS the previous entry's until the block
  // changes it, so the two-way fold falls out of the three-way shape.
  actions.push(
    ...sceneTrackingActions({
      branchId,
      source,
      entities,
      previous: { ...previousMetadata, entryId: previousMetadata.entryId ?? entryId },
      before: {
        sceneEntities: previousMetadata.sceneEntities,
        currentLocationId: previousMetadata.currentLocationId,
      },
      after: { sceneEntities, currentLocationId },
    }),
  )

  // Visual changes
  for (const note of block.visualChanges ?? []) {
    if (isCharacter(note.id)) {
      actions.push({
        kind: 'updateEntityVisualState',
        source,
        payload: {
          branchId,
          id: note.id,
          visual: { [note.type]: note.text } as Partial<CharacterState['visual']>,
        },
      })
    }
  }

  // Item transfers
  const inventoryPatches = new Map<string, { equipped_items?: string[]; inventory?: string[] }>()
  const currentInventory = (id: string): { equipped_items: string[]; inventory: string[] } => {
    const state = byId.get(id)?.state as CharacterState | undefined
    const pending = inventoryPatches.get(id)
    return {
      equipped_items: pending?.equipped_items ?? state?.equipped_items ?? [],
      inventory: pending?.inventory ?? state?.inventory ?? [],
    }
  }

  const release = (holderId: string, itemId: string) => {
    const cur = currentInventory(holderId)
    inventoryPatches.set(holderId, {
      equipped_items: cur.equipped_items.filter((i) => i !== itemId),
      inventory: cur.inventory.filter((i) => i !== itemId),
    })
  }
  const holds = (holderId: string, itemId: string): boolean => {
    if (!isCharacter(holderId)) return false
    const cur = currentInventory(holderId)
    return cur.equipped_items.includes(itemId) || cur.inventory.includes(itemId)
  }
  const pickedUp = new Set<string>()
  for (const item of block.transfers?.items ?? []) {
    if (item.from !== undefined && isCharacter(item.from)) release(item.from, item.id)
    if (item.to !== undefined && isCharacter(item.to)) {
      // data-model.md → ItemState: an item has one position, so taking it moves it from
      // wherever else it sits, whatever `from` named.
      for (const holder of entities)
        if (holder.id !== item.to && holds(holder.id, item.id)) release(holder.id, item.id)
      const cur = currentInventory(item.to)
      const other = item.slot === 'equipped_items' ? 'inventory' : 'equipped_items'
      inventoryPatches.set(item.to, {
        [other]: cur[other].filter((i) => i !== item.id),
        [item.slot]: [...cur[item.slot].filter((i) => i !== item.id), item.id],
      } as { equipped_items: string[]; inventory: string[] })
      pickedUp.add(item.id)
    }
  }
  for (const [id, patch] of inventoryPatches) {
    if (isCharacter(id)) {
      actions.push({
        kind: 'updateEntityInventory',
        source,
        payload: { branchId, id, ...patch },
      })
    }
  }
  for (const id of pickedUp) {
    const item = byId.get(id)
    if (item?.kind === 'item' && (item.state as ItemState).at_location_id != null)
      actions.push({
        kind: 'updateItemPosition',
        source,
        payload: { branchId, id, atLocationId: null },
      })
  }

  // Stackable transfers
  const stackablePatches = new Map<string, Record<string, number>>()
  const currentStackables = (id: string): Record<string, number> => {
    const patched = stackablePatches.get(id)
    if (patched) return { ...patched }
    // A row written before keys were normalized can hold "Gold" beside "gold"; fold
    // them here so the first transfer to touch the holder heals it.
    const state = byId.get(id)?.state as CharacterState | undefined
    const folded: Record<string, number> = {}
    for (const [raw, count] of Object.entries(state?.stackables ?? {})) {
      const key = normalizeTerm(raw)
      if (key !== '' && count > 0) folded[key] = (folded[key] ?? 0) + count
    }
    return folded
  }

  for (const transfer of block.transfers?.stackables ?? []) {
    if (transfer.from !== undefined && isCharacter(transfer.from)) {
      const cur = currentStackables(transfer.from)
      const next = { ...cur }
      const remaining = Math.max(0, (cur[transfer.key] ?? 0) - transfer.amount)
      if (remaining === 0) delete next[transfer.key]
      else next[transfer.key] = remaining
      stackablePatches.set(transfer.from, next)
    }
    if (transfer.to !== undefined && isCharacter(transfer.to)) {
      const cur = currentStackables(transfer.to)
      stackablePatches.set(transfer.to, {
        ...cur,
        [transfer.key]: (cur[transfer.key] ?? 0) + transfer.amount,
      })
    }
  }
  for (const [id, stackables] of stackablePatches) {
    if (isCharacter(id)) {
      actions.push({
        kind: 'updateEntityStackables',
        source,
        payload: { branchId, id, stackables },
      })
    }
  }

  return { metadata, actions, applied: { worldTimeDelta: appliedDelta, currentLocationRejected } }
}
