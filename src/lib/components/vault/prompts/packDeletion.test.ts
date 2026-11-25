import { describe, it, expect } from 'vitest'
import { packDeletionDescription } from './packDeletion'

describe('packDeletionDescription', () => {
  it('says what is lost when no story uses the pack', () => {
    expect(packDeletionDescription([])).toBe('Its prompts and custom variables will be deleted.')
  })

  it('names a single story', () => {
    expect(packDeletionDescription(['Noir'])).toBe(
      '“Noir” uses this pack. Remove it before deleting the pack.',
    )
  })

  it('names up to three stories', () => {
    expect(packDeletionDescription(['A', 'B', 'C'])).toBe(
      '“A”, “B” and “C” use this pack. Remove them before deleting the pack.',
    )
  })

  it('counts the stories past the third', () => {
    expect(packDeletionDescription(['A', 'B', 'C', 'D'])).toBe(
      '“A”, “B”, “C” and 1 more story use this pack. Remove them before deleting the pack.',
    )
    expect(packDeletionDescription(['A', 'B', 'C', 'D', 'E'])).toBe(
      '“A”, “B”, “C” and 2 more stories use this pack. Remove them before deleting the pack.',
    )
  })
})
