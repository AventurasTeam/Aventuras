import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { CharacterState, Entity } from '@/lib/db'

import type { ParsedStateBlock } from './types'
import { resolvePiggybackWorldTimeDelta } from './world-time'

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
  // Which caller produced this block — piggyback's own direct tagged-block
  // emission ('piggyback_tagged_block') or the synchronous per-turn fallback
  // ('per_turn_classifier'). Not hardcoded here: the two paths are distinct
  // agents and their deltas' provenance must say so (docs/memory/piggyback.md).
  source: DeltaSource
}

type BuildResult = {
  metadata: {
    sceneEntities: string[]
    currentLocationId: string | null
    worldTime: number
    summary?: string
  }
  actions: PipelineAction[]
}

export function buildPiggybackActions(args: BuildArgs): BuildResult {
  const { entryId, block, entities, previousMetadata, branchId, source } = args

  const sceneEntities = block.sceneEntities ?? previousMetadata.sceneEntities
  const currentLocationId = block.currentLocation ?? previousMetadata.currentLocationId
  const rawDelta = block.worldTimeDelta ?? 0
  const worldTime = previousMetadata.worldTime + resolvePiggybackWorldTimeDelta(rawDelta, entryId)

  const metadata: BuildResult['metadata'] = { sceneEntities, currentLocationId, worldTime }
  if (block.summary !== undefined) metadata.summary = block.summary

  const actions: PipelineAction[] = []
  const byId = new Map(entities.map((e) => [e.id, e]))
  // visual/inventory/stackables only exist on CharacterState (entity-state-schema.ts) —
  // an id that resolves but belongs to a location/item/faction would otherwise get
  // those fields merged onto its state unvalidated (state-patch-actions.ts never
  // parses the merged result against the target's own kind-specific schema).
  const isCharacter = (id: string): boolean => byId.get(id)?.kind === 'character'

  // Auto-promote staged entities named in sceneEntities
  for (const id of sceneEntities) {
    const entity = byId.get(id)
    if (entity?.status === 'staged') {
      actions.push({
        kind: 'promoteStagedEntity',
        source,
        payload: { branchId, id },
      })
    }
  }

  // Computed bookkeeping
  const wasInScene = new Set(previousMetadata.sceneEntities)
  const nowInScene = new Set(sceneEntities)
  for (const character of entities.filter((e) => e.kind === 'character')) {
    if (nowInScene.has(character.id) && currentLocationId !== null) {
      actions.push({
        kind: 'updateEntityLocationTracking',
        source,
        payload: { branchId, id: character.id, currentLocationId },
      })
    } else if (wasInScene.has(character.id) && !nowInScene.has(character.id)) {
      // Only emit lastSeenAt when we actually know where the character was;
      // a null locationId would produce a silently rejected delta (piggyback creates no rows).
      if (previousMetadata.currentLocationId !== null) {
        actions.push({
          kind: 'updateEntityLocationTracking',
          source,
          payload: {
            branchId,
            id: character.id,
            lastSeenAt: {
              entryId: previousMetadata.entryId ?? entryId,
              locationId: previousMetadata.currentLocationId,
              worldTime: previousMetadata.worldTime,
            },
          },
        })
      }
    }
  }

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

  for (const item of block.transfers?.items ?? []) {
    if (item.from !== undefined && isCharacter(item.from)) {
      const cur = currentInventory(item.from)
      inventoryPatches.set(item.from, {
        equipped_items: cur.equipped_items.filter((i) => i !== item.id),
        inventory: cur.inventory.filter((i) => i !== item.id),
      })
    }
    if (item.to !== undefined && isCharacter(item.to)) {
      const cur = currentInventory(item.to)
      inventoryPatches.set(item.to, {
        ...cur,
        [item.slot]: [...cur[item.slot].filter((i) => i !== item.id), item.id],
      })
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

  // Stackable transfers
  const stackablePatches = new Map<string, Record<string, number>>()
  const currentStackables = (id: string): Record<string, number> => {
    const state = byId.get(id)?.state as CharacterState | undefined
    return { ...(state?.stackables ?? {}), ...(stackablePatches.get(id) ?? {}) }
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

  return { metadata, actions }
}
