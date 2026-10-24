import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { CharacterState, Entity, ItemState } from '@/lib/db'
import type { Logger } from '@/lib/diagnostics'

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

type ItemMoves = { actions: PipelineAction[]; drops: ReportedDrop[]; itemsLanded: number }

/** In the block's order: taken then put down lies at the scene; put down then taken is held. */
export function itemMoveActions(args: ItemMoveArgs): ItemMoves {
  const { transfers, entities, byId, nearScene, currentLocationId } = args
  const { branchId, entryId, source, log } = args
  const isCharacter = (id: string): boolean => byId.get(id)?.kind === 'character'
  const characterOf = (id: string | undefined): string | undefined =>
    id !== undefined && isCharacter(id) ? id : undefined

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
  // Where each item the block moves ends up; a write goes out only where that differs from its row.
  const positions = new Map<string, string | null>()
  const storedPosition = (itemId: string): string | null =>
    (byId.get(itemId)?.state as ItemState | null | undefined)?.at_location_id ?? null
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

  // Whether the move changed who holds the item or where it lies.
  const take = (item: ItemTransfer): boolean => {
    const before = whereIs(item.id)
    const giver = characterOf(item.from)
    const taker = characterOf(item.to)
    if (giver !== undefined) release(giver, item.id)
    if (taker !== undefined) {
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
  // piggyback.md → Trailing block format: a drop lands where the scene is; elsewhere stays prose.
  const putDown = (drop: ItemDrop) => {
    if (byId.get(drop.id)?.kind !== 'item') return
    const holders = entities.filter((holder) => holds(holder.id, drop.id)).map((h) => h.id)
    if (holders.length > 0 && !holders.some((id) => nearScene.has(id))) {
      log.warn('classifier.drop_dropped', {
        entryId,
        source,
        itemId: drop.id,
        reason: 'off_scene',
        holderIds: holders,
      })
      return
    }
    const lyingAt = positionOf(drop.id)
    if (holders.length === 0 && lyingAt !== null && lyingAt !== currentLocationId) {
      log.warn('classifier.drop_dropped', {
        entryId,
        source,
        itemId: drop.id,
        reason: 'elsewhere',
        atLocationId: lyingAt,
      })
      return
    }
    for (const holderId of holders) release(holderId, drop.id)
    if (currentLocationId === null)
      log.warn('classifier.drop_unplaced', { entryId, source, itemId: drop.id })
    else if (holders.length === 0 && lyingAt === currentLocationId)
      log.debug('classifier.drop_unchanged', {
        entryId,
        source,
        itemId: drop.id,
        atLocationId: lyingAt,
      })
    positions.set(drop.id, currentLocationId)
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
    if (isCharacter(id)) {
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
  return { actions, drops, itemsLanded }
}
