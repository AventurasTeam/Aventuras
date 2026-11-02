import { database, type SyncRecord } from '#lib/services/database.ts'
import {
  exchangeToCharacter,
  exchangeToScenario,
  exchangeToVaultLorebook,
  parseExchange,
} from '#lib/services/exchange/index.ts'
import type { ExchangeDocument, ExchangeEntity } from '#lib/services/exchange/index.ts'
import { exportService, type ExportTracking } from '#lib/services/export.ts'
import type { ImportResult, PackBindingResolution } from '#lib/services/import/index.ts'
import { importExportService } from '#lib/services/packs/import-export.ts'
import { validatePackImport, type PackExport } from '#lib/services/packs/validation.ts'
import { isAndroid, isIos } from '#lib/utils/platform.ts'
import type {
  SyncConnectionData,
  SyncEnvelope,
  SyncListItem,
  SyncListing,
  SyncListPrefs,
  SyncPeer,
  SyncPushOutcome,
  SyncSection,
  SyncVector,
  SyncWebviewRequest,
} from '#lib/types/sync.ts'
import { decodeEnvelope, encodeEnvelope } from './envelope'
import { parseListPrefs } from './rows'
import { SECTION_ENTITY, exportDocument, listLocalItems } from './sections'
import { syncService } from './service'
import {
  adoptVectorStatements,
  ensureIdentityStatements,
  rememberDeviceStatement,
} from './statements'
import { compareVectors, resolveVector, vectorAfterApplying } from './vectors'

function defaultDeviceName(): string {
  if (isAndroid()) return 'Android device'
  if (isIos()) return 'iOS device'
  return 'Desktop'
}

/** This device, naming it on first use. */
export async function loadSelf(): Promise<SyncPeer> {
  const self = await database.getSyncSelf()
  if (self.name) return self
  const name = defaultDeviceName()
  await database.setSyncDeviceName(name)
  return { ...self, name }
}

export async function renameSelf(name: string): Promise<void> {
  await database.setSyncDeviceName(name)
}

const LIST_PREFS_KEY = 'sync_list_prefs'

export async function loadListPrefs(): Promise<Partial<Record<SyncSection, SyncListPrefs>>> {
  return parseListPrefs(await database.getSetting(LIST_PREFS_KEY))
}

export async function saveListPrefs(
  prefs: Partial<Record<SyncSection, SyncListPrefs>>,
): Promise<void> {
  await database.setSetting(LIST_PREFS_KEY, JSON.stringify(prefs))
}

async function serverListing(section: SyncSection): Promise<SyncListing> {
  const [device, items] = await Promise.all([loadSelf(), listLocalItems(section)])
  return {
    device,
    items: items.map(({ lastSynced: _local, ...item }) => item),
  }
}

/** Gives the item an identity if this is its first transfer, and reads its current vector. */
async function identified(section: SyncSection, localId: string, selfId: string) {
  const entityType = SECTION_ENTITY[section]
  await database.transaction(
    ensureIdentityStatements(entityType, localId, crypto.randomUUID(), selfId),
  )
  const record = await database.getSyncRecord(entityType, localId)
  if (!record) throw new Error('That item no longer exists')
  return record
}

async function envelopeFor(
  section: SyncSection,
  localId: string,
  tracking: ExportTracking,
  syncId: string,
  vector: SyncVector,
): Promise<SyncEnvelope> {
  const [item] = await database.getSyncListing(section, localId)
  if (!item) throw new Error('That item no longer exists')
  return {
    section,
    syncId,
    vector,
    updatedAt: item.updatedAt,
    name: item.name,
    author: item.author,
    document: await exportDocument(section, localId, tracking),
  }
}

/** Answers a request from a connected device. */
export async function answerSyncRequest(
  request: SyncWebviewRequest,
  tracking: ExportTracking,
): Promise<string> {
  const { peer, action } = request
  await database.transaction([rememberDeviceStatement(peer.deviceId, peer.name)])

  switch (action.type) {
    case 'list':
      return JSON.stringify(await serverListing(action.section))

    case 'pull': {
      const self = await database.getSyncSelf()
      const { syncId, vector } = await identified(action.section, action.localId, self.deviceId)
      return encodeEnvelope(
        await envelopeFor(action.section, action.localId, tracking, syncId, vector),
      )
    }

    case 'settleVector': {
      const self = await database.getSyncSelf()
      const entityType = SECTION_ENTITY[action.section]
      const localId = await database.findSyncedLocalId(entityType, action.syncId)
      const current = await database.getSyncVector(action.syncId)
      const settled = !!localId && compareVectors(current, action.expected) === 'inSync'
      if (settled) {
        await database.transaction(
          adoptVectorStatements({
            entityType,
            localId,
            syncId: action.syncId,
            vector: action.vector,
            selfId: self.deviceId,
            peerId: peer.deviceId,
            now: Date.now(),
          }),
        )
      }
      return JSON.stringify({ settled })
    }

    case 'push':
      throw new Error('A push is not answered here')
  }
}

export async function fetchListing(
  connection: SyncConnectionData,
  self: SyncPeer,
  section: SyncSection,
): Promise<SyncListing> {
  const reply = await syncService.request(connection, self, { type: 'list', section })
  const listing: SyncListing = JSON.parse(reply)
  await database.transaction([
    rememberDeviceStatement(listing.device.deviceId, listing.device.name),
  ])
  return listing
}

/**
 * Sends an item. `theirs` is the other device's vector for this item, when sending replaces a
 * version with edits this one lacks.
 *
 * Waits for the receiver's answer. Nothing is recorded here: it can still refuse, and a resolved
 * vector kept for a send that never landed would outrank edits this device has not seen. Returns
 * what `confirmSends` looks for in a later listing.
 */
export async function sendItem(
  connection: SyncConnectionData,
  self: SyncPeer,
  section: SyncSection,
  localId: string,
  tracking: ExportTracking,
  theirs: SyncVector | null,
): Promise<{ syncId: string; vector: SyncVector; outcome: SyncPushOutcome }> {
  const record = await identified(section, localId, self.deviceId)
  const { syncId } = record
  const vector =
    theirs && compareVectors(record.vector, theirs) !== 'newerHere'
      ? resolveVector(record.vector, theirs, self.deviceId)
      : record.vector

  const envelope = await envelopeFor(section, localId, tracking, syncId, vector)
  const reply = await syncService.request(connection, self, {
    type: 'push',
    payload: encodeEnvelope(envelope),
  })
  const outcome = reply === 'applied' || reply === 'declined' ? reply : 'waiting'
  return { syncId, vector, outcome }
}

/** Records sends the other device's listing shows it has applied. */
export async function confirmSends(
  section: SyncSection,
  items: SyncListItem[],
  peer: SyncPeer,
  sent: Map<string, SyncVector>,
): Promise<void> {
  const landed = items.filter((item) => {
    const vector = item.syncId ? sent.get(item.syncId) : undefined
    return vector && item.vector && compareVectors(item.vector, vector) === 'inSync'
  })
  if (landed.length === 0) return

  const self = await database.getSyncSelf()
  const entityType = SECTION_ENTITY[section]
  const now = Date.now()
  for (const { syncId } of landed) {
    const id = syncId as string
    const localId = await database.findSyncedLocalId(entityType, id)
    const vector = sent.get(id)
    sent.delete(id)
    if (!localId || !vector) continue
    await database.transaction(
      adoptVectorStatements({
        entityType,
        localId,
        syncId: id,
        vector,
        selfId: self.deviceId,
        peerId: peer.deviceId,
        now,
      }),
    )
  }
}

export async function pullEnvelope(
  connection: SyncConnectionData,
  self: SyncPeer,
  section: SyncSection,
  remoteId: string,
): Promise<SyncEnvelope> {
  const reply = await syncService.request(connection, self, {
    type: 'pull',
    section,
    localId: remoteId,
  })
  return decodeEnvelope(reply)
}

/** Tells the other device the item landed, and the vector both should now hold. */
export async function settleVector(
  connection: SyncConnectionData,
  self: SyncPeer,
  envelope: SyncEnvelope,
  vector: SyncVector,
): Promise<void> {
  await syncService.request(connection, self, {
    type: 'settleVector',
    section: envelope.section,
    syncId: envelope.syncId,
    expected: envelope.vector,
    vector,
  })
}

export type ReceiveTarget =
  | { kind: 'new' }
  | { kind: 'replace'; localId: string }
  /** A local item of the same name with no identity: the user decides whether they are one. */
  | { kind: 'sameName'; localId: string }

export async function findReceiveTarget(envelope: SyncEnvelope): Promise<ReceiveTarget> {
  const entityType = SECTION_ENTITY[envelope.section]
  const localId = await database.findSyncedLocalId(entityType, envelope.syncId)
  if (localId) return { kind: 'replace', localId }

  const items = await listLocalItems(envelope.section)
  const candidates = items.filter(
    (i) =>
      !i.syncId &&
      i.name === envelope.name &&
      (envelope.section !== 'packs' || (i.author ?? null) === (envelope.author ?? null)),
  )
  return candidates.length === 1
    ? { kind: 'sameName', localId: candidates[0].localId }
    : { kind: 'new' }
}

export async function storiesUsingPack(packId: string): Promise<number> {
  return database.getPackUsageCount(packId)
}

function exchangeDocument<E extends ExchangeEntity>(text: string, entity: E): ExchangeDocument<E> {
  const parsed = parseExchange(text, entity)
  if (parsed.kind !== 'exchange') {
    throw new Error(parsed.kind === 'invalid' ? parsed.error : 'Unreadable item')
  }
  return parsed.document
}

function packDocument(text: string): PackExport {
  const { valid, pack, errors } = validatePackImport(JSON.parse(text))
  if (!valid || !pack) throw new Error(errors?.join(', ') ?? 'Unreadable prompt pack')
  return pack
}

/** Adds a vault item or pack as a new row. Returns its local id, and its name if it changed. */
async function addItem(
  envelope: SyncEnvelope,
  name: string,
): Promise<{ localId: string; name: string }> {
  const local = { id: crypto.randomUUID(), originalFilename: 'sync' }
  switch (envelope.section) {
    case 'characters': {
      const { data } = exchangeDocument(envelope.document, 'character')
      await database.addVaultCharacter({ ...exchangeToCharacter(data, local), name })
      return { localId: local.id, name }
    }
    case 'lorebooks': {
      const { data } = exchangeDocument(envelope.document, 'lorebook')
      await database.addVaultLorebook({ ...exchangeToVaultLorebook(data, local), name })
      return { localId: local.id, name }
    }
    case 'scenarios': {
      const { data } = exchangeDocument(envelope.document, 'scenario')
      await database.addVaultScenario({ ...exchangeToScenario(data, local), name })
      return { localId: local.id, name }
    }
    case 'packs': {
      const pack = packDocument(envelope.document)
      const finalName = await importExportService.uniqueName(name)
      const localId = await importExportService.applyImport({ ...pack, name: finalName }, 'rename')
      if (!localId) throw new Error('Could not add the prompt pack')
      return { localId, name: finalName }
    }
    case 'stories':
      throw new Error('Stories are imported separately')
  }
}

export interface ApplyResult {
  localId: string
  /** The vector the item ended with, which differs from the envelope's after a resolution. */
  vector: SyncVector
  /** Set when a pack had to take another name. */
  renamedTo?: string
}

/** Applies a vault item or pack, new or replacing `existingId`. */
export async function applyItem(
  envelope: SyncEnvelope,
  peer: SyncPeer,
  existingId: string | null,
): Promise<ApplyResult> {
  const self = await database.getSyncSelf()
  const entityType = SECTION_ENTITY[envelope.section]
  const now = Date.now()
  const adopt = (localId: string, vector: SyncVector) =>
    adoptVectorStatements({
      entityType,
      localId,
      syncId: envelope.syncId,
      vector,
      selfId: self.deviceId,
      peerId: peer.deviceId,
      now,
    })

  if (!existingId) {
    const added = await addItem(envelope, envelope.name)
    await database.transaction([
      ...adopt(added.localId, envelope.vector),
      database.syncedTimeStatement(envelope.section, added.localId, envelope.updatedAt),
    ])
    return {
      localId: added.localId,
      vector: envelope.vector,
      ...(added.name !== envelope.name ? { renamedTo: added.name } : {}),
    }
  }

  const local = await database.getSyncRecord(entityType, existingId)
  const vector = vectorAfterApplying(
    local?.syncId === envelope.syncId ? local.vector : null,
    envelope.vector,
    self.deviceId,
  )
  const update = { id: existingId, originalFilename: 'sync' }
  let content
  let renamedTo: string | undefined

  switch (envelope.section) {
    case 'characters': {
      const { data } = exchangeDocument(envelope.document, 'character')
      content = [database.vaultCharacterReplaceStatement(exchangeToCharacter(data, update))]
      break
    }
    case 'lorebooks': {
      const { data } = exchangeDocument(envelope.document, 'lorebook')
      content = [database.vaultLorebookReplaceStatement(exchangeToVaultLorebook(data, update))]
      break
    }
    case 'scenarios': {
      const { data } = exchangeDocument(envelope.document, 'scenario')
      content = [database.vaultScenarioReplaceStatement(exchangeToScenario(data, update))]
      break
    }
    case 'packs': {
      const pack = packDocument(envelope.document)
      const name = await importExportService.uniqueName(pack.name, existingId)
      if (name !== pack.name) renamedTo = name
      content = await database.packSyncStatements(existingId, { ...pack, name })
      break
    }
    default:
      throw new Error('Stories are imported separately')
  }

  await database.transaction([
    ...content,
    ...adopt(existingId, vector),
    database.syncedTimeStatement(envelope.section, existingId, envelope.updatedAt),
  ])
  return { localId: existingId, vector, ...(renamedTo ? { renamedTo } : {}) }
}

/** A story's sync state, to read before a replacement deletes it. */
export async function storySyncRecord(storyId: string): Promise<SyncRecord | null> {
  return database.getSyncRecord('story', storyId)
}

/**
 * Applies a story, replacing `existingId` if given. `previous` comes from the caller because a
 * failed import has already deleted the original, and a retry has to carry the same history.
 */
export async function applyStory(
  envelope: SyncEnvelope,
  peer: SyncPeer,
  existingId: string | null,
  packBinding: PackBindingResolution,
  previous: SyncRecord | null,
): Promise<ImportResult & { vector?: SyncVector }> {
  const self = await database.getSyncSelf()
  const prior = previous?.syncId === envelope.syncId ? previous : null

  const result = await importSyncedStory(envelope.document, existingId, packBinding)
  if (!result.success || !result.storyId) return result

  const vector = vectorAfterApplying(prior?.vector ?? null, envelope.vector, self.deviceId)
  await database.transaction([
    ...adoptVectorStatements({
      entityType: 'story',
      localId: result.storyId,
      syncId: envelope.syncId,
      vector,
      selfId: self.deviceId,
      peerId: peer.deviceId,
      now: Date.now(),
      lastSynced: prior?.lastSynced,
    }),
    database.syncedTimeStatement('stories', result.storyId, envelope.updatedAt),
  ])
  return { ...result, vector }
}

/** The name of a copy from another device. */
export function copyName(name: string, peer: SyncPeer): string {
  return `${name} (from ${peer.name})`
}

/** Adds a separate copy with no identity, leaving every existing item alone. */
export async function applyCopy(
  envelope: SyncEnvelope,
  peer: SyncPeer,
  packBinding: PackBindingResolution | null,
): Promise<void> {
  const name = copyName(envelope.name, peer)
  if (envelope.section !== 'stories') {
    await addItem(envelope, name)
    return
  }
  if (!packBinding) throw new Error('A story needs a prompt pack')
  const result = await importSyncedStory(envelope.document, null, packBinding)
  if (!result.success || !result.storyId) throw new Error(result.error ?? 'Import failed')
  await database.updateStory(result.storyId, { title: name })
}

export async function importSyncedStory(
  storyJson: string,
  existingStoryId: string | null,
  packBinding: PackBindingResolution,
): Promise<ImportResult> {
  if (existingStoryId) await syncService.deleteStory(existingStoryId)

  return exportService.importFromContent(storyJson, true, {
    resolvePackBinding: async () => packBinding,
  })
}
