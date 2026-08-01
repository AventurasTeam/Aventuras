import { describe, it, expect } from 'vitest'
import type { StoryEntry } from '$lib/types'
import { findPrecedingUserAction } from './storyEntries'

function entry(id: string, type: StoryEntry['type'], position: number): StoryEntry {
  return {
    id,
    storyId: 's1',
    type,
    content: id,
    parentId: null,
    position,
    createdAt: position,
    metadata: null,
    branchId: null,
  }
}

describe('findPrecedingUserAction', () => {
  it('finds the action immediately above a narration', () => {
    const entries = [entry('a1', 'user_action', 0), entry('n1', 'narration', 1)]
    expect(findPrecedingUserAction(entries, 'n1')?.id).toBe('a1')
  })

  it('skips back over intervening non-action entries', () => {
    // A retry or a system note between the action and the narration must not hide it --
    // this is what the regenerate button uses to decide it has a prompt to re-answer.
    const entries = [
      entry('a1', 'user_action', 0),
      entry('sys', 'system', 1),
      entry('r1', 'retry', 2),
      entry('n1', 'narration', 3),
    ]
    expect(findPrecedingUserAction(entries, 'n1')?.id).toBe('a1')
  })

  it('returns the nearest action, not the first one', () => {
    const entries = [
      entry('a1', 'user_action', 0),
      entry('n1', 'narration', 1),
      entry('a2', 'user_action', 2),
      entry('n2', 'narration', 3),
    ]
    expect(findPrecedingUserAction(entries, 'n2')?.id).toBe('a2')
  })

  it('returns null when nothing precedes the entry', () => {
    const entries = [entry('n1', 'narration', 0), entry('a1', 'user_action', 1)]
    expect(findPrecedingUserAction(entries, 'n1')).toBeNull()
  })

  it('returns null when only non-action entries precede', () => {
    const entries = [entry('sys', 'system', 0), entry('n1', 'narration', 1)]
    expect(findPrecedingUserAction(entries, 'n1')).toBeNull()
  })

  it('returns null for an id that is not in the list', () => {
    expect(findPrecedingUserAction([entry('a1', 'user_action', 0)], 'missing')).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(findPrecedingUserAction([], 'anything')).toBeNull()
  })

  it('searches by array order, not by the position field', () => {
    // Callers pass `story.entries`, which is the ordered list; position is metadata and
    // is not consulted. Documented so a caller that hands over an unsorted list knows
    // what it will get.
    const entries = [entry('a1', 'user_action', 99), entry('n1', 'narration', 0)]
    expect(findPrecedingUserAction(entries, 'n1')?.id).toBe('a1')
  })
})
