import { invoke } from '@tauri-apps/api/core'
import type {
  SyncAction,
  SyncConnectionData,
  SyncPeer,
  SyncReceivedItem,
  SyncServerInfo,
} from '#lib/types/sync.ts'
import type { AventuraExport } from '../export'
import type { PackBindingExport } from '../import'
// The one piece of the `.avt` exporter sync shares. See the note on `exportStoryToJson` for what
// is deliberately *not* shared.
import { gatherPackBinding, NOT_VOUCHED, type ExportTracking } from '../export'
import { marksForExport, recordsForExport } from '../stateTracking'
import { database } from '../database'
import { parseConnectionData } from './connectionCode'

/** Sync alone names the pack's identity: it stays out of `.avt` files. */
async function withPackSyncId(
  storyId: string,
  binding: PackBindingExport,
): Promise<PackBindingExport> {
  const packId = await database.getStoryPackId(storyId)
  const record = packId ? await database.getSyncRecord('pack', packId) : null
  return record ? { ...binding, packSyncId: record.syncId } : binding
}

/**
 * Service for local network sync functionality
 */
class SyncService {
  /**
   * Start the sync server
   * @returns Server info including QR code
   */
  async startServer(): Promise<SyncServerInfo> {
    return invoke('start_sync_server')
  }

  /**
   * Stop the sync server
   */
  async stopServer(): Promise<void> {
    return invoke('stop_sync_server')
  }

  /**
   * Get items that were pushed to this server
   */
  async getReceivedItems(): Promise<SyncReceivedItem[]> {
    return invoke('get_received_items')
  }

  /**
   * Clear received items after processing
   */
  async clearReceivedItems(): Promise<void> {
    return invoke('clear_received_items')
  }

  /**
   * Send one request to a remote sync server
   * @returns The remote webview's reply
   */
  async request(
    connection: SyncConnectionData,
    peer: SyncPeer,
    action: SyncAction,
  ): Promise<string> {
    return invoke('sync_request', {
      ip: connection.ip,
      port: connection.port,
      token: connection.token,
      peer,
      action,
    })
  }

  /**
   * Answer a request forwarded by this device's server
   */
  async respond(requestId: string, answer: { data?: string; error?: string }): Promise<void> {
    return invoke('sync_respond', { requestId, ...answer })
  }

  /**
   * Export a story to JSON string in Aventura format.
   *
   * The pack section comes from the `.avt` exporter's own `gatherPackBinding`, so the two agree
   * on what a binding is by construction. The surrounding payload is still assembled here rather
   * than through `gatherStoryData`.
   *
   * TECH DEBT: that split means a field added to the format reaches `.avt` and not sync unless
   * both are edited, which is how the payload below came to stamp `1.7.0` and omit
   * `currentBgImage` — the `.avt` path has carried both since v1.8.0. Merging the two is the
   * fix and is out of scope here: sync loads image payloads inline, where the `.avt` path takes
   * metadata only and lets Rust stream the bytes into SQLite, so they cannot merge without
   * first deciding whether sync should stream natively too.
   */
  async exportStoryToJson(
    storyId: string,
    tracking: ExportTracking = NOT_VOUCHED,
  ): Promise<string> {
    // Get all story data from database
    const storyData = await database.getStory(storyId)
    if (!storyData) {
      throw new Error(`Story not found: ${storyId}`)
    }

    const [
      entries,
      characters,
      locations,
      items,
      storyBeats,
      lorebookEntries,
      embeddedImages,
      checkpoints,
      branches,
      chapters,
      packBinding,
      timeAnchors,
      storedRecords,
      worldStateMarks,
    ] = await Promise.all([
      database.getStoryEntries(storyId),
      database.getCharacters(storyId),
      database.getLocations(storyId),
      database.getItems(storyId),
      database.getStoryBeats(storyId),
      database.getEntries(storyId),
      database.getEmbeddedImagesForStory(storyId),
      database.getCheckpointRecords(storyId),
      database.getBranches(storyId),
      database.getChapters(storyId),
      gatherPackBinding(storyId),
      database.getTimeAnchors(storyId),
      database.getWorldStateRecordsForStory(storyId),
      database.getWorldStateMarksForStory(storyId).then(marksForExport),
    ])

    const worldStateRecords = recordsForExport(storedRecords, tracking, Date.now(), worldStateMarks)
    const exportData: AventuraExport = {
      // Left at 1.7.0 on purpose. The receiving importer is shape-driven — it reads whichever
      // sections are present and never compares this number — so `packBinding` below is honoured
      // regardless. Correcting the stamp belongs with the wider fix noted on this method, not
      // here, where it would only change what gets logged.
      version: '1.7.0',
      exportedAt: Date.now(),
      story: storyData,
      entries,
      characters,
      locations,
      items,
      storyBeats,
      lorebookEntries,
      styleReviewState: storyData.styleReviewState,
      embeddedImages,
      checkpoints,
      branches,
      chapters,
      // Omitted when empty, as `exportToAventura` does.
      ...(timeAnchors.length > 0 ? { timeAnchors } : {}),
      ...(worldStateRecords.length > 0 ? { worldStateRecords } : {}),
      // Always written, empty included: import reads an absent field as a file from before marks.
      worldStateMarks,
      // Omitted rather than written as null, so a story with no pack keeps the shape that takes
      // the legacy import path — matching what `exportToAventura` produces.
      ...(packBinding ? { packBinding: await withPackSyncId(storyId, packBinding) } : {}),
    }

    return JSON.stringify(exportData)
  }

  /**
   * Parse QR code data
   */
  parseQrCode(data: string): SyncConnectionData {
    const connection = parseConnectionData(data)
    if (!connection) throw new Error('Invalid QR code data')
    return connection
  }

  /**
   * Delete a story by ID
   */
  async deleteStory(storyId: string): Promise<void> {
    await database.deleteStory(storyId)
  }
}

export const syncService = new SyncService()
