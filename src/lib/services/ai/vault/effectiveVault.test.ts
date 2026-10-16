import { describe, expect, it } from 'vitest'
import type { VaultPendingChange } from '#lib/services/ai/sdk/schemas/vault.ts'
import type {
  VaultCharacter,
  VaultLorebook,
  VaultLorebookEntry,
  VaultScenario,
} from '#lib/types/index.ts'
import { effectiveVault } from '#lib/services/ai/vault/effectiveVault.ts'

const characterRecord = {
  name: 'Ann',
  description: 'A thief',
  traits: ['sly'],
  visualDescriptors: {},
  portrait: null,
  tags: ['crew'],
  favorite: false,
}

const character = (id = 'c1'): VaultCharacter =>
  ({ id, ...characterRecord, source: 'manual' }) as never

const npc = (name: string) => ({
  name,
  role: 'guard',
  description: '',
  relationship: '',
  traits: [],
})

const scenarioRecord = {
  name: 'Heist',
  description: null,
  settingSeed: 'A vault',
  npcs: [npc('Gate')],
  primaryCharacterName: 'Ann',
  firstMessage: null,
  alternateGreetings: [],
  tags: [],
  favorite: false,
}

const scenario = (): VaultScenario => ({ id: 's1', ...scenarioRecord, source: 'manual' }) as never

const entry = (name: string): VaultLorebookEntry => ({
  name,
  type: 'character',
  description: `About ${name}`,
  keywords: [name.toLowerCase()],
  aliases: [],
  injectionMode: 'keyword',
  priority: 50,
})

const lorebook = (): VaultLorebook =>
  ({
    id: 'lb1',
    name: 'Book',
    description: 'A book',
    tags: [],
    entries: [entry('Ann'), entry('Bob'), entry('Cy')],
  }) as never

const update = (
  entityType: 'character' | 'scenario',
  id: string,
  data: Record<string, unknown>,
  status: VaultPendingChange['status'] = 'pending',
): VaultPendingChange => {
  const record = entityType === 'character' ? characterRecord : scenarioRecord
  return {
    id,
    toolCallId: id,
    entityType,
    action: 'update',
    entityId: entityType === 'character' ? 'c1' : 's1',
    status,
    data: { ...record, ...data },
    previous: record,
  } as never
}

const characterUpdate = (
  id: string,
  data: Record<string, unknown>,
  status?: VaultPendingChange['status'],
) => update('character', id, data, status)

const scenarioUpdate = (id: string, data: Record<string, unknown>) => update('scenario', id, data)

const entryChange = (id: string, fields: Record<string, unknown>): VaultPendingChange =>
  ({
    id,
    toolCallId: id,
    entityType: 'lorebook-entry',
    lorebookId: 'lb1',
    status: 'pending',
    ...fields,
  }) as never

const raw = (over: Partial<Parameters<typeof effectiveVault>[0]> = {}) => ({
  characters: [character()],
  scenarios: [scenario()],
  lorebooks: [lorebook()],
  ...over,
})

describe('effectiveVault characters', () => {
  it('lays a pending update over the saved character', () => {
    const vault = effectiveVault(raw(), [
      characterUpdate('u1', { description: 'A fence', traits: ['sly', 'tall'] }),
    ])

    expect(vault.characters[0]).toMatchObject({
      id: 'c1',
      source: 'manual',
      description: 'A fence',
      traits: ['sly', 'tall'],
    })
    expect(vault.unsavedFields('character', 'c1')).toEqual(['description', 'traits'])
  })

  it('composes two pending updates, adding and removing array items', () => {
    const vault = effectiveVault(raw(), [
      characterUpdate('u1', { traits: ['sly', 'tall'] }),
      characterUpdate('u2', { traits: [], tags: ['crew', 'lead'] }),
    ])

    expect(vault.characters[0].traits).toEqual(['tall'])
    expect(vault.characters[0].tags).toEqual(['crew', 'lead'])
  })

  it('ignores approved and rejected changes', () => {
    const saved = raw()
    const vault = effectiveVault(saved, [
      characterUpdate('u1', { description: 'Approved' }, 'approved'),
      characterUpdate('u2', { description: 'Rejected' }, 'rejected'),
    ])

    expect(vault.characters[0]).toBe(saved.characters[0])
    expect(vault.unsavedFields('character', 'c1')).toEqual([])
  })

  it('returns untouched entities by reference', () => {
    const saved = raw({ characters: [character('c1'), character('c2')] })
    const vault = effectiveVault(saved, [characterUpdate('u1', { description: 'A fence' })])

    expect(vault.characters[1]).toBe(saved.characters[1])
    expect(vault.scenarios[0]).toBe(saved.scenarios[0])
    expect(vault.lorebooks[0]).toBe(saved.lorebooks[0])
  })

  it('ignores a pending create, which has no id yet', () => {
    const saved = raw()
    const create = {
      id: 'n1',
      toolCallId: 'n1',
      entityType: 'character',
      action: 'create',
      status: 'pending',
      data: characterRecord,
    } as never

    expect(effectiveVault(saved, [create]).characters).toEqual(saved.characters)
  })
})

describe('effectiveVault scenarios', () => {
  it('composes NPC additions from two pending updates', () => {
    const vault = effectiveVault(raw(), [
      scenarioUpdate('u1', { npcs: [npc('Gate'), npc('Cook')] }),
      scenarioUpdate('u2', { npcs: [npc('Gate'), npc('Spy')] }),
    ])

    expect(vault.scenarios[0].npcs.map((n) => n.name)).toEqual(['Gate', 'Cook', 'Spy'])
    expect(vault.unsavedFields('scenario', 's1')).toEqual(['npcs'])
  })
})

describe('effectiveVault lorebooks', () => {
  it('overlays the defined fields of a pending lorebook update', () => {
    const update = {
      id: 'l1',
      toolCallId: 'l1',
      entityType: 'lorebook',
      action: 'update',
      entityId: 'lb1',
      status: 'pending',
      data: { name: 'Renamed', description: undefined, tags: undefined },
    } as never
    const vault = effectiveVault(raw(), [update])

    expect(vault.lorebooks[0]).toMatchObject({ name: 'Renamed', description: 'A book', tags: [] })
    expect(vault.unsavedFields('lorebook', 'lb1')).toEqual(['name'])
  })

  it('applies a pending entry update in place, ignoring empty strings', () => {
    const update = entryChange('e1', {
      action: 'update',
      entryIndex: 1,
      data: { name: 'Bobby', description: '' },
    })
    const vault = effectiveVault(raw(), [update])

    const entries = vault.lorebooks[0].entries
    expect(entries.map((e) => e.name)).toEqual(['Ann', 'Bobby', 'Cy'])
    expect(entries[1].description).toBe('About Bob')
  })

  it('skips an entry update whose index is out of range', () => {
    const update = entryChange('e1', { action: 'update', entryIndex: 9, data: { name: 'X' } })
    const saved = raw()

    expect(effectiveVault(saved, [update]).lorebooks[0].entries).toEqual(saved.lorebooks[0].entries)
  })

  it('flags pending deletes, merges, updates and creates without moving any index', () => {
    const vault = effectiveVault(raw(), [
      entryChange('e1', { action: 'delete', entryIndex: 0 }),
      entryChange('e2', { action: 'merge', entryIndices: [1, 2], data: entry('Merged') }),
      entryChange('e3', { action: 'update', entryIndex: 2, data: { name: 'Cyrus' } }),
      entryChange('e4', { action: 'create', data: entry('Dan') }),
    ])

    const status = vault.entryStatus('lb1')
    expect([...status.byIndex]).toEqual([
      [0, 'delete'],
      [1, 'merge'],
      [2, 'merge'],
    ])
    expect(status.creates).toEqual([{ name: 'Dan', type: 'character' }])
    expect(vault.lorebooks[0].entries.map((e) => e.name)).toEqual(['Ann', 'Bob', 'Cyrus'])
  })

  it('reports no entry status for a lorebook nothing touches', () => {
    const status = effectiveVault(raw(), []).entryStatus('lb1')

    expect(status.byIndex.size).toBe(0)
    expect(status.creates).toEqual([])
  })
})
