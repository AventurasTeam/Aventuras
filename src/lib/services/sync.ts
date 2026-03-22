import { invoke } from '@tauri-apps/api/core'
import type { SyncServerInfo, SyncStoryPreview, SyncConnectionData } from '$lib/types/sync'
import type { AventuraExport } from './export'
import { database } from './database'
import { story } from '$lib/stores/story/index.svelte'

/**
 * Service for local network sync functionality
 */
class SyncService {
  /**
   * Start the sync server with all local stories available
   * @param storiesJson Array of story JSON strings in Aventura export format
   * @returns Server info including QR code
   */
  async startServer(storiesJson: string[]): Promise<SyncServerInfo> {
    return invoke('start_sync_server', { storiesJson })
  }

  /**
   * Stop the sync server
   */
  async stopServer(): Promise<void> {
    return invoke('stop_sync_server')
  }

  /**
   * Get stories that were pushed to this server
   */
  async getReceivedStories(): Promise<string[]> {
    return invoke('get_received_stories')
  }

  /**
   * Clear received stories after processing
   */
  async clearReceivedStories(): Promise<void> {
    return invoke('clear_received_stories')
  }

  /**
   * Connect to a remote sync server and list available stories
   */
  async connect(connection: SyncConnectionData): Promise<SyncStoryPreview[]> {
    return invoke('sync_connect', {
      ip: connection.ip,
      port: connection.port,
      token: connection.token,
    })
  }

  /**
   * Pull a story from a remote server
   * @returns Story JSON in Aventura export format
   */
  async pullStory(connection: SyncConnectionData, storyId: string): Promise<string> {
    return invoke('sync_pull_story', {
      ip: connection.ip,
      port: connection.port,
      token: connection.token,
      storyId,
    })
  }

  /**
   * Push a story to a remote server
   */
  async pushStory(connection: SyncConnectionData, storyJson: string): Promise<void> {
    return invoke('sync_push_story', {
      ip: connection.ip,
      port: connection.port,
      token: connection.token,
      storyJson,
    })
  }

  /**
   * Create a pre-sync backup checkpoint for a story
   */
  async createPreSyncBackup(storyId: string): Promise<void> {
    // Load the story if not already loaded
    if (story.id !== storyId) {
      await story.loadStory(storyId)
    }
    // Create a checkpoint named "Pre-sync backup"
    await story.checkpoint.createCheckpoint('Pre-sync backup')
  }

  /**
   * Export a story to JSON string in Aventura format
   */
  async exportStoryToJson(storyId: string): Promise<string> {
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
    ] = await Promise.all([
      database.getStoryEntries(storyId),
      database.getCharacters(storyId),
      database.getLocations(storyId),
      database.getItems(storyId),
      database.getStoryBeats(storyId),
      database.getEntries(storyId),
      database.getEmbeddedImagesForStory(storyId),
      database.getCheckpoints(storyId),
      database.getBranches(storyId),
      database.getChapters(storyId),
    ])

    const exportData: AventuraExport = {
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
    }

    return JSON.stringify(exportData)
  }

  /**
   * Export all stories to JSON strings
   */
  async exportAllStoriesToJson(): Promise<string[]> {
    const allStories = await database.getAllStories()
    const exports: string[] = []

    for (const s of allStories) {
      try {
        const json = await this.exportStoryToJson(s.id)
        exports.push(json)
      } catch (e) {
        console.error(`Failed to export story ${s.id}:`, e)
      }
    }

    return exports
  }

  /**
   * Parse QR code data
   */
  parseQrCode(data: string): SyncConnectionData {
    try {
      const parsed = JSON.parse(data)
      if (!parsed.ip || !parsed.port || !parsed.token) {
        throw new Error('Missing required fields')
      }
      return {
        ip: parsed.ip,
        port: parsed.port,
        token: parsed.token,
        version: parsed.version, // May be undefined for older QR codes
      }
    } catch {
      throw new Error('Invalid QR code data')
    }
  }

  /**
   * Check if a story with the given title already exists locally
   */
  async checkStoryExists(title: string): Promise<boolean> {
    const allStories = await database.getAllStories()
    return allStories.some((s) => s.title === title)
  }

  /**
   * Find story ID by title (for replacement)
   */
  async findStoryIdByTitle(title: string): Promise<string | null> {
    const allStories = await database.getAllStories()
    const found = allStories.find((s) => s.title === title)
    return found?.id ?? null
  }

  /**
   * Delete a story by ID
   */
  async deleteStory(storyId: string): Promise<void> {
    await database.deleteStory(storyId)
  }

  /**
   * Get story preview from JSON string
   */
  getStoryPreview(json: string): SyncStoryPreview | null {
    try {
      const data: AventuraExport = JSON.parse(json)
      return {
        id: data.story.id,
        title: data.story.title,
        genre: data.story.genre ?? null,
        updatedAt: data.story.updatedAt,
        entryCount: data.entries.length,
      }
    } catch {
      return null
    }
  }
}

export const syncService = new SyncService()
