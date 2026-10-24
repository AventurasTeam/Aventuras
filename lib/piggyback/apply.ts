import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { CharacterState, Entity, EntryMetadata } from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
import { foldStackables } from '@/lib/keyword-terms'

import { boundStateText } from './bound-text'
import { itemMoveActions } from './item-moves'
import { dedupeSceneEntities, scenePromotionActions, sceneTrackingActions } from './scene-tracking'
import { MAX_RETRIEVAL_QUERIES, type PlannedTurn, type ReportedDrop } from './types'
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
  /** Its created rows count as stored: a new place can be the scene's location, and a new item
   *  can change hands. */
  turn: PlannedTurn
  entities: readonly Entity[]
  /** The rows the prompt showed with their state (generation-context.ts): a condition names one. */
  stateShownIds: ReadonlySet<string>
  previousMetadata: PreviousMetadata
  branchId: string
  // Caller-supplied, not hardcoded: the two producers are distinct agents whose deltas'
  // provenance must say so (docs/memory/piggyback.md).
  source: DeltaSource
  /** The phase's logger, so a warning carries the run's actionId. */
  log: Logger
}

/** What validation did to the emitted values, for stateReport — so the reader renders the
 *  emitted-vs-applied divergence as fact instead of inferring a cause from it. */
export type PiggybackApplied = {
  worldTimeDelta: number
  currentLocationRejected: boolean
  /** The drops applied, in the block's order, each where it landed: null with no scene place. */
  drops: ReportedDrop[]
  /** Positions in `block.conditions` refused, not ids: an id can repeat in one block. */
  conditionsRejected: number[]
  // How many of each wrote anything: one naming no character as its target or a party writes none.
  visualChangesLanded: number
  itemsLanded: number
  stackablesLanded: number
}

type BuildResult = {
  metadata: Pick<
    EntryMetadata,
    'sceneEntities' | 'currentLocationId' | 'worldTime' | 'summary' | 'retrievalQueries'
  >
  actions: PipelineAction[]
  applied: PiggybackApplied
}

export function buildPiggybackActions(args: BuildArgs): BuildResult {
  const { entryId, previousMetadata, branchId, source, log, stateShownIds } = args
  const { block, createdRows, reusedIds } = args.turn
  const entities = [...args.entities, ...createdRows]

  const sceneEntities = dedupeSceneEntities(block.sceneEntities ?? previousMetadata.sceneEntities)
  const rawDelta = block.worldTimeDelta ?? 0
  const appliedDelta = resolvePiggybackWorldTimeDelta(
    rawDelta,
    entryId,
    previousMetadata.worldTime,
    log,
  )
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
    log.warn('classifier.current_location_rejected', {
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
  const characterOf = (id: string | undefined): string | undefined =>
    id !== undefined && isCharacter(id) ? id : undefined

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
  let visualChangesLanded = 0
  for (const note of block.visualChanges ?? []) {
    if (isCharacter(note.id)) {
      visualChangesLanded += 1
      const { text, cut } = boundStateText(note.text)
      // The writer is asked for about 60 words; a cut says it overran the 500-character bound.
      if (cut)
        log.warn('classifier.visual_truncated', {
          entryId,
          source,
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

  // data-model.md → Authorship contract (seen before written): only shown places and items.
  const conditionsRejected: number[] = []
  for (const [position, change] of (block.conditions ?? []).entries()) {
    const condition = change.text.trim()
    if (condition === '') {
      conditionsRejected.push(position)
      continue
    }
    const row = byId.get(change.id)
    const shown = stateShownIds.has(change.id)
    if (!shown || (row?.kind !== 'location' && row?.kind !== 'item')) {
      log.warn('classifier.condition_unseen', {
        entryId,
        source,
        entityId: change.id,
        kind: row?.kind ?? null,
        shown,
      })
      conditionsRejected.push(position)
      continue
    }
    const { text, cut } = boundStateText(condition)
    if (cut)
      log.warn('classifier.condition_truncated', {
        entryId,
        source,
        entityId: change.id,
        length: condition.length,
        keptLength: text.length,
      })
    actions.push({
      kind: 'updateEntityCondition',
      source,
      payload: { branchId, id: change.id, condition: text },
    })
  }

  const {
    actions: moveActions,
    drops,
    itemsLanded,
  } = itemMoveActions({
    transfers: block.transfers,
    entities,
    byId,
    // Someone who left this turn can still have put it down before going.
    nearScene: new Set([...sceneEntities, ...previousMetadata.sceneEntities]),
    currentLocationId,
    branchId,
    entryId,
    source,
    log,
  })
  actions.push(...moveActions)

  // Stackable transfers. Maps, not records: a key is model output, and "constructor" or
  // "__proto__" on a plain object reads or writes the prototype instead of a count.
  const stackablePatches = new Map<string, Map<string, number>>()
  const currentStackables = (id: string): Map<string, number> => {
    const patched = stackablePatches.get(id)
    if (patched) return new Map(patched)
    // The patch carries the folded keys, so the first transfer to touch a holder heals its row.
    const state = byId.get(id)?.state as CharacterState | undefined
    return foldStackables(state?.stackables)
  }

  let stackablesLanded = 0
  for (const transfer of block.transfers?.stackables ?? []) {
    const payer = characterOf(transfer.from)
    const payee = characterOf(transfer.to)
    if (payer !== undefined || payee !== undefined) stackablesLanded += 1
    if (payer !== undefined) {
      const next = currentStackables(payer)
      const balance = next.get(transfer.key) ?? 0
      // data-model.md → Stackable items: the payer clamps at zero while the payee still gains
      // the full amount, so the prose stays true for whoever received it.
      if (balance < transfer.amount)
        log.warn('classifier.stackable_shortfall', {
          entryId,
          source,
          entityId: payer,
          key: transfer.key,
          amount: transfer.amount,
          balance,
        })
      const remaining = Math.max(0, balance - transfer.amount)
      if (remaining === 0) next.delete(transfer.key)
      else next.set(transfer.key, remaining)
      stackablePatches.set(payer, next)
    }
    if (payee !== undefined) {
      const next = currentStackables(payee)
      next.set(transfer.key, (next.get(transfer.key) ?? 0) + transfer.amount)
      stackablePatches.set(payee, next)
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

  return {
    metadata,
    actions,
    applied: {
      worldTimeDelta: appliedDelta,
      currentLocationRejected,
      drops,
      conditionsRejected,
      visualChangesLanded,
      itemsLanded,
      stackablesLanded,
    },
  }
}
