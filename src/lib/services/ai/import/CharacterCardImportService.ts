/**
 * CharacterCardImportService
 *
 * Wraps the LLM calls in characterCardImporter.ts using the standard
 * serviceId + dynamic getter pattern, consistent with all other AI services.
 */

import type { StoryMode } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import type { Genre } from '$lib/services/ai/wizard/ScenarioService'
import { ContextBuilder } from '$lib/services/context'
import { cardImportResultSchema, vaultCharacterImportSchema } from '../sdk/schemas/cardimport'
import { createLogger } from '../core/config'
import type { GeneratedCharacter } from '../sdk'
import {
  parseCharacterCard,
  normalizeUserMacro,
  type CardImportResult,
  type SanitizedCharacter,
  type ParsedCard,
} from '$lib/services/characterCardImporter'
import type { VisualDescriptors } from '$lib/types'

const log = createLogger('CharacterCardImportService')

function buildCardContext(card: ParsedCard): string {
  const sections: string[] = []

  if (card.scenario.trim()) {
    sections.push(`<scenario>\n${normalizeUserMacro(card.scenario)}\n</scenario>`)
  }
  if (card.description.trim()) {
    sections.push(
      `<character_description>\n${normalizeUserMacro(card.description)}\n</character_description>`,
    )
  }
  if (card.personality.trim()) {
    sections.push(`<personality>\n${normalizeUserMacro(card.personality)}\n</personality>`)
  }
  if (card.exampleMessages.trim()) {
    sections.push(
      `<example_messages>\n${normalizeUserMacro(card.exampleMessages)}\n</example_messages>`,
    )
  }

  return sections.join('\n\n')
}

export class CharacterCardImportService extends BaseAIService {
  constructor(serviceId: string = 'characterCardImport') {
    super(serviceId)
  }

  /**
   * Convert a parsed character card into a scenario setting using LLM.
   */
  async convertCardToScenario(
    jsonString: string,
    mode: StoryMode,
    genre: Genre,
  ): Promise<CardImportResult> {
    const card = parseCharacterCard(jsonString)
    if (!card) {
      return {
        success: false,
        settingSeed: '',
        npcs: [],
        primaryCharacterName: '',
        storyTitle: '',
        firstMessage: '',
        alternateGreetings: [],
        errors: [
          'Failed to parse character card. Please ensure the file is a valid SillyTavern character card JSON.',
        ],
      }
    }

    log('Parsed card:', { name: card.name, version: card.version })

    const cardTitle = card.name
    const preprocessedFirstMessage = normalizeUserMacro(card.firstMessage)
    const preprocessedAlternateGreetings = card.alternateGreetings.map((g) => normalizeUserMacro(g))
    const cardContent = buildCardContext(card)

    const ctx = new ContextBuilder()
    ctx.add({
      mode,
      pov: 'second',
      tense: 'present',
      protagonistName: '',
      genre,
      title: cardTitle,
      cardContent,
    })
    const { system, user: prompt } = await ctx.render('character-card-import')

    const result = await this.generate(
      cardImportResultSchema,
      system,
      prompt,
      'character-card-import',
    )

    const npcs: GeneratedCharacter[] = result.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      description: npc.description,
      relationship: npc.relationship,
      traits: npc.personality
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }))

    log('Card import successful', {
      primaryCharacter: result.primaryCharacterName,
      npcCount: npcs.length,
    })

    return {
      success: true,
      settingSeed: result.settingSeed,
      npcs,
      primaryCharacterName: result.primaryCharacterName,
      storyTitle: result.primaryCharacterName || cardTitle,
      firstMessage: preprocessedFirstMessage,
      alternateGreetings: preprocessedAlternateGreetings,
      errors: [],
    }
  }

  /**
   * Sanitize a character card using LLM to extract clean character data.
   */
  async sanitizeCharacterCard(jsonString: string): Promise<SanitizedCharacter | null> {
    const card = parseCharacterCard(jsonString)
    if (!card) {
      log('Failed to parse card for sanitization')
      return null
    }

    const cardContent = buildCardContext(card)

    const ctx = new ContextBuilder()
    ctx.add({
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: '',
      cardContent,
    })
    const { system, user: prompt } = await ctx.render('vault-character-import')

    const result = await this.generate(
      vaultCharacterImportSchema,
      system,
      prompt,
      'vault-character-import',
    )

    log('Character sanitization successful', { name: result.name })

    const visualDescriptors: VisualDescriptors = result.visualDescriptors

    return {
      name: result.name,
      description: result.description,
      traits: result.traits,
      visualDescriptors,
    }
  }
}
