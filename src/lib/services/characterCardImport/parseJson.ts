import { createLogger } from '$lib/log'
import type { ParsedCard } from './types'
import { isV1Card, isV2OrV3Card } from './sillyTavernCards'

const log = createLogger('characterCardImport')

export function parseJson(jsonString: string): ParsedCard | null {
  try {
    const data = JSON.parse(jsonString)

    if (isV2OrV3Card(data)) {
      const version = data.spec === 'chara_card_v3' ? 'v3' : 'v2'
      log(`Detected ${version} card format`)
      return {
        name: data.data.name || data.name || 'Unknown Character',
        description: data.data.description || data.description || '',
        personality: data.data.personality || data.personality || '',
        scenario: data.data.scenario || data.scenario || '',
        firstMessage: data.data.first_mes || data.first_mes || '',
        alternateGreetings: data.data.alternate_greetings || [],
        exampleMessages: data.data.mes_example || data.mes_example || '',
        creator_notes: data.data.creator_notes || data.creator_notes,
        tags: data.data.tags || data.tags,
        version,
        characterBook: data.data.character_book || undefined,
      }
    }

    if (isV1Card(data)) {
      log('Detected V1 card format')
      return {
        name: data.name || 'Unknown Character',
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        firstMessage: data.first_mes || '',
        alternateGreetings: [],
        exampleMessages: data.mes_example || '',
        version: 'v1',
      }
    }

    log('Unknown card format')
    return null
  } catch (error) {
    log('Failed to parse card JSON:', error)
    return null
  }
}
