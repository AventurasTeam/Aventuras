import type {
  PendingEntryAction,
  PendingEntryStatus,
  VaultPendingChange,
} from '#lib/services/ai/sdk/schemas/vault.ts'
import type { VaultCharacter, VaultLorebook, VaultScenario } from '#lib/types/index.ts'
import {
  characterToRecord,
  composePendingOnto,
  computeDelta,
  entityUpdates,
  scenarioToRecord,
  withEntryUpdate,
} from '#lib/utils/vaultMerge.ts'

type LorebookUpdate = Extract<VaultPendingChange, { entityType: 'lorebook'; action: 'update' }>
type EntryChange = Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>
type EntryUpdate = Extract<EntryChange, { action: 'update' }>

export interface EffectiveVault {
  characters: VaultCharacter[]
  scenarios: VaultScenario[]
  lorebooks: VaultLorebook[]
  /** Fields of the entity whose effective value differs from the saved one. */
  unsavedFields(entityType: 'character' | 'scenario' | 'lorebook', id: string): string[]
  /** What pending changes do to a lorebook's entries, keyed by their saved index. */
  entryStatus(lorebookId: string): PendingEntryStatus
}

/** `details` with the names of its unsaved fields attached, when there are any. */
export function withUnsaved<T extends object>(details: T, fields: string[]) {
  return fields.length > 0 ? { ...details, unsavedFields: fields } : details
}

/**
 * The vault as the editor panel shows it: saved state with pending proposals laid over it.
 * Entities nothing touches come back by reference.
 */
export function effectiveVault(
  raw: { characters: VaultCharacter[]; scenarios: VaultScenario[]; lorebooks: VaultLorebook[] },
  pending: VaultPendingChange[],
): EffectiveVault {
  const unsaved = new Map<string, string[]>()
  const live = pending.filter((c) => c.status === 'pending')

  function compose<T extends { id: string }>(
    entity: T,
    entityType: 'character' | 'scenario',
    toRecord: (e: T) => Record<string, unknown>,
  ): T {
    const intents = entityUpdates(live, entityType, entity.id)
    if (intents.length === 0) return entity

    const saved = toRecord(entity)
    const composed = composePendingOnto(saved, intents)
    const fields = Object.keys(computeDelta(composed, saved))
    if (fields.length === 0) return entity
    unsaved.set(`${entityType}:${entity.id}`, fields)
    return { ...entity, ...composed }
  }

  const lorebookUpdates = new Map<string, LorebookUpdate[]>()
  const entryChanges = new Map<string, EntryChange[]>()
  for (const c of live) {
    switch (c.entityType) {
      case 'character':
      case 'scenario':
        break
      case 'lorebook':
        if (c.action === 'update') {
          const group = lorebookUpdates.get(c.entityId) ?? []
          group.push(c)
          lorebookUpdates.set(c.entityId, group)
        }
        break
      case 'lorebook-entry':
        const group = entryChanges.get(c.lorebookId) ?? []
        group.push(c)
        entryChanges.set(c.lorebookId, group)
        break
      default:
        c satisfies never
    }
  }

  function composeLorebook(lorebook: VaultLorebook): VaultLorebook {
    const updates = lorebookUpdates.get(lorebook.id) ?? []
    const entryUpdates = (entryChanges.get(lorebook.id) ?? []).filter(
      (c): c is EntryUpdate => c.action === 'update',
    )
    if (updates.length === 0 && entryUpdates.length === 0) return lorebook

    const overlay: Record<string, unknown> = {}
    for (const u of updates) {
      for (const [k, v] of Object.entries(u.data)) {
        if (v !== undefined) overlay[k] = v
      }
    }
    let entries = lorebook.entries
    for (const c of entryUpdates) {
      if (c.entryIndex < 0 || c.entryIndex >= entries.length) continue
      entries = entries.with(c.entryIndex, withEntryUpdate(entries[c.entryIndex], c.data))
    }

    const fields = Object.keys(
      computeDelta(overlay, {
        name: lorebook.name,
        description: lorebook.description,
        tags: lorebook.tags,
      }),
    )
    if (fields.length > 0) unsaved.set(`lorebook:${lorebook.id}`, fields)
    return { ...lorebook, ...overlay, entries }
  }

  return {
    characters: raw.characters.map((c) => compose(c, 'character', characterToRecord)),
    scenarios: raw.scenarios.map((s) => compose(s, 'scenario', scenarioToRecord)),
    lorebooks: raw.lorebooks.map(composeLorebook),
    unsavedFields: (entityType, id) => unsaved.get(`${entityType}:${id}`) ?? [],
    entryStatus(lorebookId) {
      const byIndex = new Map<number, PendingEntryAction>()
      const creates: PendingEntryStatus['creates'] = []
      for (const c of entryChanges.get(lorebookId) ?? []) {
        switch (c.action) {
          case 'create':
            creates.push({ name: c.data.name, type: c.data.type })
            break
          case 'update':
            if (!byIndex.has(c.entryIndex)) byIndex.set(c.entryIndex, 'update')
            break
          case 'delete':
            byIndex.set(c.entryIndex, 'delete')
            break
          case 'merge':
            for (const index of c.entryIndices) byIndex.set(index, 'merge')
            break
          default:
            c satisfies never
        }
      }
      return { byIndex, creates }
    },
  }
}
