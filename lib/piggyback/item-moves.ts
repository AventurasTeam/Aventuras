import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'
import { sameList, stateAs } from '@/lib/world'

import type { ItemDrop, ItemTransfer, ParsedTransfers, ReportedDrop } from './types'

type Move = { seq: number; item: ItemTransfer } | { seq: number; drop: ItemDrop }

type ItemMoveArgs = {
  transfers: ParsedTransfers | undefined
  /** The branch's rows, the turn's creates among them. */
  entities: readonly Entity[]
  byId: ReadonlyMap<string, Entity>
  /** Who can still put an item down: this turn's scene and the one before. */
  nearScene: ReadonlySet<string>
  currentLocationId: string | null
  branchId: string
  entryId: string
  source: DeltaSource
  log: Logger
}

type ItemMoves = {
  actions: PipelineAction[]
  drops: ReportedDrop[]
  itemsLanded: number
  /** Drops that moved their item: one already lying where the scene is changes nothing. */
  dropsLanded: number
  /** The character a stackable's party stands for once the moves landed: itself, or whoever holds
   *  the item it names; anything else reads as omitted. */
  holderOf: (id: string | undefined) => string | undefined
}

/** In the block's order: taken then put down lies at the scene; put down then taken is held. */
export function itemMoveActions(args: ItemMoveArgs): ItemMoves {
  const { transfers, entities, byId, nearScene, currentLocationId } = args
  const { branchId, entryId, source, log } = args
  const isCharacter = (id: string): boolean => byId.get(id)?.kind === 'character'

  const inventoryPatches = new Map<string, { equipped_items?: string[]; inventory?: string[] }>()
  const storedInventory = (id: string): { equipped_items: string[]; inventory: string[] } => {
    const state = stateAs(byId.get(id), 'character')
    return { equipped_items: state.equipped_items ?? [], inventory: state.inventory ?? [] }
  }
  const currentInventory = (id: string): { equipped_items: string[]; inventory: string[] } => {
    const stored = storedInventory(id)
    const pending = inventoryPatches.get(id)
    return {
      equipped_items: pending?.equipped_items ?? stored.equipped_items,
      inventory: pending?.inventory ?? stored.inventory,
    }
  }

  const holds = (holderId: string, itemId: string): boolean => {
    if (!isCharacter(holderId)) return false
    const cur = currentInventory(holderId)
    return cur.equipped_items.includes(itemId) || cur.inventory.includes(itemId)
  }
  const release = (holderId: string, itemId: string) => {
    if (!holds(holderId, itemId)) return
    const cur = currentInventory(holderId)
    inventoryPatches.set(holderId, {
      equipped_items: cur.equipped_items.filter((i) => i !== itemId),
      inventory: cur.inventory.filter((i) => i !== itemId),
    })
  }
  // Where each item the block moves ends up; a write goes out only where that differs from its row.
  const positions = new Map<string, string | null>()
  const storedPosition = (itemId: string): string | null =>
    stateAs(byId.get(itemId), 'item').at_location_id ?? null
  const positionOf = (itemId: string): string | null =>
    positions.has(itemId) ? (positions.get(itemId) ?? null) : storedPosition(itemId)

  // Who holds the item in which slot, and where it lies: all a move can change.
  const whereIs = (itemId: string): string =>
    JSON.stringify([
      positionOf(itemId),
      entities.flatMap((holder) => {
        if (!isCharacter(holder.id)) return []
        const cur = currentInventory(holder.id)
        return (['equipped_items', 'inventory'] as const)
          .filter((slot) => cur[slot].includes(itemId))
          .map((slot) => `${holder.id}:${slot}`)
      }),
    ])

  // piggyback.md → A bad ref in the two writers: until containers exist only a character holds
  // anything, so another holder reads by what it names. An item stands for whoever holds it, or
  // for the place it lies at; the scene's place is `here`, any other `elsewhere`.
  type Party = { holder: string } | 'here' | 'elsewhere' | 'none'
  const standsFor = (id: string, kind: Entity['kind']): Party => {
    if (kind === 'location') return id === currentLocationId ? 'here' : 'elsewhere'
    if (kind !== 'item') return 'none'
    const holder = entities.find((h) => holds(h.id, id))
    if (holder !== undefined) return { holder: holder.id }
    const at = positionOf(id)
    return at === null ? 'none' : at === currentLocationId ? 'here' : 'elsewhere'
  }
  const partyOf = (id: string | undefined): Party => {
    const row = id === undefined ? undefined : byId.get(id)
    if (id === undefined || row === undefined) return 'none'
    if (row.kind === 'character') return { holder: id }
    const party = standsFor(id, row.kind)
    // A correction, not a model error: no alert, no dropped ref (entry-card.md → State problems).
    log.debug('classifier.holder_read', {
      entryId,
      source,
      holderId: id,
      kind: row.kind,
      ...(typeof party === 'object'
        ? { readAs: 'character', characterId: party.holder }
        : { readAs: party === 'none' ? 'omitted' : party }),
    })
    return party
  }

  // Whether the move changed who holds the item or where it lies.
  const take = (item: ItemTransfer): boolean => {
    const before = whereIs(item.id)
    const to = partyOf(item.to)
    // Into the scene's place, or a container lying there, is a put-down; anywhere else stays
    // prose, as a drop's does, and leaves the item where it was.
    if (to === 'here') return putDownHere(item.id) && whereIs(item.id) !== before
    if (to === 'elsewhere') return false
    const from = partyOf(item.from)
    if (typeof from === 'object') release(from.holder, item.id)
    if (typeof to === 'object') {
      const taker = to.holder
      // data-model.md → ItemState: an item has one position, so taking it moves it from
      // wherever else it sits, whatever `from` named.
      for (const holder of entities)
        if (holder.id !== taker && holds(holder.id, item.id)) release(holder.id, item.id)
      const cur = currentInventory(taker)
      const other = item.slot === 'equipped_items' ? 'inventory' : 'equipped_items'
      inventoryPatches.set(taker, {
        [other]: cur[other].filter((i) => i !== item.id),
        [item.slot]: [...cur[item.slot].filter((i) => i !== item.id), item.id],
      } as { equipped_items: string[]; inventory: string[] })
      positions.set(item.id, null)
    }
    return whereIs(item.id) !== before
  }

  const drops: ReportedDrop[] = []
  let dropsLanded = 0
  // piggyback.md → Trailing block format: a drop lands where the scene is; elsewhere stays prose.
  // False when it can't: held by no one near the scene, or lying elsewhere.
  function putDownHere(itemId: string): boolean {
    if (byId.get(itemId)?.kind !== 'item') return false
    const holders = entities.filter((holder) => holds(holder.id, itemId)).map((h) => h.id)
    if (holders.length > 0 && !holders.some((id) => nearScene.has(id))) {
      log.warn('classifier.drop_dropped', {
        entryId,
        source,
        itemId,
        reason: 'off_scene',
        holderIds: holders,
      })
      return false
    }
    const lyingAt = positionOf(itemId)
    if (holders.length === 0 && lyingAt !== null && lyingAt !== currentLocationId) {
      log.warn('classifier.drop_dropped', {
        entryId,
        source,
        itemId,
        reason: 'elsewhere',
        atLocationId: lyingAt,
      })
      return false
    }
    for (const holderId of holders) release(holderId, itemId)
    if (currentLocationId === null)
      log.warn('classifier.drop_unplaced', { entryId, source, itemId })
    else if (holders.length === 0 && lyingAt === currentLocationId)
      log.debug('classifier.drop_unchanged', { entryId, source, itemId, atLocationId: lyingAt })
    positions.set(itemId, currentLocationId)
    return true
  }
  const putDown = (drop: ItemDrop) => {
    const before = whereIs(drop.id)
    if (!putDownHere(drop.id)) return
    if (whereIs(drop.id) !== before) dropsLanded += 1
    drops.push({
      id: drop.id,
      ...(drop.from !== undefined ? { from: drop.from } : {}),
      at: currentLocationId,
    })
  }

  // `seq` is unchecked producer output; the sort is stable, so a repeated seq keeps list order,
  // item moves before drops, as keptItemHandles reads a tie.
  const moves: Move[] = [
    ...(transfers?.items ?? []).map((item) => ({ seq: item.seq, item })),
    ...(transfers?.drops ?? []).map((drop) => ({ seq: drop.seq, drop })),
  ].sort((a, b) => a.seq - b.seq)
  let itemsLanded = 0
  for (const move of moves) {
    if (!('item' in move)) putDown(move.drop)
    else if (take(move.item)) itemsLanded += 1
  }

  const actions: PipelineAction[] = []
  for (const [id, patch] of inventoryPatches) {
    const stored = storedInventory(id)
    const unchanged =
      sameList(patch.equipped_items ?? stored.equipped_items, stored.equipped_items) &&
      sameList(patch.inventory ?? stored.inventory, stored.inventory)
    if (isCharacter(id) && !unchanged) {
      actions.push({
        kind: 'updateEntityInventory',
        source,
        payload: { branchId, id, ...patch },
      })
    }
  }
  for (const [id, atLocationId] of positions) {
    if (byId.get(id)?.kind === 'item' && storedPosition(id) !== atLocationId)
      actions.push({
        kind: 'updateItemPosition',
        source,
        payload: { branchId, id, atLocationId },
      })
  }
  const holderOf = (id: string | undefined): string | undefined => {
    const party = partyOf(id)
    return typeof party === 'object' ? party.holder : undefined
  }
  return { actions, drops, itemsLanded, dropsLanded, holderOf }
}
