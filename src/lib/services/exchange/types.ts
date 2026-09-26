import type { EntryInjectionMode, EntryType, TimeTracker, VisualDescriptors } from '$lib/types'

export const EXCHANGE_FORMAT = 'aventuras-exchange'
export const EXCHANGE_FORMAT_VERSION = '1.0.0'

export type ExchangeEntity = 'character' | 'lorebook' | 'scenario'

export interface ExchangeCharacter {
  name: string
  description: string | null
  traits: string[]
  visualDescriptors: VisualDescriptors
  portrait: string | null
  tags: string[]
  favorite: boolean
  metadata: Record<string, unknown>
}

export interface ExchangeLorebookEntry {
  name: string
  type: EntryType
  description: string
  keywords: string[]
  aliases: string[]
  injectionMode: EntryInjectionMode
  priority: number
  /** Story-side: kept on a story import, dropped by the vault. */
  hiddenInfo?: string | null
  /** Story-side: kept on a story import, dropped by the vault. */
  loreManagementBlacklisted?: boolean
}

export interface ExchangeLorebook {
  name: string
  description: string | null
  tags: string[]
  favorite: boolean
  metadata: Record<string, unknown>
  entries: ExchangeLorebookEntry[]
}

export interface ExchangeScenarioNpc {
  name: string
  role: string
  description: string
  relationship: string
  traits: string[]
}

export interface ExchangeScenario {
  name: string
  description: string | null
  settingSeed: string
  npcs: ExchangeScenarioNpc[]
  primaryCharacterName: string
  firstMessage: string | null
  alternateGreetings: string[]
  startingTime: TimeTracker | null
  tags: string[]
  favorite: boolean
  metadata: Record<string, unknown>
}

export interface ExchangePayloads {
  character: ExchangeCharacter
  lorebook: ExchangeLorebook
  scenario: ExchangeScenario
}

export interface ExchangeDocument<E extends ExchangeEntity = ExchangeEntity> {
  format: typeof EXCHANGE_FORMAT
  formatVersion: string
  entity: E
  exportedAt: number
  data: ExchangePayloads[E]
}

export type ExchangeParseResult<E extends ExchangeEntity> =
  | { kind: 'exchange'; document: ExchangeDocument<E>; warnings: string[] }
  | { kind: 'invalid'; error: string }
  | { kind: 'external' }
