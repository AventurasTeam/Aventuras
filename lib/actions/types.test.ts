import { describe, expect, it } from 'vitest'

import { isUserOriginatedSource, type DeltaSource } from './types'

describe('isUserOriginatedSource', () => {
  it('classifies user_edit as user-originated', () => {
    expect(isUserOriginatedSource('user_edit')).toBe(true)
  })

  it('classifies every pipeline source as not user-originated', () => {
    const pipelineSources: DeltaSource[] = [
      'ai_classifier',
      'piggyback_tagged_block',
      'per_turn_classifier',
      'periodic_classifier',
      'lore_agent',
      'chapter_close',
    ]
    for (const source of pipelineSources) expect(isUserOriginatedSource(source)).toBe(false)
  })
})
