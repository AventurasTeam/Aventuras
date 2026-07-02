import { describe, expect, it } from 'vitest'

import { generateId } from './generate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateId', () => {
  it('prefixes a v4 uuid', () => {
    const id = generateId('run')
    expect(id.startsWith('run_')).toBe(true)
    expect(UUID.test(id.slice('run_'.length))).toBe(true)
  })

  it('is collision-resistant across many calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateId('act')))
    expect(set.size).toBe(1000)
  })
})
