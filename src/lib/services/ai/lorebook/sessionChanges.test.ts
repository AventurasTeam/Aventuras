import { describe, it, expect } from 'vitest'
import type { Entry, VaultLorebookEntry } from '$lib/types'
import { LoreSessionLedger } from './sessionChanges'
import { createDefaultEntryState } from './entryState'

const entry = (name: string, over: Partial<Entry> = {}): Entry => ({
  id: `id-${name}`,
  storyId: 'story',
  name,
  type: 'character',
  description: `About ${name}`,
  hiddenInfo: null,
  aliases: [],
  state: createDefaultEntryState('character'),
  adventureState: null,
  creativeState: null,
  injection: { mode: 'keyword', keywords: [name], priority: 50 },
  createdBy: 'ai',
  createdAt: 1000,
  updatedAt: 1000,
  loreManagementBlacklisted: false,
  branchId: null,
  ...over,
})

const vault = (name: string): VaultLorebookEntry => ({
  name,
  type: 'character',
  description: `About ${name}`,
  keywords: [name],
  aliases: [],
  injectionMode: 'keyword',
  priority: 50,
})

/** A ledger over `names`, plus the array the tools read. */
function ledgerFor(...entries: Entry[]) {
  const vaultEntries = entries.map((e) => vault(e.name))
  return {
    ledger: new LoreSessionLedger(entries, vaultEntries, 'story'),
    vaultEntries,
  }
}

const change = (c: Record<string, unknown>) =>
  ({ id: 'c', toolCallId: 'c', status: 'approved', ...c }) as never

describe('update', () => {
  it('accumulates two updates to one entry instead of dropping the first', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'update', index: 0, updates: { description: 'A knight.' } }))
    ledger.apply(change({ type: 'update', index: 0, updates: { keywords: ['oath'] } }))

    const [updated] = ledger.result().updatedEntries
    expect(updated.description).toBe('A knight.')
    expect(updated.injection.keywords).toEqual(['oath'])
  })

  it('lands on an entry created earlier in the same session', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'create', entry: vault('Liora') }))
    // Index 1 exists only because the create appended to the array the tools index into.
    ledger.apply(change({ type: 'update', index: 1, updates: { description: 'A herbalist.' } }))

    const { createdEntries, updatedEntries } = ledger.result()
    expect(createdEntries).toHaveLength(1)
    expect(createdEntries[0].description).toBe('A herbalist.')
    // One create, not a create plus an update of a row that does not exist yet.
    expect(updatedEntries).toEqual([])
  })

  it('leaves an untouched entry out of the result', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))
    expect(ledger.result().updatedEntries).toEqual([])
  })
})

describe('delete', () => {
  it('does not write an entry it is about to remove', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'update', index: 0, updates: { description: 'edited' } }))
    ledger.apply(change({ type: 'delete', index: 0 }))

    const { updatedEntries, deletedEntries } = ledger.result()
    expect(updatedEntries).toEqual([])
    expect(deletedEntries.map((e) => e.id)).toEqual(['id-Kaelen'])
  })

  it('drops a session-created entry rather than deleting a row that has none', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'create', entry: vault('Liora') }))
    ledger.apply(change({ type: 'delete', index: 1 }))

    expect(ledger.result()).toMatchObject({ createdEntries: [], deletedEntries: [] })
  })

  it('refuses a slot it already consumed', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'delete', index: 0 }))
    ledger.apply(change({ type: 'delete', index: 0 }))

    expect(ledger.result().deletedEntries).toHaveLength(1)
    expect([...ledger.removedIndices]).toEqual([0])
  })
})

describe('merge', () => {
  it('keeps every source hidden info, which the agent never sees', () => {
    const { ledger } = ledgerFor(
      entry('Kaelen', { hiddenInfo: 'Secretly the heir.' }),
      entry('Kaelan', { hiddenInfo: 'Killed the steward.', createdAt: 2000 }),
    )

    ledger.apply(change({ type: 'merge', indices: [0, 1], entry: vault('Kaelen') }))

    const [merge] = ledger.result().merges
    expect(merge.merged.hiddenInfo).toBe('Secretly the heir.\n\nKilled the steward.')
    expect(merge.sources.map((e) => e.id)).toEqual(['id-Kaelen', 'id-Kaelan'])
  })

  it('takes the oldest source as the primary, keeping its tracked state', () => {
    const older = entry('Kaelen', { createdAt: 500, hiddenInfo: 'Secretly the heir.' })
    const { ledger } = ledgerFor(entry('Kaelan', { createdAt: 900 }), older)

    ledger.apply(change({ type: 'merge', indices: [0, 1], entry: vault('Kaelen') }))

    expect(ledger.result().merges[0].merged.createdAt).toBe(500)
  })

  it('folds a session-created member in without inventing a row to delete', () => {
    const { ledger } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'create', entry: vault('Kaelan') }))
    ledger.apply(change({ type: 'merge', indices: [0, 1], entry: vault('Kaelen') }))

    const { merges, createdEntries } = ledger.result()
    expect(createdEntries).toEqual([])
    expect(merges[0].sources.map((e) => e.id)).toEqual(['id-Kaelen'])
  })

  it('becomes a plain create when no member has a row of its own', () => {
    const { ledger } = ledgerFor()

    ledger.apply(change({ type: 'create', entry: vault('Kaelen') }))
    ledger.apply(change({ type: 'create', entry: vault('Kaelan') }))
    ledger.apply(change({ type: 'merge', indices: [0, 1], entry: vault('Kaelen') }))

    const { merges, createdEntries } = ledger.result()
    expect(merges).toEqual([])
    expect(createdEntries.map((e) => e.name)).toEqual(['Kaelen'])
  })

  it('ignores a merge left with fewer than two live members', () => {
    const { ledger } = ledgerFor(entry('Kaelen'), entry('Kaelan'))

    ledger.apply(change({ type: 'delete', index: 1 }))
    ledger.apply(change({ type: 'merge', indices: [0, 1], entry: vault('Kaelen') }))

    expect(ledger.result().merges).toEqual([])
  })
})

describe('the array the tools read', () => {
  it('shows an update immediately, so the agent is not looking at a stale lorebook', () => {
    const { ledger, vaultEntries } = ledgerFor(entry('Kaelen'))

    ledger.apply(change({ type: 'update', index: 0, updates: { description: 'A knight.' } }))

    expect(vaultEntries[0].description).toBe('A knight.')
  })

  it('never shrinks, so the indices the model holds stay valid', () => {
    const { ledger, vaultEntries } = ledgerFor(entry('Kaelen'), entry('Mara'))

    ledger.apply(change({ type: 'delete', index: 0 }))

    expect(vaultEntries).toHaveLength(2)
    expect(vaultEntries[1].name).toBe('Mara')
  })
})
