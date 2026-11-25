import { describe, it, expect } from 'vitest'
import { mergeArrayLists, composePendingOnto, mergeIntent, supersededBy } from './vaultMerge'
import type { VaultCharacterInput, VaultPendingChange } from '#lib/services/ai/sdk/schemas/vault.ts'
import type { VaultLorebookEntry } from '#lib/types/index.ts'

describe('mergeArrayLists', () => {
  it('appends genuinely new items', () => {
    expect(mergeArrayLists(['a', 'b'], ['a'], ['a'])).toEqual(['a', 'b'])
  })

  it('does not duplicate an appended item that is already present in baseArr', () => {
    // This is the scenario that produced doubling/tripling tags in the vault
    // assistant: two sibling pending changes both diff their own `data` against
    // the same stale `previous` (neither has been approved yet), so each one
    // independently looks like "add b" — but baseArr already has it from an
    // earlier sibling in the same composition pass.
    expect(mergeArrayLists(['a', 'b'], ['a'], ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('still removes an item that disappeared between previous and data', () => {
    expect(mergeArrayLists(['a'], ['a', 'b'], ['a', 'b'])).toEqual(['a'])
  })

  it('removes only one copy of a duplicated value (multiset semantics)', () => {
    expect(mergeArrayLists(['John'], ['John', 'John'], ['John', 'John'])).toEqual(['John'])
  })

  it('still applies a genuine positional replacement', () => {
    expect(mergeArrayLists(['a', 'z'], ['a', 'b'], ['a', 'b'])).toEqual(['a', 'z'])
  })

  it('preserves an intentional duplicate addition even if the value already exists in the base', () => {
    // `data` explicitly has two copies of 'x': one was already in previous/base,
    // the second is a genuine new addition, not an artifact of composing
    // sibling changes. The base-count subtraction must not eat this one.
    expect(mergeArrayLists(['x', 'x'], ['x'], ['x'])).toEqual(['x', 'x'])
  })
})

describe('composePendingOnto — duplicate tag regression', () => {
  it('does not duplicate tags across two sibling update_character-style pending changes', () => {
    // Both changes were computed by the tool against the same live (unapproved)
    // character, so both have the identical stale `previous: { tags: [] }`.
    const change1 = { data: { tags: ['protagonist', 'flirt'] }, previous: { tags: [] } }
    const change2 = { data: { tags: ['protagonist', 'flirt'] }, previous: { tags: [] } }

    const composed = composePendingOnto<{ tags: string[] }>({ tags: [] }, [change1, change2])

    expect(composed.tags).toEqual(['protagonist', 'flirt'])
  })

  it('composes three sibling changes that each add one distinct tag, with no duplicates', () => {
    const base = { tags: [] as string[] }
    const changes = [
      { data: { tags: ['a'] }, previous: { tags: [] } },
      { data: { tags: ['a', 'b'] }, previous: { tags: [] } },
      { data: { tags: ['a', 'b', 'c'] }, previous: { tags: [] } },
    ]

    expect(composePendingOnto(base, changes).tags).toEqual(['a', 'b', 'c'])
  })

  it('still composes genuinely different additions from independent siblings', () => {
    const base = { tags: ['existing'] }
    const changes = [
      { data: { tags: ['existing', 'x'] }, previous: { tags: ['existing'] } },
      { data: { tags: ['existing', 'y'] }, previous: { tags: ['existing'] } },
    ]

    expect(composePendingOnto(base, changes).tags).toEqual(['existing', 'x', 'y'])
  })
})

describe('mergeIntent', () => {
  it('returns an empty delta when nothing changed', () => {
    const data = { name: 'Alice', tags: ['a'] }
    expect(mergeIntent(data, data, data)).toEqual({})
  })

  it('only includes fields that actually changed', () => {
    const previous = { name: 'Alice', tags: ['a'] }
    const data = { name: 'Bob', tags: ['a'] }
    const live = { name: 'Alice', tags: ['a'] }
    expect(mergeIntent(data, previous, live)).toEqual({ name: 'Bob' })
  })
})

describe('supersededBy', () => {
  const record = { name: 'Ann', description: 'old', traits: ['a'], favorite: false }

  const characterUpdate = (
    id: string,
    data: Partial<VaultCharacterInput>,
    entityId = 'c1',
  ): VaultPendingChange =>
    ({
      id,
      toolCallId: id,
      entityType: 'character',
      action: 'update',
      entityId,
      data: { ...record, ...data },
      previous: record,
      status: 'pending',
    }) as VaultPendingChange

  const entryUpdate = (
    id: string,
    data: Partial<VaultLorebookEntry>,
    entryIndex = 0,
  ): VaultPendingChange =>
    ({
      id,
      toolCallId: id,
      entityType: 'lorebook-entry',
      action: 'update',
      lorebookId: 'lb',
      entryIndex,
      data,
      previous: { name: 'Gate', description: 'old', keywords: ['gate'] },
      status: 'pending',
    }) as VaultPendingChange

  it('resolves an earlier update whose only change is overridden', () => {
    const a = characterUpdate('a', { description: 'first' })
    const b = characterUpdate('b', { description: 'second' })
    expect(supersededBy(b, [a])).toEqual([{ change: a, narrowed: null }])
  })

  it('keeps the fields of an earlier update that the approval does not override', () => {
    const a = characterUpdate('a', { description: 'first', name: 'Anna' })
    const b = characterUpdate('b', { description: 'second' })
    const [{ narrowed }] = supersededBy(b, [a])
    expect(narrowed).toMatchObject({ data: { description: 'old', name: 'Anna' } })
  })

  it('leaves array fields independent', () => {
    const a = characterUpdate('a', { traits: ['a', 'x'] })
    const b = characterUpdate('b', { traits: ['a', 'y'] })
    expect(supersededBy(b, [a])).toEqual([])
  })

  it('ignores another entity', () => {
    const a = characterUpdate('a', { description: 'first' }, 'c2')
    const b = characterUpdate('b', { description: 'second' })
    expect(supersededBy(b, [a])).toEqual([])
  })

  it('drops overridden keys from an entry update and resolves it when none are left', () => {
    const a = entryUpdate('a', { description: 'first', keywords: ['gate', 'door'] })
    const b = entryUpdate('b', { description: 'second' })
    const [{ narrowed }] = supersededBy(b, [a])
    expect(narrowed).toMatchObject({ data: { keywords: ['gate', 'door'] } })
    expect(narrowed).not.toHaveProperty('data.description')

    const c = entryUpdate('c', { keywords: ['gate', 'door'], description: 'third' })
    expect(supersededBy(c, [a])).toEqual([{ change: a, narrowed: null }])
  })

  it('ignores an update to another entry', () => {
    const a = entryUpdate('a', { description: 'first' }, 1)
    const b = entryUpdate('b', { description: 'second' })
    expect(supersededBy(b, [a])).toEqual([])
  })

  it('does not alter the change it narrows', () => {
    const a = characterUpdate('a', { description: 'first', name: 'Anna' })
    supersededBy(characterUpdate('b', { description: 'second' }), [a])
    expect(a).toMatchObject({ data: { description: 'first' } })
  })
})
