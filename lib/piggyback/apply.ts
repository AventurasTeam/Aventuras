import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { CharacterState, Entity, EntryMetadata, ItemState } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { foldStackables } from '@/lib/keyword-terms'

import { dedupeSceneEntities, scenePromotionActions, sceneTrackingActions } from './scene-tracking'
import { MAX_RETRIEVAL_QUERIES, VISUAL_TEXT_MAX, type PlannedTurn } from './types'
import { resolvePiggybackWorldTimeDelta } from './world-time'

// Two producers write this field; only the tagged-block parser filters itself (trims,
// dedupes, caps) — the classifier fallback only counts, so blanks/dupes reach here raw.
// Dedupe before the cap so a repeat doesn't spend a slot a distinct ask needed (retrieval.md → Q4).
function normalizeRetrievalQueries(queries: readonly string[]): string[] {
  const distinct = new Set(queries.map((q) => q.trim()).filter((q) => q !== ''))
  return [...distinct].slice(0, MAX_RETRIEVAL_QUERIES)
}

// Both producers arrive here uncapped. An over-long note fails the whole-state re-validation of
// every later updateEntity carrying `state`, a delete's ref clear among them. piggyback.md →
// Trailing block format: cut back to the last sentence or clause boundary inside the bound, else
// the last whitespace, else mid-word. By UTF-16 unit (Zod's `.length`), never mid-surrogate.
function truncateVisualText(text: string): string {
  if (text.length <= VISUAL_TEXT_MAX) return text
  const head = text.slice(0, VISUAL_TEXT_MAX)
  const clause = Math.max(head.lastIndexOf('.'), head.lastIndexOf(';'), head.lastIndexOf(','))
  // A period ends a sentence and stays; a dangling comma or semicolon goes.
  const atClause = clause < 0 ? '' : head.slice(0, head[clause] === '.' ? clause + 1 : clause)
  if (atClause.trim() !== '') return atClause.trimEnd()
  const space = head.search(/\s\S*$/)
  const atSpace = space < 0 ? '' : head.slice(0, space).trimEnd()
  if (atSpace !== '') return atSpace
  const lastUnit = head.charCodeAt(head.length - 1)
  return lastUnit >= 0xd800 && lastUnit <= 0xdbff ? head.slice(0, -1) : head
}

type PreviousMetadata = {
  entryId?: string
  sceneEntities: string[]
  currentLocationId: string | null
  worldTime: number
}

type BuildArgs = {
  entryId: string
  /** Its created rows count as stored: a new place can be the scene's location, and a new item
   *  can change hands. */
  turn: PlannedTurn
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
  const { entryId, previousMetadata, branchId, source } = args
  const { block, createdRows, reusedIds } = args.turn
  const entities = [...args.entities, ...createdRows]

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
  // A retired place can't be entered (data-model.md → LocationState shape), and a place pinned
  // `always` can still put one in the prompt with its id.
  const named = block.currentLocation
  const namedRow = named === undefined ? undefined : byId.get(named)
  const namedIsLocation =
    named !== undefined && namedRow?.kind === 'location' && namedRow.status !== 'retired'
  const currentLocationRejected = named !== undefined && !namedIsLocation
  if (currentLocationRejected) {
    logger.warn('classifier.current_location_rejected', {
      entryId,
      currentLocation: named,
      kind: namedRow?.kind ?? null,
      status: namedRow?.status ?? null,
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

  actions.push(
    ...scenePromotionActions({
      branchId,
      source,
      entities,
      sceneEntities,
      // Naming a staged place introduces it; an inherited location names nothing.
      alsoIds: [...(namedIsLocation ? [named] : []), ...reusedIds],
    }),
  )

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
      const text = truncateVisualText(note.text)
      // The writer is asked for about 60 words; a cut says it wrote far past that.
      if (text !== note.text)
        logger.warn('classifier.visual_truncated', {
          entityId: note.id,
          type: note.type,
          length: note.text.length,
          keptLength: text.length,
        })
      actions.push({
        kind: 'updateEntityVisualState',
        source,
        payload: {
          branchId,
          id: note.id,
          visual: { [note.type]: text } as Partial<CharacterState['visual']>,
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

  // Stackable transfers. Maps, not records: a key is model output, and "constructor" or
  // "__proto__" on a plain object reads or writes the prototype instead of a count.
  const stackablePatches = new Map<string, Map<string, number>>()
  const currentStackables = (id: string): Map<string, number> => {
    const patched = stackablePatches.get(id)
    if (patched) return new Map(patched)
    // Folded as the prompt's view folds them, so the first transfer to touch a holder whose row
    // holds "Gold" beside "gold" heals it, and debits the balance the writer was shown.
    const state = byId.get(id)?.state as CharacterState | undefined
    return foldStackables(state?.stackables)
  }

  for (const transfer of block.transfers?.stackables ?? []) {
    if (transfer.from !== undefined && isCharacter(transfer.from)) {
      const next = currentStackables(transfer.from)
      const balance = next.get(transfer.key) ?? 0
      // data-model.md → Stackable items: the payer clamps at zero while the payee still gains
      // the full amount, so the prose stays true for whoever received it.
      if (balance < transfer.amount)
        logger.warn('classifier.stackable_shortfall', {
          entityId: transfer.from,
          key: transfer.key,
          amount: transfer.amount,
          balance,
        })
      const remaining = Math.max(0, balance - transfer.amount)
      if (remaining === 0) next.delete(transfer.key)
      else next.set(transfer.key, remaining)
      stackablePatches.set(transfer.from, next)
    }
    if (transfer.to !== undefined && isCharacter(transfer.to)) {
      const next = currentStackables(transfer.to)
      next.set(transfer.key, (next.get(transfer.key) ?? 0) + transfer.amount)
      stackablePatches.set(transfer.to, next)
    }
  }
  for (const [id, stackables] of stackablePatches) {
    if (isCharacter(id)) {
      actions.push({
        kind: 'updateEntityStackables',
        source,
        payload: { branchId, id, stackables: Object.fromEntries(stackables) },
      })
    }
  }

  return { metadata, actions, applied: { worldTimeDelta: appliedDelta, currentLocationRejected } }
}
