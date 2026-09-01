import { describe, it, expect } from 'vitest'
import { describeTemplate } from './templateGroups'

describe('describeTemplate', () => {
  it('names a system template and its group', () => {
    expect(describeTemplate('adventure')).toEqual({
      name: 'Adventure Mode',
      group: 'Story Generation',
      isUserHalf: false,
    })
  })

  it('resolves a user half to its prompt and marks it', () => {
    const described = describeTemplate('adventure-user')

    expect(described).not.toBeNull()
    expect(described!.name).toBe('Adventure Mode')
    expect(described!.group).toBe('Story Generation')
    expect(described!.isUserHalf).toBe(true)
  })

  it('returns null for an id the app no longer ships', () => {
    expect(describeTemplate('retired-prompt')).toBeNull()
    expect(describeTemplate('retired-prompt-user')).toBeNull()
  })
})
