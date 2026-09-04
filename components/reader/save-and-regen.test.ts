import { describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { resolveSaveAndRegenTurn } from './save-and-regen'

function entry(id: string, kind: StoryEntry['kind']): StoryEntry {
  return { id, branchId: 'b1', kind, content: 'x', position: 0 } as StoryEntry
}

describe('resolveSaveAndRegenTurn', () => {
  it('pairs the tail reply with the user action that produced it', () => {
    const rows = [entry('e1', 'opening'), entry('e2', 'user_action'), entry('e3', 'ai_reply')]
    expect(resolveSaveAndRegenTurn(rows, 'e3')).toEqual({ originId: 'e2', replyId: 'e3' })
  })

  it('offers nothing for an earlier turn whose reply is not the tail', () => {
    const rows = [
      entry('e1', 'user_action'),
      entry('e2', 'ai_reply'),
      entry('e3', 'user_action'),
      entry('e4', 'ai_reply'),
    ]
    expect(resolveSaveAndRegenTurn(rows, 'e4')?.originId).toBe('e3')
  })

  it('offers nothing when the tail is a standing user action with no reply', () => {
    const rows = [entry('e1', 'ai_reply'), entry('e2', 'user_action')]
    expect(resolveSaveAndRegenTurn(rows, 'e2')).toBeNull()
  })

  it('offers nothing when a system entry holds the tail over a standing action', () => {
    const rows = [entry('e1', 'ai_reply'), entry('e2', 'user_action'), entry('e3', 'system')]
    expect(resolveSaveAndRegenTurn(rows, 'e3')).toBeNull()
  })

  it('offers nothing when the tail reply follows the opening rather than an action', () => {
    const rows = [entry('e1', 'opening'), entry('e2', 'ai_reply')]
    expect(resolveSaveAndRegenTurn(rows, 'e2')).toBeNull()
  })

  it('offers nothing when the origin sits above the loaded window', () => {
    const rows = [entry('e9', 'ai_reply')]
    expect(resolveSaveAndRegenTurn(rows, 'e9')).toBeNull()
  })

  it('offers nothing on an empty branch', () => {
    expect(resolveSaveAndRegenTurn([], null)).toBeNull()
  })

  it('offers nothing when the tail id is not in the loaded window', () => {
    const rows = [entry('e1', 'user_action'), entry('e2', 'ai_reply')]
    expect(resolveSaveAndRegenTurn(rows, 'e7')).toBeNull()
  })
})
