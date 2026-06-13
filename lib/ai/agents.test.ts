import { describe, expect, it } from 'vitest'

import { AGENT_IDS } from './agents'

describe('AGENT_IDS', () => {
  it('is the six v1 agents, narrative excluded', () => {
    expect([...AGENT_IDS]).toEqual([
      'classifier',
      'translation',
      'suggestion',
      'lore-mgmt',
      'retrieval',
      'wizard-assist',
    ])
  })
})
