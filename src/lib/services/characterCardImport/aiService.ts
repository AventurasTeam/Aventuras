import { createLogger } from '$lib/log'
import { BaseAIService } from '$lib/services/ai/BaseAIService'
import type { GeneratedCharacter } from '$lib/services/ai/sdk'
import type { Genre } from '$lib/services/ai/wizard'
import { ContextBuilder } from '$lib/services/context'
import { cardImportResultSchema, vaultCharacterImportSchema } from './schemas'
import type { CardImportResult, ParsedCard, SanitizedCharacter } from './types'
import { parseJson } from './parseJson'

const log = createLogger('characterCardImport:aiService')

function normalizeUserMacro(text: string): string {
  if (!text) return ''
  return text.replace(/\{\{user}}/gi, '{{user}}')
}

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

class AIService extends BaseAIService {
  constructor(serviceId: string = 'characterCardImport') {
    super(serviceId)
  }

  async convertCardToScenario(parsedCard: ParsedCard, genre: Genre): Promise<CardImportResult> {
    const cardTitle = parsedCard.name
    const cardContent = buildCardContext(parsedCard)

    const ctx = new ContextBuilder()
    ctx.add({ title: cardTitle, genre, cardContent })
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
      firstMessage: normalizeUserMacro(parsedCard.firstMessage),
      alternateGreetings: parsedCard.alternateGreetings.map((g) => normalizeUserMacro(g)),
      errors: [],
    }
  }

  async sanitizeCharacterCard(parsedCard: ParsedCard): Promise<SanitizedCharacter> {
    const cardContent = buildCardContext(parsedCard)

    const ctx = new ContextBuilder()
    ctx.add({ cardContent })
    const { system, user: prompt } = await ctx.render('vault-character-import')

    const result = await this.generate(
      vaultCharacterImportSchema,
      system,
      prompt,
      'vault-character-import',
    )

    log('Character sanitization successful', { name: result.name })

    return {
      name: result.name,
      description: result.description,
      traits: result.traits,
      visualDescriptors: result.visualDescriptors,
    }
  }
}

const aiService = new AIService()

/**
 * Convert a parsed character card into a clean character card using LLM.
 */
export async function clean(
  jsonString: string,
  genre: Genre = 'fantasy',
): Promise<CardImportResult> {
  const card = parseJson(jsonString)
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

  return await aiService.convertCardToScenario(card, genre)
}

/**
 * Sanitize a character card using LLM to extract clean character data.
 */
export async function sanitize(jsonString: string): Promise<SanitizedCharacter | null> {
  const card = parseJson(jsonString)
  if (!card) {
    log('Failed to parse card for sanitization')
    return null
  }

  return await aiService.sanitizeCharacterCard(card)
}
