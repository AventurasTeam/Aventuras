import type { VisualDescriptors } from '$lib/types'
import type { GeneratedCharacter } from '$lib/services/ai/sdk'

export type SanitizedCharacter = {
  name: string
  description: string
  traits: string[]
  visualDescriptors: VisualDescriptors
}

export type ParsedCard = {
  name: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  alternateGreetings: string[]
  exampleMessages: string
  creator_notes?: string
  tags?: string[]
  version: 'v1' | 'v2' | 'v3'
  characterBook?: unknown // Raw SillyTavern character_book data
}

export type CardImportResult = {
  success: boolean
  settingSeed: string
  npcs: GeneratedCharacter[]
  primaryCharacterName: string
  storyTitle: string
  firstMessage: string
  alternateGreetings: string[]
  errors: string[]
}

export type SillyTavernCardV1 = {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
}

export type SillyTavernCardV2 = {
  spec: 'chara_card_v2' | 'chara_card_v3'
  spec_version: string
  data: SillyTavernCardV1 & {
    creator_notes?: string
    system_prompt?: string
    post_history_instructions?: string
    alternate_greetings?: string[]
    character_book?: unknown
    tags?: string[]
    creator?: string
    character_version?: string
    extensions?: Record<string, unknown>
  }
  name?: string
  description?: string
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  creator_notes?: string
  tags?: string[]
}
