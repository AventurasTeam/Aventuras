import { describe, it, expect } from 'vitest'
import { parseSTChat } from './stChatImporter'

describe('stChatImporter', () => {
  it('returns error if file content is empty', () => {
    const res = parseSTChat('')
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error).toBe('File is empty.')
    }
  })

  it('parses valid ST jsonl chat file', () => {
    const jsonl = [
      JSON.stringify({ user_name: 'Hero', character_name: 'Aria' }),
      JSON.stringify({ is_user: true, mes: 'Hello Aria!' }),
      JSON.stringify({ is_user: false, mes: 'Greetings traveler.' }),
      JSON.stringify({ is_system: true, mes: 'System notice' }),
    ].join('\n')

    const res = parseSTChat(jsonl)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.userName).toBe('Hero')
      expect(res.characterName).toBe('Aria')
      expect(res.messages).toHaveLength(2)
      expect(res.messages[0]).toEqual({ type: 'user_action', content: 'Hello Aria!' })
      expect(res.messages[1]).toEqual({ type: 'narration', content: 'Greetings traveler.' })
      expect(res.totalSkipped).toBe(1)
    }
  })

  it('handles empty messages by skipping them', () => {
    const jsonl = [
      JSON.stringify({ user_name: 'Hero', character_name: 'Aria' }),
      JSON.stringify({ is_user: true, mes: '   ' }),
    ].join('\n')

    const res = parseSTChat(jsonl)
    expect(res.success).toBe(false)
    if (!res.success) {
      expect(res.error).toContain('No importable messages found')
    }
  })
})
