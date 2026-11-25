import { describe, it, expect } from 'vitest'
import * as z from 'zod'
import { parseModelList } from './parseModelList'

const entry = z.object({ id: z.string() })

describe('parseModelList', () => {
  it('reads a bare list or one under data, skipping entries that do not match', () => {
    expect(parseModelList([{ id: 'a' }, { nope: 1 }], entry, 'X')).toEqual([{ id: 'a' }])
    expect(parseModelList({ data: [{ id: 'b' }] }, entry, 'X')).toEqual([{ id: 'b' }])
  })

  it('returns an empty list for a reply that really is empty', () => {
    expect(parseModelList([], entry, 'X /models')).toEqual([])
    expect(parseModelList({ data: [] }, entry, 'X /models')).toEqual([])
  })

  it('names the endpoint when the reply is no list', () => {
    expect(() => parseModelList('<html></html>', entry, 'X /models')).toThrow(
      'X /models did not return a list',
    )
    expect(() => parseModelList({ error: 'nope' }, entry, 'X /models')).toThrow(
      'did not return a list',
    )
  })

  it('rejects entries that are all unreadable, rather than reading an empty catalogue', () => {
    expect(() => parseModelList([{ nope: 1 }, 'x'], entry, 'X /models')).toThrow(
      'X /models returned no readable entries',
    )
  })
})
