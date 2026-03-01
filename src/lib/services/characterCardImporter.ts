/**
 * Character Card Importer Service
 *
 * Imports SillyTavern character cards (V1/V2 JSON format) into Aventura's wizard.
 * Supports both JSON files and PNG files with embedded character data.
 */

import type { StoryMode, VisualDescriptors } from '$lib/types'
import type { Genre } from '$lib/services/ai/wizard/ScenarioService'
import { createLogger } from './ai/core/config'
import type { GeneratedCharacter } from './ai/sdk'
import { CharacterCardImportService } from './ai/import/CharacterCardImportService'

const log = createLogger('CharacterCardImporter')
// ===== PNG Metadata Extraction =====

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isPngFile(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
  if (bytes.length < 8) return false

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

export function extractCharacterCardFromPng(data: ArrayBuffer | Uint8Array): string | null {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data

  if (!isPngFile(bytes)) {
    log('Not a valid PNG file')
    return null
  }

  let offset = 8

  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) break
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    offset += 4

    if (offset + 4 > bytes.length) break
    const type = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    )
    offset += 4

    if (type === 'tEXt') {
      if (offset + length > bytes.length) break
      const chunkData = bytes.slice(offset, offset + length)

      let nullIndex = -1
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i
          break
        }
      }

      if (nullIndex > 0) {
        const keyword = new TextDecoder('latin1').decode(chunkData.slice(0, nullIndex))

        if (keyword.toLowerCase() === 'chara') {
          const textData = chunkData.slice(nullIndex + 1)
          const base64String = new TextDecoder('latin1').decode(textData)

          try {
            const binaryString = atob(base64String)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            const jsonString = new TextDecoder('utf-8').decode(bytes)
            log('Found character data in PNG tEXt chunk')
            return jsonString
          } catch (e) {
            log('Failed to decode base64 character data:', e)
            return null
          }
        }
      }
    }

    offset += length + 4

    if (type === 'IEND') break
  }

  log('No character data found in PNG')
  return null
}

export async function readCharacterCardFile(file: File): Promise<string> {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.png')) {
    log('Reading PNG file:', file.name)
    const arrayBuffer = await file.arrayBuffer()
    const jsonString = extractCharacterCardFromPng(arrayBuffer)

    if (!jsonString) {
      throw new Error(
        'No character data found in PNG file. The image may not be a valid SillyTavern character card.',
      )
    }

    return jsonString
  }

  log('Reading JSON file:', file.name)
  return await file.text()
}

// ===== SillyTavern Card Types =====

export interface SillyTavernCardV1 {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
}

export interface SillyTavernCardV2 {
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

export interface ParsedCard {
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

export interface CardImportResult {
  success: boolean
  settingSeed: string
  npcs: GeneratedCharacter[]
  primaryCharacterName: string
  storyTitle: string
  firstMessage: string
  alternateGreetings: string[]
  errors: string[]
}

// ===== Card Parsing =====

function isV2OrV3Card(data: unknown): data is SillyTavernCardV2 {
  if (typeof data !== 'object' || data === null) return false
  if (!('spec' in data) || !('data' in data)) return false
  const spec = (data as SillyTavernCardV2).spec
  return spec === 'chara_card_v2' || spec === 'chara_card_v3'
}

function isV1Card(data: unknown): data is SillyTavernCardV1 {
  return (
    typeof data === 'object' &&
    data !== null &&
    'name' in data &&
    'description' in data &&
    !('spec' in data)
  )
}

export function parseCharacterCard(jsonString: string): ParsedCard | null {
  try {
    const data = JSON.parse(jsonString)

    if (isV2OrV3Card(data)) {
      const version = data.spec === 'chara_card_v3' ? 'v3' : 'v2'
      log(`Detected ${version.toUpperCase()} card format`)
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

// ===== Macro Replacement =====

export function normalizeUserMacro(text: string): string {
  if (!text) return ''
  return text.replace(/\{\{user\}\}/gi, '{{user}}')
}

// ===== LLM Conversion =====

/**
 * Convert a parsed character card into a scenario setting using LLM.
 */
export async function convertCardToScenario(
  jsonString: string,
  mode: StoryMode,
  genre: Genre,
): Promise<CardImportResult> {
  const service = new CharacterCardImportService()
  return service.convertCardToScenario(jsonString, mode, genre)
}

export interface SanitizedCharacter {
  name: string
  description: string
  traits: string[]
  visualDescriptors: VisualDescriptors
}

/**
 * Sanitize a character card using LLM to extract clean character data.
 */
export async function sanitizeCharacterCard(
  jsonString: string,
): Promise<SanitizedCharacter | null> {
  const service = new CharacterCardImportService()
  return service.sanitizeCharacterCard(jsonString)
}
