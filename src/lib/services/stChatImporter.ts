/**
 * SillyTavern Chat Importer
 *
 * Parses a SillyTavern .jsonl chat file and converts it to Aventuras story entries.
 *
 * JSONL format:
 * - Line [0]: Chat metadata / system prompt — always skipped
 * - Subsequent lines: Message objects with `is_user`, `is_system`, and `mes` fields
 *
 * Mapping rules:
 * - is_system: true  → skipped
 * - is_user: true    → 'user_action'
 * - is_user: false   → 'narration'
 */

import type { StoryEntry } from '$lib/types'

export interface STChatMessage {
  type: StoryEntry['type']
  content: string
}

export interface STChatParseResult {
  success: true
  messages: STChatMessage[]
  characterName: string
  userName: string
  createDate: string
  totalSkipped: number
}

export interface STChatParseError {
  success: false
  error: string
}

export type STChatParseOutcome = STChatParseResult | STChatParseError

/**
 * Parse the text content of a SillyTavern .jsonl file.
 */
export function parseSTChat(content: string): STChatParseOutcome {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    return { success: false, error: 'File is empty.' }
  }

  // Parse first line for metadata
  let characterName = 'Imported Chat'
  let userName = 'User'
  let createDate = new Date().toISOString()

  try {
    const meta = JSON.parse(lines[0])
    if (typeof meta.character_name === 'string' && meta.character_name) {
      characterName = meta.character_name
    }
    if (typeof meta.user_name === 'string' && meta.user_name) {
      userName = meta.user_name
    }
    if (typeof meta.create_date === 'string' && meta.create_date) {
      createDate = meta.create_date
    }
  } catch {
    // First line is not valid JSON — not a standard ST export.
    // Metadata defaults are kept; the loop below still starts at i=1,
    // so line 0 is skipped (acceptable: line 0 is always the header in ST exports).
  }

  const messages: STChatMessage[] = []
  let totalSkipped = 0

  // Skip line [0] (always the metadata / system prompt header)
  for (let i = 1; i < lines.length; i++) {
    let obj: Record<string, unknown>

    try {
      obj = JSON.parse(lines[i])
    } catch {
      totalSkipped++
      continue
    }

    // Skip system messages
    if (obj.is_system === true) {
      totalSkipped++
      continue
    }

    const msgContent = typeof obj.mes === 'string' ? obj.mes.trim() : ''
    if (!msgContent) {
      totalSkipped++
      continue
    }

    const type: StoryEntry['type'] = obj.is_user === true ? 'user_action' : 'narration'
    messages.push({ type, content: msgContent })
  }

  if (messages.length === 0) {
    return { success: false, error: 'No importable messages found in this file.' }
  }

  return {
    success: true,
    messages,
    characterName,
    userName,
    createDate,
    totalSkipped,
  }
}
