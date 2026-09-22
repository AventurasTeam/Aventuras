import { describe, it, expect } from 'vitest'
import { QUICK_START_SEEDS } from './templates'
import { formatStoryTime, parseStoryTime } from './storyTime'

describe('QUICK_START_SEEDS', () => {
  it('gives every seed a starting time that reads as a story time', () => {
    for (const seed of QUICK_START_SEEDS) {
      const start = seed.initialState.startingTime
      expect(start, seed.id).toBeDefined()
      expect(parseStoryTime(formatStoryTime(start!)), seed.id).toEqual(start)
    }
  })
})
