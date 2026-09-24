import type {
  Entry,
  EntryType,
  VaultCharacter,
  VaultLorebook,
  VaultLorebookEntry,
  VaultScenario,
} from '$lib/types'
import { normalizeTime } from '$lib/services/storyTime'
import type {
  ExchangeCharacter,
  ExchangeDocument,
  ExchangeEntity,
  ExchangeLorebook,
  ExchangeLorebookEntry,
  ExchangePayloads,
  ExchangeScenario,
} from './types'
import { EXCHANGE_FORMAT, EXCHANGE_FORMAT_VERSION } from './types'

/**
 * Metadata keys that travel. Everything else on a record's metadata is identity, provenance,
 * derived, or a database-local reference, and is regenerated or dropped on import.
 */
export const PORTABLE_METADATA: Record<ExchangeEntity, readonly string[]> = {
  character: ['cardVersion'],
  lorebook: [],
  scenario: ['cardVersion'],
}

export function portableMetadata(
  entity: ExchangeEntity,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!metadata) return out
  for (const key of PORTABLE_METADATA[entity]) {
    if (metadata[key] !== undefined) out[key] = metadata[key]
  }
  return out
}

export function wrapExchange<E extends ExchangeEntity>(
  entity: E,
  data: ExchangePayloads[E],
): ExchangeDocument<E> {
  return {
    format: EXCHANGE_FORMAT,
    formatVersion: EXCHANGE_FORMAT_VERSION,
    entity,
    exportedAt: Date.now(),
    data,
  }
}

export function serializeExchange(document: ExchangeDocument): string {
  return JSON.stringify(document, null, 2)
}

// ===== Character =====

export function characterToExchange(character: VaultCharacter): ExchangeCharacter {
  return {
    name: character.name,
    description: character.description,
    traits: [...character.traits],
    visualDescriptors: { ...character.visualDescriptors },
    portrait: character.portrait,
    tags: [...character.tags],
    favorite: character.favorite,
    metadata: portableMetadata('character', character.metadata),
  }
}

export function exchangeToCharacter(
  data: ExchangeCharacter,
  local: { id: string; originalFilename: string },
): VaultCharacter {
  const now = Date.now()
  return {
    id: local.id,
    name: data.name,
    description: data.description,
    traits: data.traits,
    visualDescriptors: data.visualDescriptors,
    portrait: data.portrait,
    tags: data.tags,
    favorite: data.favorite,
    source: 'import',
    originalStoryId: null,
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...portableMetadata('character', data.metadata),
      originalFilename: local.originalFilename,
    },
  }
}

// ===== Scenario =====

export function scenarioToExchange(scenario: VaultScenario): ExchangeScenario {
  return {
    name: scenario.name,
    description: scenario.description,
    settingSeed: scenario.settingSeed,
    npcs: scenario.npcs.map((npc) => ({ ...npc, traits: [...npc.traits] })),
    primaryCharacterName: scenario.primaryCharacterName,
    firstMessage: scenario.firstMessage,
    alternateGreetings: [...scenario.alternateGreetings],
    startingTime: scenario.startingTime ? { ...scenario.startingTime } : null,
    tags: [...scenario.tags],
    favorite: scenario.favorite,
    metadata: portableMetadata('scenario', scenario.metadata),
  }
}

export function exchangeToScenario(
  data: ExchangeScenario,
  local: { id: string; originalFilename: string },
): VaultScenario {
  const now = Date.now()
  return {
    id: local.id,
    name: data.name,
    description: data.description,
    settingSeed: data.settingSeed,
    npcs: data.npcs,
    primaryCharacterName: data.primaryCharacterName,
    firstMessage: data.firstMessage,
    alternateGreetings: data.alternateGreetings,
    startingTime: data.startingTime ? normalizeTime(data.startingTime) : null,
    tags: data.tags,
    favorite: data.favorite,
    source: 'import',
    originalFilename: local.originalFilename,
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...portableMetadata('scenario', data.metadata),
      hasFirstMessage: !!data.firstMessage,
      alternateGreetingsCount: data.alternateGreetings.length,
      npcCount: data.npcs.length,
    },
  }
}

// ===== Lorebook =====

export function vaultLorebookToExchange(lorebook: VaultLorebook): ExchangeLorebook {
  return {
    name: lorebook.name,
    description: lorebook.description,
    tags: [...lorebook.tags],
    favorite: lorebook.favorite,
    metadata: portableMetadata('lorebook', lorebook.metadata),
    entries: lorebook.entries.map((e) => ({
      name: e.name,
      type: e.type,
      description: e.description,
      keywords: [...e.keywords],
      aliases: [...e.aliases],
      injectionMode: e.injectionMode,
      priority: e.priority,
    })),
  }
}

export function storyEntriesToExchange(
  entries: Entry[],
  lorebook: { name: string; description?: string | null },
): ExchangeLorebook {
  return {
    name: lorebook.name,
    description: lorebook.description ?? null,
    tags: [],
    favorite: false,
    metadata: {},
    entries: entries.map((e) => ({
      name: e.name,
      type: e.type,
      description: e.description,
      keywords: [...e.injection.keywords],
      aliases: [...e.aliases],
      injectionMode: e.injection.mode,
      priority: e.injection.priority,
      hiddenInfo: e.hiddenInfo,
      loreManagementBlacklisted: e.loreManagementBlacklisted,
    })),
  }
}

export function hasStorySideFields(entries: ExchangeLorebookEntry[]): boolean {
  return entries.some((e) => !!e.hiddenInfo?.trim() || e.loreManagementBlacklisted === true)
}

export function entryBreakdown(entries: { type: EntryType }[]): Record<EntryType, number> {
  const breakdown: Record<EntryType, number> = {
    character: 0,
    location: 0,
    item: 0,
    faction: 0,
    concept: 0,
    event: 0,
  }
  for (const entry of entries) breakdown[entry.type]++
  return breakdown
}

/** The vault keeps the story-agnostic shape: story-side entry fields are dropped here. */
export function exchangeToVaultLorebook(
  data: ExchangeLorebook,
  local: { id: string; originalFilename: string },
): VaultLorebook {
  const now = Date.now()
  const entries: VaultLorebookEntry[] = data.entries.map((e) => ({
    name: e.name,
    type: e.type,
    description: e.description,
    keywords: e.keywords,
    aliases: e.aliases,
    injectionMode: e.injectionMode,
    priority: e.priority,
  }))
  return {
    id: local.id,
    name: data.name,
    description: data.description,
    entries,
    tags: data.tags,
    favorite: data.favorite,
    source: 'import',
    originalFilename: local.originalFilename,
    originalStoryId: null,
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...portableMetadata('lorebook', data.metadata),
      format: 'aventura',
      totalEntries: entries.length,
      entryBreakdown: entryBreakdown(entries),
    },
  }
}
