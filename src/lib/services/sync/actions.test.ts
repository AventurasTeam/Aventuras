import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncEnvelope, SyncWebviewRequest } from '#lib/types/sync.ts'

const sync = {
  request: vi.fn(),
  deleteStory: vi.fn(),
  exportStoryToJson: vi.fn(),
}
const importFromContent = vi.fn()
const db = {
  getSyncSelf: vi.fn(),
  getSyncRecord: vi.fn(),
  getSyncRecords: vi.fn(),
  getSyncVector: vi.fn(),
  findSyncedLocalId: vi.fn(),
  setSyncDeviceName: vi.fn(),
  getSyncListing: vi.fn(),
  addVaultCharacter: vi.fn(),
  deleteVaultCharacter: vi.fn(),
  updateStory: vi.fn(),
  transaction: vi.fn(),
  vaultCharacterReplaceStatement: vi.fn(() => ({ sql: 'REPLACE CHARACTER' })),
  packSyncStatements: vi.fn(async () => [{ sql: 'REPLACE PACK' }]),
  syncedTimeStatement: vi.fn(() => ({ sql: 'SET TIME' })),
}
const packs = {
  uniqueName: vi.fn(),
  applyImport: vi.fn(),
  packExportData: vi.fn(),
}

vi.mock('./service', () => ({ syncService: sync }))
vi.mock('#lib/services/database.ts', () => ({ database: db }))
vi.mock('#lib/services/export.ts', () => ({ exportService: { importFromContent } }))
vi.mock('#lib/services/packs/import-export.ts', () => ({ importExportService: packs }))
vi.mock('#lib/utils/platform.ts', () => ({ isAndroid: () => false, isIos: () => false }))

const actions = await import('./actions')
const { decodeEnvelope, encodeEnvelope } = await import('./envelope')

const self = { deviceId: 'me', name: 'Phone' }
const peer = { deviceId: 'pc', name: 'PC' }
const connection = { ip: '192.0.2.1', port: 4321, token: 'token' }
const tracking = { on: false, enabledSince: null }
const binding = { packId: 'pack-1', customVariableValues: {} }

const characterDocument = JSON.stringify({
  format: 'aventuras-exchange',
  formatVersion: '1.0.0',
  entity: 'character',
  exportedAt: 0,
  data: {
    name: 'Ana',
    description: null,
    traits: [],
    visualDescriptors: {},
    portrait: null,
    tags: [],
    favorite: false,
    metadata: {},
  },
})

const packDocument = JSON.stringify({
  version: 1,
  name: 'Noir',
  templates: [],
  variables: [],
})

function envelope(over: Partial<SyncEnvelope> = {}): SyncEnvelope {
  return {
    section: 'characters',
    syncId: 'sync-1',
    vector: { pc: 2 },
    updatedAt: 500,
    name: 'Ana',
    document: characterDocument,
    ...over,
  }
}

function writes(): { sql: string; params?: unknown[] }[] {
  return db.transaction.mock.calls.flatMap(([statements]) => statements)
}

function vectorWrites() {
  return writes()
    .filter((s) => s.sql.includes('INSERT INTO sync_vector'))
    .map((s) => s.params)
}

beforeEach(() => {
  vi.clearAllMocks()
  db.getSyncSelf.mockResolvedValue(self)
  db.getSyncRecord.mockResolvedValue(null)
  db.getSyncRecords.mockResolvedValue(new Map())
  db.getSyncListing.mockResolvedValue([])
  db.findSyncedLocalId.mockResolvedValue(null)
  packs.uniqueName.mockImplementation(async (name: string) => name)
  importFromContent.mockResolvedValue({ success: true, storyId: 'new-story' })
})

describe('loadSelf', () => {
  it('names an unnamed device once', async () => {
    db.getSyncSelf.mockResolvedValue({ deviceId: 'me', name: '' })
    expect(await actions.loadSelf()).toEqual({ deviceId: 'me', name: 'Desktop' })
    expect(db.setSyncDeviceName).toHaveBeenCalledWith('Desktop')
  })
})

describe('applyItem', () => {
  it('adds a new item under the incoming identity and time', async () => {
    const result = await actions.applyItem(envelope(), peer, null)

    expect(db.addVaultCharacter).toHaveBeenCalledOnce()
    expect(result.vector).toEqual({ pc: 2 })
    expect(writes().at(-1)?.sql).toBe('SET TIME')
  })

  it("leaves a new item unfavourited and a replaced one's own metadata alone", async () => {
    await actions.applyItem(envelope(), peer, null)
    expect(db.addVaultCharacter.mock.calls[0][0]).toMatchObject({ favorite: false })

    await actions.applyItem(envelope(), peer, 'local-1')
    expect(db.vaultCharacterReplaceStatement).toHaveBeenLastCalledWith(expect.anything(), {
      cardVersion: null,
    })
  })

  it('removes a new row whose sync state could not be written', async () => {
    db.transaction.mockRejectedValueOnce(new Error('locked'))

    await expect(actions.applyItem(envelope(), peer, null)).rejects.toThrow('locked')
    expect(db.deleteVaultCharacter).toHaveBeenCalledOnce()
  })

  it('replaces in one batch that keeps the local id, with the vector after the content', async () => {
    db.getSyncRecord.mockResolvedValue({ syncId: 'sync-1', vector: { pc: 1 }, lastSynced: {} })

    const result = await actions.applyItem(envelope(), peer, 'local-1')

    expect(db.transaction).toHaveBeenCalledOnce()
    expect(result.localId).toBe('local-1')
    expect(writes()[0].sql).toBe('REPLACE CHARACTER')
    expect(vectorWrites()).toContainEqual(['sync-1', 'pc', 2, expect.any(Number)])
    expect(vectorWrites()).toContainEqual(['sync-1', 'me', 0, null])
  })

  it('resolves when the local version holds edits the incoming one lacks', async () => {
    db.getSyncRecord.mockResolvedValue({ syncId: 'sync-1', vector: { me: 3 }, lastSynced: {} })

    const { vector } = await actions.applyItem(envelope(), peer, 'local-1')

    expect(vector).toEqual({ me: 4, pc: 2 })
  })

  it('updates a pack in place', async () => {
    const pack = envelope({ section: 'packs', name: 'Noir', document: packDocument })
    const result = await actions.applyItem(pack, peer, 'pack-1')

    expect(result.localId).toBe('pack-1')
    expect(db.packSyncStatements).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ name: 'Noir' }),
    )
    expect(result.renamedTo).toBeUndefined()
  })

  it('renames an incoming pack whose name another pack holds', async () => {
    packs.uniqueName.mockResolvedValue('Noir (Imported)')
    const pack = envelope({ section: 'packs', name: 'Noir', document: packDocument })

    const result = await actions.applyItem(pack, peer, 'pack-1')

    expect(packs.uniqueName).toHaveBeenCalledWith('Noir', 'pack-1')
    expect(result.renamedTo).toBe('Noir (Imported)')
    expect(db.packSyncStatements).toHaveBeenCalledWith(
      'pack-1',
      expect.objectContaining({ name: 'Noir (Imported)' }),
    )
  })

  it('rejects an unreadable document before writing anything', async () => {
    await expect(actions.applyItem(envelope({ document: '{}' }), peer, null)).rejects.toThrow()
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('applyStory', () => {
  const story = envelope({ section: 'stories', name: 'Saga', document: '{"story":{}}' })

  it('keeps last-sync times across the delete and import', async () => {
    const previous = { syncId: 'sync-1', vector: { pc: 1 }, lastSynced: { tablet: 7 } }

    await actions.applyStory(story, peer, 'old-story', binding, previous)

    expect(sync.deleteStory).toHaveBeenCalledWith('old-story')
    expect(vectorWrites()).toContainEqual(['sync-1', 'tablet', 0, 7])
    expect(
      writes().find((s) => s.sql.includes('INSERT OR IGNORE INTO sync_identity'))?.params,
    ).toEqual(['story', 'new-story', 'sync-1'])
  })

  it('writes nothing to the sync tables when the import fails', async () => {
    importFromContent.mockResolvedValue({ success: false, error: 'boom' })

    const result = await actions.applyStory(story, peer, null, binding, null)

    expect(result.success).toBe(false)
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('keeps the original when the replacing import fails', async () => {
    importFromContent.mockResolvedValue({ success: false, error: 'boom' })

    await actions.applyStory(story, peer, 'old-story', binding, null)

    expect(sync.deleteStory).not.toHaveBeenCalled()
  })

  it('imports without deleting when nothing is replaced', async () => {
    await actions.applyStory(story, peer, null, binding, null)
    expect(sync.deleteStory).not.toHaveBeenCalled()
  })
})

describe('applyCopy', () => {
  it('names the copy and gives it no identity', async () => {
    await actions.applyCopy(envelope(), peer, null)

    expect(db.addVaultCharacter.mock.calls[0][0].name).toBe('Ana (from PC)')
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('renames a copied story without linking it', async () => {
    const story = envelope({ section: 'stories', name: 'Saga', document: '{}' })

    await actions.applyCopy(story, peer, binding)

    expect(sync.deleteStory).not.toHaveBeenCalled()
    expect(db.updateStory).toHaveBeenCalledWith('new-story', { title: 'Saga (from PC)' })
    expect(db.transaction).not.toHaveBeenCalled()
  })
})

describe('findReceiveTarget', () => {
  it('replaces by identity, whatever the name', async () => {
    db.findSyncedLocalId.mockResolvedValue('local-1')
    expect(await actions.findReceiveTarget(envelope())).toEqual({
      kind: 'replace',
      localId: 'local-1',
    })
  })

  it('offers a same-named item with no identity', async () => {
    db.getSyncListing.mockResolvedValue([{ localId: 'c', name: 'Ana', updatedAt: 0 }])
    expect(await actions.findReceiveTarget(envelope())).toEqual({
      kind: 'sameName',
      localId: 'c',
    })
  })

  it('adds beside a same-named item with a different identity', async () => {
    db.getSyncListing.mockResolvedValue([{ localId: 'c', name: 'Ana', updatedAt: 0 }])
    db.getSyncRecords.mockResolvedValue(
      new Map([['c', { syncId: 'other', vector: {}, lastSynced: {} }]]),
    )
    expect(await actions.findReceiveTarget(envelope())).toEqual({ kind: 'new' })
  })
})

describe('sendItem', () => {
  beforeEach(() => {
    db.getSyncRecord.mockResolvedValue({ syncId: 'sync-1', vector: { me: 2 }, lastSynced: {} })
    db.getSyncListing.mockResolvedValue([{ localId: 'c', name: 'Ana', updatedAt: 9 }])
    const character = { name: 'Ana', traits: [], tags: [], visualDescriptors: {} }
    Object.assign(db, { getVaultCharacter: vi.fn(async () => character) })
  })

  function pushed(): SyncEnvelope {
    return decodeEnvelope(sync.request.mock.calls[0][2].payload)
  }

  it('sends the current vector when this device is simply newer', async () => {
    await actions.sendItem(connection, self, 'characters', 'c', tracking, { me: 1 })
    expect(pushed().vector).toEqual({ me: 2 })
  })

  it('gives an item with no identity the sync ID of the same-name item it replaces', async () => {
    await actions.sendItem(connection, self, 'characters', 'c', tracking, { pc: 4 }, 'theirs')

    expect(
      writes().find((s) => s.sql.includes('INSERT OR IGNORE INTO sync_identity'))?.params,
    ).toEqual(['character', 'c', 'theirs'])
  })

  it('resolves over a version with edits this one lacks, without recording it', async () => {
    const sent = await actions.sendItem(connection, self, 'characters', 'c', tracking, { pc: 4 })

    expect(pushed().vector).toEqual({ me: 3, pc: 4 })
    expect(sent).toMatchObject({ syncId: 'sync-1', vector: { me: 3, pc: 4 } })
    expect(vectorWrites()).toEqual([])
  })

  it.each(['applied', 'declined', 'waiting'])('reports the answer %s', async (reply) => {
    sync.request.mockResolvedValueOnce(reply)
    const sent = await actions.sendItem(connection, self, 'characters', 'c', tracking, null)
    expect(sent.outcome).toBe(reply)
  })
})

describe('confirmSends', () => {
  const item = (vector: Record<string, number>) => ({
    localId: 'r',
    name: 'Ana',
    updatedAt: 0,
    syncId: 'sync-1',
    vector,
  })

  beforeEach(() => db.findSyncedLocalId.mockResolvedValue('c'))

  it('records a send once the other device holds its vector', async () => {
    const sent = new Map([['sync-1', { vector: { me: 3, pc: 4 }, baseline: { me: 2 } }]])
    db.getSyncVector.mockResolvedValue({ me: 2 })

    await actions.confirmSends('characters', [item({ me: 3, pc: 4 })], peer, sent)

    expect(vectorWrites()).toContainEqual(['sync-1', 'me', 3, null])
    expect(vectorWrites()).toContainEqual(['sync-1', 'pc', 4, expect.any(Number)])
    expect(sent.size).toBe(0)
  })

  it('leaves a send the other device has not applied', async () => {
    const sent = new Map([['sync-1', { vector: { me: 3, pc: 4 }, baseline: { me: 2 } }]])

    await actions.confirmSends('characters', [item({ pc: 4 })], peer, sent)

    expect(vectorWrites()).toEqual([])
    expect(sent.size).toBe(1)
  })

  it('keeps an edit made here while the send waited', async () => {
    const sent = new Map([['sync-1', { vector: { me: 3, pc: 4 }, baseline: { me: 2 } }]])
    db.getSyncVector.mockResolvedValue({ me: 3 })

    await actions.confirmSends('characters', [item({ me: 3, pc: 4 })], peer, sent)

    expect(vectorWrites()).toEqual([])
    expect(sent.size).toBe(0)
  })
})

describe('answerSyncRequest', () => {
  const request = (action: SyncWebviewRequest['action']): SyncWebviewRequest => ({
    requestId: 'r',
    peer,
    action,
  })

  it("refuses a peer that has this device's ID", async () => {
    const clone = {
      requestId: 'r',
      peer: self,
      action: { type: 'list' as const, section: 'packs' as const },
    }
    await expect(actions.answerSyncRequest(clone, tracking)).rejects.toThrow('same sync ID')
    expect(db.transaction).not.toHaveBeenCalled()
  })

  it('leaves last-sync times out of a listing', async () => {
    db.getSyncListing.mockResolvedValue([{ localId: 'c', name: 'Ana', updatedAt: 1 }])
    db.getSyncRecords.mockResolvedValue(
      new Map([['c', { syncId: 's', vector: { me: 1 }, lastSynced: { pc: 5 } }]]),
    )

    const listing = JSON.parse(
      await actions.answerSyncRequest(request({ type: 'list', section: 'characters' }), tracking),
    )

    expect(listing.device).toEqual(self)
    expect(listing.items[0]).toEqual({
      localId: 'c',
      name: 'Ana',
      updatedAt: 1,
      syncId: 's',
      vector: { me: 1 },
    })
  })

  it('leaves unnamed records out of a listing', async () => {
    db.getSyncListing.mockResolvedValue([{ localId: 'c', name: '  ', updatedAt: 1 }])
    const characters = JSON.parse(
      await actions.answerSyncRequest(request({ type: 'list', section: 'characters' }), tracking),
    )
    expect(characters.items).toEqual([])
  })

  const settle = request({
    type: 'settleVector',
    section: 'characters',
    syncId: 'sync-1',
    expected: { pc: 2 },
    vector: { pc: 2, me: 3 },
  })

  it('does not call a pull synced before the client confirms it', async () => {
    db.getSyncListing.mockResolvedValue([{ localId: 'c', name: 'Ana', updatedAt: 1 }])
    db.getSyncRecord.mockResolvedValue({ syncId: 'sync-1', vector: { me: 2 }, lastSynced: {} })
    const character = { name: 'Ana', traits: [], tags: [], visualDescriptors: {} }
    Object.assign(db, { getVaultCharacter: vi.fn(async () => character) })

    const reply = await actions.answerSyncRequest(
      request({ type: 'pull', section: 'characters', localId: 'c' }),
      tracking,
    )

    expect(decodeEnvelope(reply).syncId).toBe('sync-1')
    expect(vectorWrites()).toEqual([])
  })

  it('adopts a settled vector when the item has not moved', async () => {
    db.findSyncedLocalId.mockResolvedValue('c')
    db.getSyncVector.mockResolvedValue({ pc: 2 })

    expect(JSON.parse(await actions.answerSyncRequest(settle, tracking))).toEqual({ settled: true })
    expect(vectorWrites()).toContainEqual(['sync-1', 'me', 3, null])
  })

  it('refuses a proposed vector behind the expected one', async () => {
    db.findSyncedLocalId.mockResolvedValue('c')
    db.getSyncVector.mockResolvedValue({ pc: 2 })

    const behind = request({
      type: 'settleVector',
      section: 'characters',
      syncId: 'sync-1',
      expected: { pc: 2 },
      vector: { pc: 1 },
    })
    const reply = await actions.answerSyncRequest(behind, tracking)

    expect(JSON.parse(reply)).toEqual({ settled: false })
    expect(vectorWrites()).toEqual([])
  })

  it('writes no identity for an item that no longer exists', async () => {
    await expect(
      actions.answerSyncRequest(
        request({ type: 'pull', section: 'characters', localId: 'gone' }),
        tracking,
      ),
    ).rejects.toThrow('no longer exists')
    expect(db.transaction).toHaveBeenCalledTimes(1)
  })

  it('refuses a settled vector when the item moved on', async () => {
    db.findSyncedLocalId.mockResolvedValue('c')
    db.getSyncVector.mockResolvedValue({ pc: 3 })

    expect(JSON.parse(await actions.answerSyncRequest(settle, tracking))).toEqual({
      settled: false,
    })
    expect(vectorWrites()).toEqual([])
  })
})

describe('envelope encoding', () => {
  it('round-trips, leaving the document as it was', () => {
    const original = envelope({ document: '{"a":"line one\nline two"}' })
    expect(decodeEnvelope(encodeEnvelope(original))).toEqual(original)
  })

  it('does not escape the document', () => {
    expect(encodeEnvelope(envelope({ document: '{"a":1}' })).endsWith('\n{"a":1}')).toBe(true)
  })

  it('rejects text with no header', () => {
    expect(() => decodeEnvelope('{}')).toThrow()
  })
})
