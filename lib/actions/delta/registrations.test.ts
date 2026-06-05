import { describe, expect, it } from 'vitest'

import { resolveByActionKind, resolveByTable } from './registry'

describe('registerAllDomains', () => {
  it('registers story_entries handlers + descriptor', () => {
    expect(resolveByActionKind('createStoryEntry')).toBeDefined()
    expect(resolveByActionKind('updateStoryEntryMetadata')).toBeDefined()
    expect(resolveByTable('story_entries')?.table).toBe('story_entries')
  })
})
