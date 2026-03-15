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
