import Database from '@tauri-apps/plugin-sql'
import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  Checkpoint,
  Branch,
  Entry,
  EntryType,
  EntryPreview,
  PersistentRetryState,
  PersistentStyleReviewState,
  TimeTracker,
  EmbeddedImage,
  EmbeddedImageStatus,
  VaultCharacter,
  VaultLorebook,
  VaultScenario,
  VaultTag,
  VaultType,
  VaultConversation,
  VisualDescriptors,
  WorldStateSnapshot,
} from '$lib/types'
import type {
  PresetPack,
  PackTemplate,
  CustomVariable,
  RuntimeVariable,
  RuntimeVariableType,
  RuntimeEntityType,
  EnumOption,
} from '$lib/services/packs/types'
import { hashContent } from '$lib/services/packs/hash'

/**
 * Migrate visual descriptors from old string array format to new structured object format.
 * Handles both old format (string[]) and new format (VisualDescriptors object).
 */
function migrateVisualDescriptors(data: unknown): VisualDescriptors {
  // Already new format (object with known keys)
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    // Check if it has any of our expected keys
    if (
      'face' in obj ||
      'hair' in obj ||
      'eyes' in obj ||
      'build' in obj ||
      'clothing' in obj ||
      'accessories' in obj ||
      'distinguishing' in obj
    ) {
      return data as VisualDescriptors
    }
  }

  // Old format: string array like ["Face: pale skin", "Hair: long brown"]
  if (Array.isArray(data)) {
    const result: VisualDescriptors = {}
    const categoryMap: Record<string, keyof VisualDescriptors> = {
      face: 'face',
      skin: 'face',
      hair: 'hair',
      eyes: 'eyes',
      eye: 'eyes',
      build: 'build',
      height: 'build',
      body: 'build',
      physique: 'build',
      clothing: 'clothing',
      clothes: 'clothing',
      outfit: 'clothing',
      attire: 'clothing',
      accessories: 'accessories',
      accessory: 'accessories',
      distinguishing: 'distinguishing',
      scar: 'distinguishing',
      scars: 'distinguishing',
      marks: 'distinguishing',
      mark: 'distinguishing',
      tattoo: 'distinguishing',
    }

    for (const desc of data) {
      if (typeof desc !== 'string') continue

      // Try to match "Category: value" pattern
      const match = desc.match(/^([A-Za-z\s]+):\s*(.+)$/)
      if (match) {
        const [, category, value] = match
        const key = categoryMap[category.toLowerCase().trim()] || 'distinguishing'
        // Append to existing value if key already exists
        if (result[key]) {
          result[key] = `${result[key]}, ${value.trim()}`
        } else {
          result[key] = value.trim()
        }
      }
    }

    return result
  }

  // Empty or unknown format
  return {}
}

class DatabaseService {
  private db: Database | null = null

  async init(): Promise<void> {
    if (this.db) return
    this.db = await Database.load('sqlite:aventura.db')
    // Enable foreign key enforcement (SQLite disables by default)
    await this.db.execute('PRAGMA foreign_keys = ON')
  }

  /**
   * Close the database connection. After calling this, the next
   * getDb() / init() call will re-open the connection.
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.db = null
    }
  }

  private async getDb(): Promise<Database> {
    if (!this.db) {
      await this.init()
    }
    return this.db!
  }

  /**
   * Run a callback inside a BEGIN/COMMIT transaction.
   * Automatically rolls back on error.
   */
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = await this.getDb()
    await db.execute('BEGIN')
    try {
      const result = await fn()
      await db.execute('COMMIT')
      return result
    } catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  }

  /**
   * Execute a raw SQL query for debugging purposes.
   * SELECT queries return rows; other queries return affected row count.
   */
  async rawQuery(
    sql: string,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowsAffected?: number }> {
    const db = await this.getDb()
    const trimmed = sql.trim().toUpperCase()
    if (
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('PRAGMA') ||
      trimmed.startsWith('EXPLAIN')
    ) {
      const rows = await db.select<Record<string, unknown>[]>(sql)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { columns, rows }
    } else {
      const result = await db.execute(sql)
      return {
        columns: ['rowsAffected'],
        rows: [{ rowsAffected: result.rowsAffected }],
        rowsAffected: result.rowsAffected,
      }
    }
  }

  // Settings operations
  async getSetting(key: string): Promise<string | null> {
    const db = await this.getDb()
    const result = await db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = ?',
      [key],
    )
    return result.length > 0 ? result[0].value : null
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  }

  async deleteSetting(key: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM settings WHERE key = ?', [key])
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const db = await this.getDb()
    const results = await db.select<{ key: string; value: string }[]>(
      'SELECT key, value FROM settings',
    )
    const settings: Record<string, string> = {}
    for (const row of results) {
      settings[row.key] = row.value
    }
    return settings
  }

  async vacuumInto(destPath: string): Promise<void> {
    const db = await this.getDb()
    // VACUUM INTO doesn't support parameterized queries in most SQLite wrappers.
    // Escape single quotes in the path to prevent SQL issues.
    const escapedPath = destPath.replace(/'/g, "''")
    await db.execute(`VACUUM INTO '${escapedPath}'`)
  }

  // Story operations
  async getAllStories(): Promise<Story[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM stories ORDER BY updated_at DESC')
    return results.map(this.mapStory)
  }

  async getStory(id: string): Promise<Story | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM stories WHERE id = ?', [id])
    return results.length > 0 ? this.mapStory(results[0]) : null
  }

  async createStory(story: Omit<Story, 'createdAt' | 'updatedAt'>): Promise<Story> {
    const db = await this.getDb()
    const now = Date.now()
    await db.execute(
      `INSERT INTO stories (
        id,
        title,
        description,
        genre,
        template_id,
        mode,
        created_at,
        updated_at,
        settings,
        memory_config,
        retry_state,
        style_review_state,
        time_tracker
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        story.id,
        story.title,
        story.description,
        story.genre,
        story.templateId,
        story.mode || 'adventure',
        now,
        now,
        story.settings ? JSON.stringify(story.settings) : null,
        story.memoryConfig ? JSON.stringify(story.memoryConfig) : null,
        story.retryState ? JSON.stringify(story.retryState) : null,
        story.styleReviewState ? JSON.stringify(story.styleReviewState) : null,
        story.timeTracker ? JSON.stringify(story.timeTracker) : null,
      ],
    )
    return { ...story, createdAt: now, updatedAt: now }
  }

  async updateStory(id: string, updates: Partial<Story>): Promise<void> {
    const db = await this.getDb()
    const now = Date.now()
    const setClauses: string[] = ['updated_at = ?']
    const values: any[] = [now]

    if (updates.title !== undefined) {
      setClauses.push('title = ?')
      values.push(updates.title)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.genre !== undefined) {
      setClauses.push('genre = ?')
      values.push(updates.genre)
    }
    if (updates.mode !== undefined) {
      setClauses.push('mode = ?')
      values.push(updates.mode)
    }
    if (updates.settings !== undefined) {
      setClauses.push('settings = ?')
      values.push(JSON.stringify(updates.settings))
    }
    if (updates.memoryConfig !== undefined) {
      setClauses.push('memory_config = ?')
      values.push(updates.memoryConfig ? JSON.stringify(updates.memoryConfig) : null)
    }
    if (updates.retryState !== undefined) {
      setClauses.push('retry_state = ?')
      values.push(updates.retryState ? JSON.stringify(updates.retryState) : null)
    }
    if (updates.styleReviewState !== undefined) {
      setClauses.push('style_review_state = ?')
      values.push(updates.styleReviewState ? JSON.stringify(updates.styleReviewState) : null)
    }
    if (updates.timeTracker !== undefined) {
      setClauses.push('time_tracker = ?')
      values.push(updates.timeTracker ? JSON.stringify(updates.timeTracker) : null)
    }
    if (updates.currentBgImage !== undefined) {
      setClauses.push('current_background_image = ?')
      values.push(updates.currentBgImage)
    }

    values.push(id)
    await db.execute(`UPDATE stories SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  /**
   * Save retry state for a story.
   */
  async saveRetryState(storyId: string, retryState: PersistentRetryState): Promise<void> {
    const db = await this.getDb()
    console.log('[Database] Saving retry state', {
      storyId,
      hasCharacterSnapshots: !!retryState.characterSnapshots,
      characterSnapshotsCount: retryState.characterSnapshots?.length ?? 0,
      characterSnapshots: retryState.characterSnapshots?.map((s) => ({
        id: s.id,
        visualDescriptors: s.visualDescriptors,
        traits: s.traits,
      })),
    })
    await db.execute('UPDATE stories SET retry_state = ? WHERE id = ?', [
      JSON.stringify(retryState),
      storyId,
    ])
  }

  /**
   * Clear retry state for a story.
   */
  async clearRetryState(storyId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET retry_state = NULL WHERE id = ?', [storyId])
  }

  /**
   * Save style review state for a story.
   */
  async saveStyleReviewState(
    storyId: string,
    styleReviewState: PersistentStyleReviewState,
  ): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET style_review_state = ? WHERE id = ?', [
      JSON.stringify(styleReviewState),
      storyId,
    ])
  }

  /**
   * Clear style review state for a story.
   */
  async clearStyleReviewState(storyId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET style_review_state = NULL WHERE id = ?', [storyId])
  }

  /**
   * Save time tracker for a story.
   */
  async saveTimeTracker(storyId: string, timeTracker: TimeTracker): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET time_tracker = ? WHERE id = ?', [
      JSON.stringify(timeTracker),
      storyId,
    ])
  }

  /**
   * Clear time tracker for a story.
   */
  async clearTimeTracker(storyId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET time_tracker = NULL WHERE id = ?', [storyId])
  }

  async deleteStory(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM stories WHERE id = ?', [id])
  }

  // Story entries operations
  async getStoryEntries(
    storyId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<StoryEntry[]> {
    const db = await this.getDb()
    let query = 'SELECT * FROM story_entries WHERE story_id = ? ORDER BY position ASC'
    const params: any[] = [storyId]

    if (options?.limit !== undefined) {
      query += ' LIMIT ?'
      params.push(options.limit)
      if (options?.offset !== undefined) {
        query += ' OFFSET ?'
        params.push(options.offset)
      }
    }

    const results = await db.select<any[]>(query, params)
    return results.map(this.mapStoryEntry)
  }

  /**
   * Get story entries filtered by branch.
   * @param storyId - The story ID
   * @param branchId - The branch ID (null for main branch entries)
   * @param maxPosition - Optional max position (inclusive) for inherited entries
   */
  async getStoryEntriesForBranch(
    storyId: string,
    branchId: string | null,
    maxPosition?: number,
  ): Promise<StoryEntry[]> {
    const db = await this.getDb()

    let query: string
    let params: any[]

    if (branchId === null) {
      // Main branch: entries with null branch_id
      if (maxPosition !== undefined) {
        // Limit to entries up to a certain position (for inherited entries)
        query =
          'SELECT * FROM story_entries WHERE story_id = ? AND branch_id IS NULL AND position <= ? ORDER BY position ASC'
        params = [storyId, maxPosition]
      } else {
        query =
          'SELECT * FROM story_entries WHERE story_id = ? AND branch_id IS NULL ORDER BY position ASC'
        params = [storyId]
      }
    } else {
      // Specific branch
      if (maxPosition !== undefined) {
        query =
          'SELECT * FROM story_entries WHERE story_id = ? AND branch_id = ? AND position <= ? ORDER BY position ASC'
        params = [storyId, branchId, maxPosition]
      } else {
        query =
          'SELECT * FROM story_entries WHERE story_id = ? AND branch_id = ? ORDER BY position ASC'
        params = [storyId, branchId]
      }
    }

    const results = await db.select<any[]>(query, params)
    return results.map(this.mapStoryEntry)
  }

  async getStoryEntry(id: string): Promise<StoryEntry | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM story_entries WHERE id = ?', [id])
    return results.length > 0 ? this.mapStoryEntry(results[0]) : null
  }

  /**
   * Get the count of story entries without loading them all.
   * Useful for UI display and pagination calculations.
   */
  async getStoryEntryCount(storyId: string): Promise<number> {
    const db = await this.getDb()
    const result = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM story_entries WHERE story_id = ?',
      [storyId],
    )
    return result[0]?.count ?? 0
  }

  /**
   * Get the most recent story entries (for UI rendering).
   * More efficient than loading all entries for large stories.
   */
  async getRecentStoryEntries(storyId: string, count: number): Promise<StoryEntry[]> {
    const db = await this.getDb()
    // Get the last N entries by position
    const results = await db.select<any[]>(
      `SELECT * FROM story_entries WHERE story_id = ?
       ORDER BY position DESC LIMIT ?`,
      [storyId, count],
    )
    // Reverse to get correct chronological order
    return results.map(this.mapStoryEntry).reverse()
  }

  async addStoryEntry(entry: Omit<StoryEntry, 'createdAt'>): Promise<StoryEntry> {
    const db = await this.getDb()
    const now = Date.now()
    await db.execute(
      `INSERT INTO story_entries (id, story_id, type, content, parent_id, position, created_at, metadata, branch_id, reasoning, translated_content, translation_language, original_input, world_state_delta, suggested_actions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.storyId,
        entry.type,
        entry.content,
        entry.parentId,
        entry.position,
        now,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.branchId || null,
        entry.reasoning || null,
        entry.translatedContent || null,
        entry.translationLanguage || null,
        entry.originalInput || null,
        entry.worldStateDelta ? JSON.stringify(entry.worldStateDelta) : null,
        entry.suggestedActions || null,
      ],
    )
    return { ...entry, createdAt: now }
  }

  async getNextEntryPosition(storyId: string, branchId?: string | null): Promise<number> {
    const db = await this.getDb()

    if (branchId === undefined || branchId === null) {
      // Main branch: max position of null branch_id entries
      const result = await db.select<{ maxPos: number | null }[]>(
        'SELECT MAX(position) as maxPos FROM story_entries WHERE story_id = ? AND branch_id IS NULL',
        [storyId],
      )
      return (result[0]?.maxPos ?? -1) + 1
    } else {
      // Non-main branch: max position of branch-specific entries
      const result = await db.select<{ maxPos: number | null }[]>(
        'SELECT MAX(position) as maxPos FROM story_entries WHERE story_id = ? AND branch_id = ?',
        [storyId, branchId],
      )

      if (result[0]?.maxPos !== null) {
        return result[0].maxPos + 1
      }

      // No branch-specific entries yet - get the fork position from branch record
      const branchResult = await db.select<{ fork_entry_id: string }[]>(
        'SELECT fork_entry_id FROM branches WHERE id = ?',
        [branchId],
      )

      if (branchResult.length > 0) {
        const forkEntryResult = await db.select<{ position: number }[]>(
          'SELECT position FROM story_entries WHERE id = ?',
          [branchResult[0].fork_entry_id],
        )
        if (forkEntryResult.length > 0) {
          // Start branch entries right after the fork point
          return forkEntryResult[0].position + 1
        }
        // Fork entry was deleted - this indicates database corruption
        console.error(
          `[DatabaseService] Branch ${branchId} references missing fork entry: ${branchResult[0].fork_entry_id}`,
        )
        throw new Error(`Branch fork entry not found. The branch may be corrupted.`)
      }

      // Branch record not found
      console.error(`[DatabaseService] Branch not found: ${branchId}`)
      throw new Error(`Branch not found: ${branchId}`)
    }
  }

  async updateStoryEntry(id: string, updates: Partial<StoryEntry>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.content !== undefined) {
      setClauses.push('content = ?')
      values.push(updates.content)
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?')
      values.push(updates.type)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null)
    }
    if (updates.reasoning !== undefined) {
      setClauses.push('reasoning = ?')
      values.push(updates.reasoning || null)
    }
    // Translation fields
    if (updates.translatedContent !== undefined) {
      setClauses.push('translated_content = ?')
      values.push(updates.translatedContent || null)
    }
    if (updates.translationLanguage !== undefined) {
      setClauses.push('translation_language = ?')
      values.push(updates.translationLanguage || null)
    }
    if (updates.originalInput !== undefined) {
      setClauses.push('original_input = ?')
      values.push(updates.originalInput || null)
    }
    if (updates.worldStateDelta !== undefined) {
      setClauses.push('world_state_delta = ?')
      values.push(updates.worldStateDelta ? JSON.stringify(updates.worldStateDelta) : null)
    }
    if (updates.suggestedActions !== undefined) {
      setClauses.push('suggested_actions = ?')
      values.push(updates.suggestedActions || null)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE story_entries SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteStoryEntry(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM story_entries WHERE id = ?', [id])
  }

  /**
   * Delete multiple story entries by ID.
   */
  async deleteStoryEntries(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const db = await this.getDb()
    const placeholders = ids.map(() => '?').join(',')
    await db.execute(`DELETE FROM story_entries WHERE id IN (${placeholders})`, ids)
  }

  // Character operations
  async getCharacters(storyId: string): Promise<Character[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM characters WHERE story_id = ?', [storyId])
    return results.map(this.mapCharacter)
  }

  /**
   * Get characters filtered by branch.
   * Each branch has its own complete copy of world state, so we only return exact matches.
   */
  async getCharactersForBranch(storyId: string, branchId: string | null): Promise<Character[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM characters WHERE story_id = ? AND branch_id IS NULL'
        : 'SELECT * FROM characters WHERE story_id = ? AND branch_id = ?',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapCharacter)
  }

  async addCharacter(character: Character): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO characters (id, story_id, name, description, relationship, traits, visual_descriptors, portrait, status, metadata, branch_id, overrides_id, translated_name, translated_description, translated_relationship, translated_traits, translated_visual_descriptors, translation_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        character.id,
        character.storyId,
        character.name,
        character.description,
        character.relationship,
        JSON.stringify(character.traits),
        JSON.stringify(character.visualDescriptors || {}),
        character.portrait || null,
        character.status,
        character.metadata ? JSON.stringify(character.metadata) : null,
        character.branchId || null,
        character.overridesId || null,
        character.translatedName || null,
        character.translatedDescription || null,
        character.translatedRelationship || null,
        character.translatedTraits ? JSON.stringify(character.translatedTraits) : null,
        character.translatedVisualDescriptors
          ? JSON.stringify(character.translatedVisualDescriptors)
          : null,
        character.translationLanguage || null,
      ],
    )
  }

  async updateCharacter(id: string, updates: Partial<Character>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.relationship !== undefined) {
      setClauses.push('relationship = ?')
      values.push(updates.relationship)
    }
    if (updates.traits !== undefined) {
      setClauses.push('traits = ?')
      values.push(JSON.stringify(updates.traits))
    }
    if (updates.visualDescriptors !== undefined) {
      setClauses.push('visual_descriptors = ?')
      values.push(JSON.stringify(updates.visualDescriptors))
    }
    if (updates.portrait !== undefined) {
      setClauses.push('portrait = ?')
      values.push(updates.portrait)
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      values.push(updates.status)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(JSON.stringify(updates.metadata))
    }
    // Translation fields
    if (updates.translatedName !== undefined) {
      setClauses.push('translated_name = ?')
      values.push(updates.translatedName || null)
    }
    if (updates.translatedDescription !== undefined) {
      setClauses.push('translated_description = ?')
      values.push(updates.translatedDescription || null)
    }
    if (updates.translatedRelationship !== undefined) {
      setClauses.push('translated_relationship = ?')
      values.push(updates.translatedRelationship || null)
    }
    if (updates.translatedTraits !== undefined) {
      setClauses.push('translated_traits = ?')
      values.push(updates.translatedTraits ? JSON.stringify(updates.translatedTraits) : null)
    }
    if (updates.translatedVisualDescriptors !== undefined) {
      setClauses.push('translated_visual_descriptors = ?')
      values.push(
        updates.translatedVisualDescriptors
          ? JSON.stringify(updates.translatedVisualDescriptors)
          : null,
      )
    }
    if (updates.translationLanguage !== undefined) {
      setClauses.push('translation_language = ?')
      values.push(updates.translationLanguage || null)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE characters SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteCharacter(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM characters WHERE id = ?', [id])
  }

  // Location operations
  async getLocations(storyId: string): Promise<Location[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM locations WHERE story_id = ?', [storyId])
    return results.map(this.mapLocation)
  }

  /**
   * Get locations filtered by branch.
   * Each branch has its own complete copy of world state, so we only return exact matches.
   */
  async getLocationsForBranch(storyId: string, branchId: string | null): Promise<Location[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM locations WHERE story_id = ? AND branch_id IS NULL'
        : 'SELECT * FROM locations WHERE story_id = ? AND branch_id = ?',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapLocation)
  }

  async addLocation(location: Location): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO locations (id, story_id, name, description, visited, current, connections, metadata, branch_id, overrides_id, translated_name, translated_description, translation_language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        location.id,
        location.storyId,
        location.name,
        location.description,
        location.visited ? 1 : 0,
        location.current ? 1 : 0,
        JSON.stringify(location.connections),
        location.metadata ? JSON.stringify(location.metadata) : null,
        location.branchId || null,
        location.overridesId || null,
        location.translatedName || null,
        location.translatedDescription || null,
        location.translationLanguage || null,
      ],
    )
  }

  async setCurrentLocation(storyId: string, locationId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE locations SET current = 0 WHERE story_id = ?', [storyId])
    await db.execute('UPDATE locations SET current = 1, visited = 1 WHERE id = ?', [locationId])
  }

  async updateLocation(id: string, updates: Partial<Location>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.visited !== undefined) {
      setClauses.push('visited = ?')
      values.push(updates.visited ? 1 : 0)
    }
    if (updates.current !== undefined) {
      setClauses.push('current = ?')
      values.push(updates.current ? 1 : 0)
    }
    if (updates.connections !== undefined) {
      setClauses.push('connections = ?')
      values.push(JSON.stringify(updates.connections))
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(JSON.stringify(updates.metadata))
    }
    // Translation fields
    if (updates.translatedName !== undefined) {
      setClauses.push('translated_name = ?')
      values.push(updates.translatedName || null)
    }
    if (updates.translatedDescription !== undefined) {
      setClauses.push('translated_description = ?')
      values.push(updates.translatedDescription || null)
    }
    if (updates.translationLanguage !== undefined) {
      setClauses.push('translation_language = ?')
      values.push(updates.translationLanguage || null)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE locations SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteLocation(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM locations WHERE id = ?', [id])
  }

  // Item operations
  async getItems(storyId: string): Promise<Item[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM items WHERE story_id = ?', [storyId])
    return results.map(this.mapItem)
  }

  /**
   * Get items filtered by branch.
   * Each branch has its own complete copy of world state, so we only return exact matches.
   */
  async getItemsForBranch(storyId: string, branchId: string | null): Promise<Item[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM items WHERE story_id = ? AND branch_id IS NULL'
        : 'SELECT * FROM items WHERE story_id = ? AND branch_id = ?',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapItem)
  }

  async addItem(item: Item): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO items (id, story_id, name, description, quantity, equipped, location, metadata, branch_id, overrides_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.id,
        item.storyId,
        item.name,
        item.description,
        item.quantity,
        item.equipped ? 1 : 0,
        item.location,
        item.metadata ? JSON.stringify(item.metadata) : null,
        item.branchId || null,
        item.overridesId || null,
      ],
    )
  }

  async updateItem(id: string, updates: Partial<Item>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.quantity !== undefined) {
      setClauses.push('quantity = ?')
      values.push(updates.quantity)
    }
    if (updates.equipped !== undefined) {
      setClauses.push('equipped = ?')
      values.push(updates.equipped ? 1 : 0)
    }
    if (updates.location !== undefined) {
      setClauses.push('location = ?')
      values.push(updates.location)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(JSON.stringify(updates.metadata))
    }
    // Translation fields
    if (updates.translatedName !== undefined) {
      setClauses.push('translated_name = ?')
      values.push(updates.translatedName || null)
    }
    if (updates.translatedDescription !== undefined) {
      setClauses.push('translated_description = ?')
      values.push(updates.translatedDescription || null)
    }
    if (updates.translationLanguage !== undefined) {
      setClauses.push('translation_language = ?')
      values.push(updates.translationLanguage || null)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE items SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteItem(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM items WHERE id = ?', [id])
  }

  async updateStoryBeat(id: string, updates: Partial<StoryBeat>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.title !== undefined) {
      setClauses.push('title = ?')
      values.push(updates.title)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?')
      values.push(updates.type)
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      values.push(updates.status)
    }
    if (updates.triggeredAt !== undefined) {
      setClauses.push('triggered_at = ?')
      values.push(updates.triggeredAt)
    }
    if (updates.resolvedAt !== undefined) {
      setClauses.push('resolved_at = ?')
      values.push(updates.resolvedAt)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(JSON.stringify(updates.metadata))
    }
    // Translation fields
    if (updates.translatedTitle !== undefined) {
      setClauses.push('translated_title = ?')
      values.push(updates.translatedTitle || null)
    }
    if (updates.translatedDescription !== undefined) {
      setClauses.push('translated_description = ?')
      values.push(updates.translatedDescription || null)
    }
    if (updates.translationLanguage !== undefined) {
      setClauses.push('translation_language = ?')
      values.push(updates.translationLanguage || null)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE story_beats SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  // Story beats operations
  async getStoryBeats(storyId: string): Promise<StoryBeat[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM story_beats WHERE story_id = ?', [
      storyId,
    ])
    return results.map(this.mapStoryBeat)
  }

  /**
   * Get story beats filtered by branch.
   * Each branch has its own complete copy of world state, so we only return exact matches.
   */
  async getStoryBeatsForBranch(storyId: string, branchId: string | null): Promise<StoryBeat[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM story_beats WHERE story_id = ? AND branch_id IS NULL'
        : 'SELECT * FROM story_beats WHERE story_id = ? AND branch_id = ?',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapStoryBeat)
  }

  async addStoryBeat(beat: StoryBeat): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO story_beats (id, story_id, title, description, type, status, triggered_at, resolved_at, metadata, branch_id, overrides_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        beat.id,
        beat.storyId,
        beat.title,
        beat.description,
        beat.type,
        beat.status,
        beat.triggeredAt,
        beat.resolvedAt ?? null,
        beat.metadata ? JSON.stringify(beat.metadata) : null,
        beat.branchId || null,
        beat.overridesId || null,
      ],
    )
  }

  async deleteStoryBeat(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM story_beats WHERE id = ?', [id])
  }

  // Chapter operations
  async getChapters(storyId: string): Promise<Chapter[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM chapters WHERE story_id = ? ORDER BY number ASC',
      [storyId],
    )
    return results.map(this.mapChapter)
  }

  /**
   * Get chapters filtered by branch.
   * @param storyId - The story ID
   * @param branchId - The branch ID (null for main branch chapters)
   */
  async getChaptersForBranch(storyId: string, branchId: string | null): Promise<Chapter[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM chapters WHERE story_id = ? AND branch_id IS NULL ORDER BY number ASC'
        : 'SELECT * FROM chapters WHERE story_id = ? AND branch_id = ? ORDER BY number ASC',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapChapter)
  }

  async getChapter(id: string): Promise<Chapter | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM chapters WHERE id = ?', [id])
    return results.length > 0 ? this.mapChapter(results[0]) : null
  }

  async getNextChapterNumber(storyId: string): Promise<number> {
    const db = await this.getDb()
    const result = await db.select<{ maxNum: number | null }[]>(
      'SELECT MAX(number) as maxNum FROM chapters WHERE story_id = ?',
      [storyId],
    )
    return (result[0]?.maxNum ?? 0) + 1
  }

  async addChapter(chapter: Chapter): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO chapters (
        id, story_id, number, title, start_entry_id, end_entry_id, entry_count,
        summary, start_time, end_time, keywords, characters, locations, plot_threads, emotional_tone,
        branch_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        chapter.id,
        chapter.storyId,
        chapter.number,
        chapter.title,
        chapter.startEntryId,
        chapter.endEntryId,
        chapter.entryCount,
        chapter.summary,
        chapter.startTime ? JSON.stringify(chapter.startTime) : null,
        chapter.endTime ? JSON.stringify(chapter.endTime) : null,
        JSON.stringify(chapter.keywords),
        JSON.stringify(chapter.characters),
        JSON.stringify(chapter.locations),
        JSON.stringify(chapter.plotThreads),
        chapter.emotionalTone,
        chapter.branchId || null,
        chapter.createdAt,
      ],
    )
  }

  async updateChapter(id: string, updates: Partial<Chapter>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.title !== undefined) {
      setClauses.push('title = ?')
      values.push(updates.title)
    }
    if (updates.summary !== undefined) {
      setClauses.push('summary = ?')
      values.push(updates.summary)
    }
    if (updates.startTime !== undefined) {
      setClauses.push('start_time = ?')
      values.push(updates.startTime ? JSON.stringify(updates.startTime) : null)
    }
    if (updates.endTime !== undefined) {
      setClauses.push('end_time = ?')
      values.push(updates.endTime ? JSON.stringify(updates.endTime) : null)
    }
    if (updates.keywords !== undefined) {
      setClauses.push('keywords = ?')
      values.push(JSON.stringify(updates.keywords))
    }
    if (updates.characters !== undefined) {
      setClauses.push('characters = ?')
      values.push(JSON.stringify(updates.characters))
    }
    if (updates.locations !== undefined) {
      setClauses.push('locations = ?')
      values.push(JSON.stringify(updates.locations))
    }
    if (updates.plotThreads !== undefined) {
      setClauses.push('plot_threads = ?')
      values.push(JSON.stringify(updates.plotThreads))
    }
    if (updates.emotionalTone !== undefined) {
      setClauses.push('emotional_tone = ?')
      values.push(updates.emotionalTone)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE chapters SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteChapter(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM chapters WHERE id = ?', [id])
  }

  // Checkpoint operations
  async getCheckpoints(storyId: string): Promise<Checkpoint[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM checkpoints WHERE story_id = ? ORDER BY created_at DESC',
      [storyId],
    )
    return results.map(this.mapCheckpoint)
  }

  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM checkpoints WHERE id = ?', [id])
    return results.length > 0 ? this.mapCheckpoint(results[0]) : null
  }

  async createCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO checkpoints (
        id, story_id, name, last_entry_id, last_entry_preview, entry_count,
        entries_snapshot, characters_snapshot, locations_snapshot,
        items_snapshot, story_beats_snapshot, chapters_snapshot, time_tracker_snapshot,
        lorebook_entries_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        checkpoint.id,
        checkpoint.storyId,
        checkpoint.name,
        checkpoint.lastEntryId,
        checkpoint.lastEntryPreview,
        checkpoint.entryCount,
        JSON.stringify(checkpoint.entriesSnapshot),
        JSON.stringify(checkpoint.charactersSnapshot),
        JSON.stringify(checkpoint.locationsSnapshot),
        JSON.stringify(checkpoint.itemsSnapshot),
        JSON.stringify(checkpoint.storyBeatsSnapshot),
        JSON.stringify(checkpoint.chaptersSnapshot),
        checkpoint.timeTrackerSnapshot ? JSON.stringify(checkpoint.timeTrackerSnapshot) : null,
        checkpoint.lorebookEntriesSnapshot
          ? JSON.stringify(checkpoint.lorebookEntriesSnapshot)
          : null,
        checkpoint.createdAt,
      ],
    )
  }

  async deleteCheckpoint(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM checkpoints WHERE id = ?', [id])
  }

  /**
   * @deprecated This method is no longer used. Checkpoint restoration has been
   * replaced with branching to prevent data loss issues. Use createBranchFromCheckpoint
   * in the story store instead.
   */
  async restoreCheckpoint(checkpoint: Checkpoint, branchId: string | null): Promise<void> {
    const db = await this.getDb()
    const storyId = checkpoint.storyId

    const branchClause = branchId === null ? 'branch_id IS NULL' : 'branch_id = ?'
    const branchParams = branchId === null ? [] : [branchId]

    // Delete current state
    await db.execute(`DELETE FROM story_entries WHERE story_id = ? AND ${branchClause}`, [
      storyId,
      ...branchParams,
    ])
    await db.execute(`DELETE FROM characters WHERE story_id = ? AND ${branchClause}`, [
      storyId,
      ...branchParams,
    ])
    await db.execute(`DELETE FROM locations WHERE story_id = ? AND ${branchClause}`, [
      storyId,
      ...branchParams,
    ])
    await db.execute(`DELETE FROM items WHERE story_id = ? AND ${branchClause}`, [
      storyId,
      ...branchParams,
    ])
    await db.execute(`DELETE FROM story_beats WHERE story_id = ? AND ${branchClause}`, [
      storyId,
      ...branchParams,
    ])
    await db.execute(`DELETE FROM chapters WHERE story_id = ? AND ${branchClause}`, [
      storyId,
      ...branchParams,
    ])
    // Also delete lorebook entries if we have a snapshot to restore
    if (checkpoint.lorebookEntriesSnapshot !== undefined) {
      await db.execute(`DELETE FROM entries WHERE story_id = ? AND ${branchClause}`, [
        storyId,
        ...branchParams,
      ])
    }

    const matchesBranch = (entryBranchId: string | null | undefined) =>
      (entryBranchId ?? null) === branchId

    // Restore entries
    for (const entry of checkpoint.entriesSnapshot.filter((e) => matchesBranch(e.branchId))) {
      await this.addStoryEntry(entry)
    }

    // Restore characters
    for (const character of checkpoint.charactersSnapshot.filter((c) =>
      matchesBranch(c.branchId),
    )) {
      await this.addCharacter(character)
    }

    // Restore locations
    for (const location of checkpoint.locationsSnapshot.filter((l) => matchesBranch(l.branchId))) {
      await this.addLocation(location)
    }

    // Restore items
    for (const item of checkpoint.itemsSnapshot.filter((i) => matchesBranch(i.branchId))) {
      await this.addItem(item)
    }

    // Restore story beats
    for (const beat of checkpoint.storyBeatsSnapshot.filter((b) => matchesBranch(b.branchId))) {
      await this.addStoryBeat(beat)
    }

    // Restore chapters
    for (const chapter of checkpoint.chaptersSnapshot.filter((ch) => matchesBranch(ch.branchId))) {
      await this.addChapter(chapter)
    }

    // Restore lorebook entries (if snapshot exists - for backwards compatibility)
    if (checkpoint.lorebookEntriesSnapshot) {
      for (const entry of checkpoint.lorebookEntriesSnapshot.filter((e) =>
        matchesBranch(e.branchId),
      )) {
        await this.addEntry(entry)
      }
    }
  }

  // ===== World State Snapshots (Phase 1) =====

  async createWorldStateSnapshot(snapshot: WorldStateSnapshot): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO world_state_snapshots (
        id, story_id, branch_id, entry_id, entry_position,
        characters_snapshot, locations_snapshot, items_snapshot,
        story_beats_snapshot, lorebook_entries_snapshot, time_tracker_snapshot,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        snapshot.id,
        snapshot.storyId,
        snapshot.branchId ?? null,
        snapshot.entryId,
        snapshot.entryPosition,
        JSON.stringify(snapshot.charactersSnapshot),
        JSON.stringify(snapshot.locationsSnapshot),
        JSON.stringify(snapshot.itemsSnapshot),
        JSON.stringify(snapshot.storyBeatsSnapshot),
        snapshot.lorebookEntriesSnapshot ? JSON.stringify(snapshot.lorebookEntriesSnapshot) : null,
        snapshot.timeTrackerSnapshot ? JSON.stringify(snapshot.timeTrackerSnapshot) : null,
        snapshot.createdAt,
      ],
    )
  }

  async getWorldStateSnapshots(
    storyId: string,
    branchId: string | null,
  ): Promise<WorldStateSnapshot[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM world_state_snapshots WHERE story_id = ? AND branch_id IS NULL ORDER BY entry_position ASC'
        : 'SELECT * FROM world_state_snapshots WHERE story_id = ? AND branch_id = ? ORDER BY entry_position ASC',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapWorldStateSnapshot)
  }

  async getLatestSnapshotBefore(
    storyId: string,
    branchId: string | null,
    position: number,
  ): Promise<WorldStateSnapshot | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM world_state_snapshots WHERE story_id = ? AND branch_id IS NULL AND entry_position <= ? ORDER BY entry_position DESC LIMIT 1'
        : 'SELECT * FROM world_state_snapshots WHERE story_id = ? AND branch_id = ? AND entry_position <= ? ORDER BY entry_position DESC LIMIT 1',
      branchId === null ? [storyId, position] : [storyId, branchId, position],
    )
    return results.length > 0 ? this.mapWorldStateSnapshot(results[0]) : null
  }

  async deleteWorldStateSnapshotsAfter(
    storyId: string,
    branchId: string | null,
    position: number,
  ): Promise<void> {
    const db = await this.getDb()
    if (branchId === null) {
      await db.execute(
        'DELETE FROM world_state_snapshots WHERE story_id = ? AND branch_id IS NULL AND entry_position > ?',
        [storyId, position],
      )
    } else {
      await db.execute(
        'DELETE FROM world_state_snapshots WHERE story_id = ? AND branch_id = ? AND entry_position > ?',
        [storyId, branchId, position],
      )
    }
  }

  async deleteWorldStateSnapshotsForBranch(branchId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM world_state_snapshots WHERE branch_id = ?', [branchId])
  }

  async deleteWorldStateSnapshotsForStory(storyId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM world_state_snapshots WHERE story_id = ?', [storyId])
  }

  /**
   * Restore story state from a retry backup.
   * Similar to restoreCheckpoint but designed for the "retry last message" feature.
   * Does NOT touch chapters or lorebook entries (those are more permanent).
   */
  async restoreRetryBackup(
    entryIdsToDelete: string[],
    storyId: string,
    branchId: string | null,
    characters: Character[],
    locations: Location[],
    items: Item[],
    storyBeats: StoryBeat[],
  ): Promise<void> {
    const db = await this.getDb()

    // Delete current state (except chapters and lorebook entries which are more permanent)
    // Note: embedded_images will be cascade-deleted when story_entries are deleted
    if (entryIdsToDelete.length > 0) {
      await this.deleteStoryEntries(entryIdsToDelete)
    }
    // Branch-aware delete: only remove world state for the current branch
    const branchFilter = branchId === null ? 'AND branch_id IS NULL' : 'AND branch_id = ?'
    const branchParams = branchId === null ? [storyId] : [storyId, branchId]
    await db.execute(`DELETE FROM characters WHERE story_id = ? ${branchFilter}`, branchParams)
    await db.execute(`DELETE FROM locations WHERE story_id = ? ${branchFilter}`, branchParams)
    await db.execute(`DELETE FROM items WHERE story_id = ? ${branchFilter}`, branchParams)
    await db.execute(`DELETE FROM story_beats WHERE story_id = ? ${branchFilter}`, branchParams)

    // Restore entries not necessary as we are only deleting redundant entries since backup

    // Restore characters
    for (const character of characters) {
      await this.addCharacter(character)
    }

    // Restore locations
    for (const location of locations) {
      await this.addLocation(location)
    }

    // Restore items
    for (const item of items) {
      await this.addItem(item)
    }

    // Restore story beats
    for (const beat of storyBeats) {
      await this.addStoryBeat(beat)
    }

    // Restore embedded images
    /*     for (const image of embeddedImages) {
      await this.createEmbeddedImage({
        id: image.id,
        storyId: image.storyId,
        entryId: image.entryId,
        sourceText: image.sourceText,
        prompt: image.prompt,
        styleId: image.styleId,
        model: image.model,
        imageData: image.imageData,
        width: image.width,
        height: image.height,
        status: image.status,
        errorMessage: image.errorMessage,
      })
    } */
  }

  // ===== Branch Operations (for story branching/alternate timelines) =====

  async getBranches(storyId: string): Promise<Branch[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM branches WHERE story_id = ? ORDER BY created_at ASC',
      [storyId],
    )
    return results.map(this.mapBranch)
  }

  async getBranch(id: string): Promise<Branch | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM branches WHERE id = ?', [id])
    return results.length > 0 ? this.mapBranch(results[0]) : null
  }

  async addBranch(branch: Branch): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO branches (id, story_id, name, parent_branch_id, fork_entry_id, checkpoint_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        branch.id,
        branch.storyId,
        branch.name,
        branch.parentBranchId ?? null,
        branch.forkEntryId,
        branch.checkpointId ?? null,
        branch.createdAt,
      ],
    )
  }

  async updateBranch(
    id: string,
    updates: Partial<Pick<Branch, 'name' | 'checkpointId'>>,
  ): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.checkpointId !== undefined) {
      setClauses.push('checkpoint_id = ?')
      values.push(updates.checkpointId ?? null)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE branches SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteBranch(id: string): Promise<void> {
    const db = await this.getDb()
    // Delete story entries belonging to this branch
    await db.execute('DELETE FROM story_entries WHERE branch_id = ?', [id])
    // Delete chapters belonging to this branch
    await db.execute('DELETE FROM chapters WHERE branch_id = ?', [id])
    // Delete world state items belonging to this branch
    await db.execute('DELETE FROM characters WHERE branch_id = ?', [id])
    await db.execute('DELETE FROM locations WHERE branch_id = ?', [id])
    await db.execute('DELETE FROM items WHERE branch_id = ?', [id])
    await db.execute('DELETE FROM story_beats WHERE branch_id = ?', [id])
    await db.execute('DELETE FROM entries WHERE branch_id = ?', [id])
    // Delete the branch itself
    await db.execute('DELETE FROM branches WHERE id = ?', [id])
  }

  async setStoryCurrentBranch(storyId: string, branchId: string | null): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET current_branch_id = ?, updated_at = ? WHERE id = ?', [
      branchId,
      Date.now(),
      storyId,
    ])
  }

  private mapBranch(row: any): Branch {
    return {
      id: row.id,
      storyId: row.story_id,
      name: row.name,
      parentBranchId: row.parent_branch_id || null,
      forkEntryId: row.fork_entry_id,
      checkpointId: row.checkpoint_id || null,
      createdAt: row.created_at,
      snapshotComplete: row.snapshot_complete === 1,
    }
  }

  async setBranchSnapshotComplete(branchId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE branches SET snapshot_complete = 1 WHERE id = ?', [branchId])
  }

  // ===== Entry/Lorebook Operations (per design doc section 3.2) =====

  async getEntries(storyId: string): Promise<Entry[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM entries WHERE story_id = ? ORDER BY created_at ASC',
      [storyId],
    )
    return results.map(this.mapEntry)
  }

  /**
   * Get lorebook entries filtered by branch.
   * Each branch has its own complete copy of world state, so we only return exact matches.
   */
  async getEntriesForBranch(storyId: string, branchId: string | null): Promise<Entry[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      branchId === null
        ? 'SELECT * FROM entries WHERE story_id = ? AND branch_id IS NULL ORDER BY created_at ASC'
        : 'SELECT * FROM entries WHERE story_id = ? AND branch_id = ? ORDER BY created_at ASC',
      branchId === null ? [storyId] : [storyId, branchId],
    )
    return results.map(this.mapEntry)
  }

  // ===== COW Branch Resolution Methods =====

  /**
   * Resolve characters for a COW branch using lineage.
   * Walks main entities → each ancestor branch → current branch,
   * merging by canonical ID (overridesId ?? id). Later entries override earlier.
   */
  async getCharactersResolved(
    storyId: string,
    branchLineage: { id: string }[],
  ): Promise<Character[]> {
    const resolved = new Map<string, Character>()
    const currentBranchId = branchLineage[branchLineage.length - 1]?.id

    // Load main entities — strip deleted flag so children always inherit them
    const mainEntities = await this.getCharactersForBranch(storyId, null)
    for (const entity of mainEntities) {
      const mapped = entity.deleted ? { ...entity, deleted: false } : entity
      resolved.set(entity.overridesId ?? entity.id, mapped)
    }

    // Overlay each branch in lineage order (root → current)
    for (const branch of branchLineage) {
      const branchEntities = await this.getCharactersForBranch(storyId, branch.id)
      for (const entity of branchEntities) {
        const canonicalId = entity.overridesId ?? entity.id
        if (entity.deleted) {
          if (branch.id === currentBranchId) {
            // Tombstone on current branch: remove from resolved view
            resolved.delete(canonicalId)
          } else {
            // Ancestor tombstone: preserve entity for further inheritance
            resolved.set(canonicalId, { ...entity, deleted: false })
          }
        } else {
          resolved.set(canonicalId, entity)
        }
      }
    }

    return Array.from(resolved.values())
  }

  /**
   * Resolve locations for a COW branch using lineage.
   */
  async getLocationsResolved(
    storyId: string,
    branchLineage: { id: string }[],
  ): Promise<Location[]> {
    const resolved = new Map<string, Location>()
    const currentBranchId = branchLineage[branchLineage.length - 1]?.id

    const mainEntities = await this.getLocationsForBranch(storyId, null)
    for (const entity of mainEntities) {
      const mapped = entity.deleted ? { ...entity, deleted: false } : entity
      resolved.set(entity.overridesId ?? entity.id, mapped)
    }

    for (const branch of branchLineage) {
      const branchEntities = await this.getLocationsForBranch(storyId, branch.id)
      for (const entity of branchEntities) {
        const canonicalId = entity.overridesId ?? entity.id
        if (entity.deleted) {
          if (branch.id === currentBranchId) {
            resolved.delete(canonicalId)
          } else {
            resolved.set(canonicalId, { ...entity, deleted: false })
          }
        } else {
          resolved.set(canonicalId, entity)
        }
      }
    }

    return Array.from(resolved.values())
  }

  /**
   * Resolve items for a COW branch using lineage.
   */
  async getItemsResolved(storyId: string, branchLineage: { id: string }[]): Promise<Item[]> {
    const resolved = new Map<string, Item>()
    const currentBranchId = branchLineage[branchLineage.length - 1]?.id

    const mainEntities = await this.getItemsForBranch(storyId, null)
    for (const entity of mainEntities) {
      const mapped = entity.deleted ? { ...entity, deleted: false } : entity
      resolved.set(entity.overridesId ?? entity.id, mapped)
    }

    for (const branch of branchLineage) {
      const branchEntities = await this.getItemsForBranch(storyId, branch.id)
      for (const entity of branchEntities) {
        const canonicalId = entity.overridesId ?? entity.id
        if (entity.deleted) {
          if (branch.id === currentBranchId) {
            resolved.delete(canonicalId)
          } else {
            resolved.set(canonicalId, { ...entity, deleted: false })
          }
        } else {
          resolved.set(canonicalId, entity)
        }
      }
    }

    return Array.from(resolved.values())
  }

  /**
   * Resolve story beats for a COW branch using lineage.
   */
  async getStoryBeatsResolved(
    storyId: string,
    branchLineage: { id: string }[],
  ): Promise<StoryBeat[]> {
    const resolved = new Map<string, StoryBeat>()
    const currentBranchId = branchLineage[branchLineage.length - 1]?.id

    const mainEntities = await this.getStoryBeatsForBranch(storyId, null)
    for (const entity of mainEntities) {
      const mapped = entity.deleted ? { ...entity, deleted: false } : entity
      resolved.set(entity.overridesId ?? entity.id, mapped)
    }

    for (const branch of branchLineage) {
      const branchEntities = await this.getStoryBeatsForBranch(storyId, branch.id)
      for (const entity of branchEntities) {
        const canonicalId = entity.overridesId ?? entity.id
        if (entity.deleted) {
          if (branch.id === currentBranchId) {
            resolved.delete(canonicalId)
          } else {
            resolved.set(canonicalId, { ...entity, deleted: false })
          }
        } else {
          resolved.set(canonicalId, entity)
        }
      }
    }

    return Array.from(resolved.values())
  }

  /**
   * Resolve lorebook entries for a COW branch using lineage.
   */
  async getLorebookEntriesResolved(
    storyId: string,
    branchLineage: { id: string }[],
  ): Promise<Entry[]> {
    const resolved = new Map<string, Entry>()
    const currentBranchId = branchLineage[branchLineage.length - 1]?.id

    const mainEntities = await this.getEntriesForBranch(storyId, null)
    for (const entity of mainEntities) {
      const mapped = entity.deleted ? { ...entity, deleted: false } : entity
      resolved.set(entity.overridesId ?? entity.id, mapped)
    }

    for (const branch of branchLineage) {
      const branchEntities = await this.getEntriesForBranch(storyId, branch.id)
      for (const entity of branchEntities) {
        const canonicalId = entity.overridesId ?? entity.id
        if (entity.deleted) {
          if (branch.id === currentBranchId) {
            resolved.delete(canonicalId)
          } else {
            resolved.set(canonicalId, { ...entity, deleted: false })
          }
        } else {
          resolved.set(canonicalId, entity)
        }
      }
    }

    return Array.from(resolved.values())
  }

  // ===== Copy-on-Delete (COD) Tombstone Methods =====

  /**
   * Mark an entity as deleted (tombstone) on a COW branch.
   * The entity must already be owned by the branch (via cowEnsure*).
   */
  async markCharacterDeleted(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE characters SET deleted = 1 WHERE id = ?', [id])
  }

  async markLocationDeleted(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE locations SET deleted = 1 WHERE id = ?', [id])
  }

  async markItemDeleted(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE items SET deleted = 1 WHERE id = ?', [id])
  }

  async markStoryBeatDeleted(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE story_beats SET deleted = 1 WHERE id = ?', [id])
  }

  async markEntryDeleted(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE entries SET deleted = 1 WHERE id = ?', [id])
  }

  /**
   * Remove no-op COW overrides — override rows whose data columns
   * are identical to the original they point to. Called after rollback
   * to clean up redundant rows.
   */
  async cleanupNoopOverrides(storyId: string, branchId: string | null): Promise<number> {
    const db = await this.getDb()
    let totalDeleted = 0

    // Characters: compare all data columns
    const charResult = await db.execute(
      `DELETE FROM characters WHERE id IN (
        SELECT o.id FROM characters o
        JOIN characters orig ON o.overrides_id = orig.id
        WHERE o.story_id = ? AND o.branch_id ${branchId === null ? 'IS NULL' : '= ?'}
          AND o.overrides_id IS NOT NULL
          AND o.deleted = 0
          AND IFNULL(o.name,'') = IFNULL(orig.name,'')
          AND IFNULL(o.description,'') = IFNULL(orig.description,'')
          AND IFNULL(o.relationship,'') = IFNULL(orig.relationship,'')
          AND IFNULL(o.traits,'') = IFNULL(orig.traits,'')
          AND IFNULL(o.status,'') = IFNULL(orig.status,'')
          AND IFNULL(o.metadata,'') = IFNULL(orig.metadata,'')
          AND IFNULL(o.visual_descriptors,'') = IFNULL(orig.visual_descriptors,'')
          AND IFNULL(o.portrait,'') = IFNULL(orig.portrait,'')
      )`,
      branchId === null ? [storyId] : [storyId, branchId],
    )
    totalDeleted += charResult.rowsAffected

    // Locations: compare all data columns
    const locResult = await db.execute(
      `DELETE FROM locations WHERE id IN (
        SELECT o.id FROM locations o
        JOIN locations orig ON o.overrides_id = orig.id
        WHERE o.story_id = ? AND o.branch_id ${branchId === null ? 'IS NULL' : '= ?'}
          AND o.overrides_id IS NOT NULL
          AND o.deleted = 0
          AND IFNULL(o.name,'') = IFNULL(orig.name,'')
          AND IFNULL(o.description,'') = IFNULL(orig.description,'')
          AND o.visited = orig.visited
          AND o.current = orig.current
          AND IFNULL(o.connections,'') = IFNULL(orig.connections,'')
          AND IFNULL(o.metadata,'') = IFNULL(orig.metadata,'')
      )`,
      branchId === null ? [storyId] : [storyId, branchId],
    )
    totalDeleted += locResult.rowsAffected

    // Items: compare all data columns
    const itemResult = await db.execute(
      `DELETE FROM items WHERE id IN (
        SELECT o.id FROM items o
        JOIN items orig ON o.overrides_id = orig.id
        WHERE o.story_id = ? AND o.branch_id ${branchId === null ? 'IS NULL' : '= ?'}
          AND o.overrides_id IS NOT NULL
          AND o.deleted = 0
          AND IFNULL(o.name,'') = IFNULL(orig.name,'')
          AND IFNULL(o.description,'') = IFNULL(orig.description,'')
          AND o.quantity = orig.quantity
          AND o.equipped = orig.equipped
          AND IFNULL(o.location,'') = IFNULL(orig.location,'')
          AND IFNULL(o.metadata,'') = IFNULL(orig.metadata,'')
      )`,
      branchId === null ? [storyId] : [storyId, branchId],
    )
    totalDeleted += itemResult.rowsAffected

    // Story Beats: compare all data columns
    const beatResult = await db.execute(
      `DELETE FROM story_beats WHERE id IN (
        SELECT o.id FROM story_beats o
        JOIN story_beats orig ON o.overrides_id = orig.id
        WHERE o.story_id = ? AND o.branch_id ${branchId === null ? 'IS NULL' : '= ?'}
          AND o.overrides_id IS NOT NULL
          AND o.deleted = 0
          AND IFNULL(o.title,'') = IFNULL(orig.title,'')
          AND IFNULL(o.description,'') = IFNULL(orig.description,'')
          AND IFNULL(o.type,'') = IFNULL(orig.type,'')
          AND IFNULL(o.status,'') = IFNULL(orig.status,'')
          AND IFNULL(o.triggered_at,0) = IFNULL(orig.triggered_at,0)
          AND IFNULL(o.resolved_at,0) = IFNULL(orig.resolved_at,0)
          AND IFNULL(o.metadata,'') = IFNULL(orig.metadata,'')
      )`,
      branchId === null ? [storyId] : [storyId, branchId],
    )
    totalDeleted += beatResult.rowsAffected

    if (totalDeleted > 0) {
      console.log(
        `[DatabaseService] Cleaned up ${totalDeleted} no-op COW override(s) for story ${storyId}`,
      )
    }

    return totalDeleted
  }

  async getEntriesByType(storyId: string, type: EntryType): Promise<Entry[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM entries WHERE story_id = ? AND type = ? ORDER BY created_at ASC',
      [storyId, type],
    )
    return results.map(this.mapEntry)
  }

  async getEntryPreviews(storyId: string): Promise<EntryPreview[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT id, name, type, description, aliases FROM entries WHERE story_id = ? ORDER BY name ASC',
      [storyId],
    )
    return results.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description || '',
      aliases: row.aliases ? JSON.parse(row.aliases) : [],
    }))
  }

  async getEntry(id: string): Promise<Entry | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM entries WHERE id = ?', [id])
    return results.length > 0 ? this.mapEntry(results[0]) : null
  }

  async addEntry(entry: Entry): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO entries (
        id, story_id, name, type, description, hidden_info, aliases,
        state, adventure_state, creative_state, injection,
        first_mentioned, last_mentioned, mention_count, created_by,
        created_at, updated_at, lore_management_blacklisted, branch_id, overrides_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.storyId,
        entry.name,
        entry.type,
        entry.description,
        entry.hiddenInfo,
        JSON.stringify(entry.aliases),
        JSON.stringify(entry.state),
        entry.adventureState ? JSON.stringify(entry.adventureState) : null,
        entry.creativeState ? JSON.stringify(entry.creativeState) : null,
        JSON.stringify(entry.injection),
        entry.firstMentioned,
        entry.lastMentioned,
        entry.mentionCount,
        entry.createdBy,
        entry.createdAt,
        entry.updatedAt,
        entry.loreManagementBlacklisted ? 1 : 0,
        entry.branchId || null,
        entry.overridesId || null,
      ],
    )
  }

  async updateEntry(id: string, updates: Partial<Entry>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = ['updated_at = ?']
    const values: any[] = [Date.now()]

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.type !== undefined) {
      setClauses.push('type = ?')
      values.push(updates.type)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.hiddenInfo !== undefined) {
      setClauses.push('hidden_info = ?')
      values.push(updates.hiddenInfo)
    }
    if (updates.aliases !== undefined) {
      setClauses.push('aliases = ?')
      values.push(JSON.stringify(updates.aliases))
    }
    if (updates.state !== undefined) {
      setClauses.push('state = ?')
      values.push(JSON.stringify(updates.state))
    }
    if (updates.adventureState !== undefined) {
      setClauses.push('adventure_state = ?')
      values.push(updates.adventureState ? JSON.stringify(updates.adventureState) : null)
    }
    if (updates.creativeState !== undefined) {
      setClauses.push('creative_state = ?')
      values.push(updates.creativeState ? JSON.stringify(updates.creativeState) : null)
    }
    if (updates.injection !== undefined) {
      setClauses.push('injection = ?')
      values.push(JSON.stringify(updates.injection))
    }
    if (updates.firstMentioned !== undefined) {
      setClauses.push('first_mentioned = ?')
      values.push(updates.firstMentioned)
    }
    if (updates.lastMentioned !== undefined) {
      setClauses.push('last_mentioned = ?')
      values.push(updates.lastMentioned)
    }
    if (updates.mentionCount !== undefined) {
      setClauses.push('mention_count = ?')
      values.push(updates.mentionCount)
    }
    if (updates.loreManagementBlacklisted !== undefined) {
      setClauses.push('lore_management_blacklisted = ?')
      values.push(updates.loreManagementBlacklisted ? 1 : 0)
    }

    values.push(id)
    await db.execute(`UPDATE entries SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteEntry(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM entries WHERE id = ?', [id])
  }

  async mergeEntries(entryIds: string[], mergedEntry: Entry): Promise<void> {
    // Delete old entries
    for (const id of entryIds) {
      await this.deleteEntry(id)
    }

    // Add merged entry
    await this.addEntry(mergedEntry)
  }

  async searchEntries(storyId: string, query: string): Promise<Entry[]> {
    const db = await this.getDb()
    const searchPattern = `%${query}%`
    const results = await db.select<any[]>(
      `SELECT * FROM entries WHERE story_id = ? AND (
        name LIKE ? OR description LIKE ? OR aliases LIKE ?
      ) ORDER BY name ASC`,
      [storyId, searchPattern, searchPattern, searchPattern],
    )
    return results.map(this.mapEntry)
  }

  // ===== Embedded Image Operations =====

  async getEmbeddedImagesForEntry(entryId: string): Promise<EmbeddedImage[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM embedded_images WHERE entry_id = ? ORDER BY created_at ASC',
      [entryId],
    )
    return results.map(this.mapEmbeddedImage)
  }

  async getEmbeddedImagesForStory(storyId: string): Promise<EmbeddedImage[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM embedded_images WHERE story_id = ? ORDER BY created_at ASC',
      [storyId],
    )
    return results.map(this.mapEmbeddedImage)
  }

  async createEmbeddedImage(image: Omit<EmbeddedImage, 'createdAt'>): Promise<EmbeddedImage> {
    const db = await this.getDb()
    const now = Date.now()
    await db.execute(
      `INSERT INTO embedded_images (
        id, story_id, entry_id, source_text, prompt, style_id, model,
        image_data, width, height, status, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        image.id,
        image.storyId,
        image.entryId,
        image.sourceText,
        image.prompt,
        image.styleId,
        image.model,
        image.imageData,
        image.width ?? null,
        image.height ?? null,
        image.status,
        image.errorMessage ?? null,
        now,
      ],
    )
    return { ...image, createdAt: now }
  }

  async getEmbeddedImage(id: string): Promise<EmbeddedImage | null> {
    const db = await this.getDb()
    const result = await db.select<any[]>('SELECT * FROM embedded_images WHERE id = ?', [id])
    return result.length > 0 ? this.mapEmbeddedImage(result[0]) : null
  }

  async updateEmbeddedImage(id: string, updates: Partial<EmbeddedImage>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.imageData !== undefined) {
      setClauses.push('image_data = ?')
      values.push(updates.imageData)
    }
    if (updates.width !== undefined) {
      setClauses.push('width = ?')
      values.push(updates.width)
    }
    if (updates.height !== undefined) {
      setClauses.push('height = ?')
      values.push(updates.height)
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      values.push(updates.status)
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push('error_message = ?')
      values.push(updates.errorMessage)
    }
    if (updates.prompt !== undefined) {
      setClauses.push('prompt = ?')
      values.push(updates.prompt)
    }
    if (updates.model !== undefined) {
      setClauses.push('model = ?')
      values.push(updates.model)
    }
    if (updates.styleId !== undefined) {
      setClauses.push('style_id = ?')
      values.push(updates.styleId)
    }
    if (updates.sourceText !== undefined) {
      setClauses.push('source_text = ?')
      values.push(updates.sourceText)
    }

    if (setClauses.length === 0) return
    values.push(id)
    await db.execute(`UPDATE embedded_images SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteEmbeddedImage(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM embedded_images WHERE id = ?', [id])
  }

  async deleteEmbeddedImagesForEntry(entryId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM embedded_images WHERE entry_id = ?', [entryId])
  }

  /**
   * Get the background image for a specific branch.
   */
  async getBackgroundForBranch(storyId: string, branchId: string | null): Promise<string | null> {
    const db = await this.getDb()
    const results = await db.select<{ image_data: string }[]>(
      'SELECT image_data FROM background_images WHERE story_id = ? AND branch_id IS ? AND checkpoint_id IS NULL ORDER BY created_at DESC LIMIT 1',
      [storyId, branchId],
    )
    return results.length > 0 ? results[0].image_data : null
  }

  /**
   * Get the background image for a specific checkpoint.
   */
  async getBackgroundForCheckpoint(storyId: string, checkpointId: string): Promise<string | null> {
    const db = await this.getDb()
    const results = await db.select<{ image_data: string }[]>(
      'SELECT image_data FROM background_images WHERE story_id = ? AND checkpoint_id = ? LIMIT 1',
      [storyId, checkpointId],
    )
    return results.length > 0 ? results[0].image_data : null
  }

  /**
   * Save a background image for a story/branch/checkpoint.
   */
  async saveBackground(
    storyId: string,
    branchId: string | null,
    checkpointId: string | null,
    imageData: string | null,
  ): Promise<void> {
    const db = await this.getDb()

    if (!imageData) {
      // If clearing, delete entries for this specific context
      if (checkpointId) {
        await db.execute('DELETE FROM background_images WHERE story_id = ? AND checkpoint_id = ?', [
          storyId,
          checkpointId,
        ])
      } else {
        await db.execute(
          'DELETE FROM background_images WHERE story_id = ? AND branch_id IS ? AND checkpoint_id IS NULL',
          [storyId, branchId],
        )
      }
      return
    }

    // Insert or update
    const id = crypto.randomUUID()
    const now = Date.now()

    if (checkpointId) {
      // Checkpoints always get a new entry or replace existing for that checkpoint
      await db.execute(
        'INSERT OR REPLACE INTO background_images (id, story_id, branch_id, checkpoint_id, image_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, storyId, branchId, checkpointId, imageData, now],
      )
    } else {
      // For branches (including main), we update the single "current" record for that branch
      const existing = await this.getBackgroundForBranch(storyId, branchId)
      if (existing) {
        await db.execute(
          'UPDATE background_images SET image_data = ?, created_at = ? WHERE story_id = ? AND branch_id IS ? AND checkpoint_id IS NULL',
          [imageData, now, storyId, branchId],
        )
      } else {
        await db.execute(
          'INSERT INTO background_images (id, story_id, branch_id, checkpoint_id, image_data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, storyId, branchId, null, imageData, now],
        )
      }
    }
  }

  /**
   * Clean up orphaned embedded_images that reference non-existent story_entries.
   * This can happen if data was created before foreign key constraints were enforced.
   * Returns the number of orphaned records deleted.
   */
  async cleanupOrphanedEmbeddedImages(): Promise<number> {
    const db = await this.getDb()
    // Find and delete embedded_images where the referenced entry_id doesn't exist
    const result = await db.execute(
      `DELETE FROM embedded_images
       WHERE entry_id NOT IN (SELECT id FROM story_entries)`,
    )
    const deleted = result.rowsAffected ?? 0
    if (deleted > 0) {
      console.log(`[Database] Cleaned up ${deleted} orphaned embedded_images`)
    }
    return deleted
  }

  private mapEmbeddedImage(row: any): EmbeddedImage {
    const sourceText = row.source_text
    // Detect inline images by checking if sourceText is a <pic> tag
    const isInline = sourceText && sourceText.trim().startsWith('<pic ')

    return {
      id: row.id,
      storyId: row.story_id,
      entryId: row.entry_id,
      sourceText: sourceText,
      prompt: row.prompt,
      styleId: row.style_id,
      model: row.model,
      imageData: row.image_data,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      status: row.status as EmbeddedImageStatus,
      errorMessage: row.error_message ?? undefined,
      generationMode: isInline ? 'inline' : 'analyzed',
      createdAt: row.created_at,
    }
  }

  // Mapping functions
  private mapStory(row: any): Story {
    const retryState = row.retry_state ? JSON.parse(row.retry_state) : null
    if (retryState) {
      console.log('[Database] Loading story with retry state', {
        storyId: row.id,
        hasCharacterSnapshots: !!retryState.characterSnapshots,
        characterSnapshotsCount: retryState.characterSnapshots?.length ?? 0,
        characterSnapshots: retryState.characterSnapshots?.map((s: any) => ({
          id: s.id,
          visualDescriptors: s.visualDescriptors,
          traits: s.traits,
        })),
      })
    }
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      genre: row.genre,
      templateId: row.template_id,
      mode: row.mode || 'adventure',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      settings: row.settings ? JSON.parse(row.settings) : null,
      memoryConfig: row.memory_config ? JSON.parse(row.memory_config) : null,
      retryState,
      styleReviewState: row.style_review_state ? JSON.parse(row.style_review_state) : null,
      timeTracker: row.time_tracker ? JSON.parse(row.time_tracker) : null,
      currentBranchId: row.current_branch_id || null,
      currentBgImage: null, // Loaded separately now
    }
  }

  private mapStoryEntry(row: any): StoryEntry {
    return {
      id: row.id,
      storyId: row.story_id,
      type: row.type,
      content: row.content,
      parentId: row.parent_id,
      position: row.position,
      createdAt: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      branchId: row.branch_id || null,
      reasoning: row.reasoning || undefined,
      // Translation fields
      translatedContent: row.translated_content || null,
      translationLanguage: row.translation_language || null,
      originalInput: row.original_input || null,
      // Phase 1: World state delta
      worldStateDelta: row.world_state_delta ? JSON.parse(row.world_state_delta) : null,
      // Persisted action suggestions for time-travel
      suggestedActions: row.suggested_actions || null,
    }
  }

  private mapCharacter(row: any): Character {
    const rawDescriptors = row.visual_descriptors ? JSON.parse(row.visual_descriptors) : null
    const rawTranslatedDescriptors = row.translated_visual_descriptors
      ? JSON.parse(row.translated_visual_descriptors)
      : null

    return {
      id: row.id,
      storyId: row.story_id,
      name: row.name,
      description: row.description,
      relationship: row.relationship,
      traits: row.traits ? JSON.parse(row.traits) : [],
      visualDescriptors: migrateVisualDescriptors(rawDescriptors),
      portrait: row.portrait || null,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      branchId: row.branch_id || null,
      overridesId: row.overrides_id || null,
      deleted: row.deleted === 1,
      // Translation fields
      translatedName: row.translated_name || null,
      translatedDescription: row.translated_description || null,
      translatedRelationship: row.translated_relationship || null,
      translatedTraits: row.translated_traits ? JSON.parse(row.translated_traits) : null,
      translatedVisualDescriptors: rawTranslatedDescriptors
        ? migrateVisualDescriptors(rawTranslatedDescriptors)
        : null,
      translationLanguage: row.translation_language || null,
    }
  }

  private mapLocation(row: any): Location {
    return {
      id: row.id,
      storyId: row.story_id,
      name: row.name,
      description: row.description,
      visited: row.visited === 1,
      current: row.current === 1,
      connections: row.connections ? JSON.parse(row.connections) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      branchId: row.branch_id || null,
      overridesId: row.overrides_id || null,
      deleted: row.deleted === 1,
      // Translation fields
      translatedName: row.translated_name || null,
      translatedDescription: row.translated_description || null,
      translationLanguage: row.translation_language || null,
    }
  }

  private mapItem(row: any): Item {
    return {
      id: row.id,
      storyId: row.story_id,
      name: row.name,
      description: row.description,
      quantity: row.quantity,
      equipped: row.equipped === 1,
      location: row.location,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      branchId: row.branch_id || null,
      overridesId: row.overrides_id || null,
      deleted: row.deleted === 1,
      // Translation fields
      translatedName: row.translated_name || null,
      translatedDescription: row.translated_description || null,
      translationLanguage: row.translation_language || null,
    }
  }

  private mapStoryBeat(row: any): StoryBeat {
    return {
      id: row.id,
      storyId: row.story_id,
      title: row.title,
      description: row.description,
      type: row.type,
      status: row.status,
      triggeredAt: row.triggered_at,
      resolvedAt: row.resolved_at ?? null,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      branchId: row.branch_id || null,
      overridesId: row.overrides_id || null,
      deleted: row.deleted === 1,
      // Translation fields
      translatedTitle: row.translated_title || null,
      translatedDescription: row.translated_description || null,
      translationLanguage: row.translation_language || null,
    }
  }

  private mapChapter(row: any): Chapter {
    return {
      id: row.id,
      storyId: row.story_id,
      number: row.number,
      title: row.title,
      startEntryId: row.start_entry_id,
      endEntryId: row.end_entry_id,
      entryCount: row.entry_count,
      summary: row.summary,
      startTime: row.start_time ? JSON.parse(row.start_time) : null,
      endTime: row.end_time ? JSON.parse(row.end_time) : null,
      keywords: row.keywords ? JSON.parse(row.keywords) : [],
      characters: row.characters ? JSON.parse(row.characters) : [],
      locations: row.locations ? JSON.parse(row.locations) : [],
      plotThreads: row.plot_threads ? JSON.parse(row.plot_threads) : [],
      emotionalTone: row.emotional_tone,
      branchId: row.branch_id || null,
      createdAt: row.created_at,
    }
  }

  private mapCheckpoint(row: any): Checkpoint {
    return {
      id: row.id,
      storyId: row.story_id,
      name: row.name,
      lastEntryId: row.last_entry_id,
      lastEntryPreview: row.last_entry_preview,
      entryCount: row.entry_count,
      entriesSnapshot: row.entries_snapshot ? JSON.parse(row.entries_snapshot) : [],
      charactersSnapshot: row.characters_snapshot ? JSON.parse(row.characters_snapshot) : [],
      locationsSnapshot: row.locations_snapshot ? JSON.parse(row.locations_snapshot) : [],
      itemsSnapshot: row.items_snapshot ? JSON.parse(row.items_snapshot) : [],
      storyBeatsSnapshot: row.story_beats_snapshot ? JSON.parse(row.story_beats_snapshot) : [],
      chaptersSnapshot: row.chapters_snapshot ? JSON.parse(row.chapters_snapshot) : [],
      // Use null when missing - old checkpoints without time tracking should reset time to null on restore
      timeTrackerSnapshot: row.time_tracker_snapshot ? JSON.parse(row.time_tracker_snapshot) : null,
      // undefined if column doesn't exist (old checkpoints) - preserve current lorebook on restore
      lorebookEntriesSnapshot: row.lorebook_entries_snapshot
        ? JSON.parse(row.lorebook_entries_snapshot)
        : undefined,
      createdAt: row.created_at,
    }
  }

  private mapWorldStateSnapshot(row: any): WorldStateSnapshot {
    return {
      id: row.id,
      storyId: row.story_id,
      branchId: row.branch_id || null,
      entryId: row.entry_id,
      entryPosition: row.entry_position,
      charactersSnapshot: row.characters_snapshot ? JSON.parse(row.characters_snapshot) : [],
      locationsSnapshot: row.locations_snapshot ? JSON.parse(row.locations_snapshot) : [],
      itemsSnapshot: row.items_snapshot ? JSON.parse(row.items_snapshot) : [],
      storyBeatsSnapshot: row.story_beats_snapshot ? JSON.parse(row.story_beats_snapshot) : [],
      lorebookEntriesSnapshot: row.lorebook_entries_snapshot
        ? JSON.parse(row.lorebook_entries_snapshot)
        : undefined,
      timeTrackerSnapshot: row.time_tracker_snapshot ? JSON.parse(row.time_tracker_snapshot) : null,
      createdAt: row.created_at,
    }
  }

  private mapEntry(row: any): Entry {
    return {
      id: row.id,
      storyId: row.story_id,
      name: row.name,
      type: row.type,
      description: row.description || '',
      hiddenInfo: row.hidden_info,
      aliases: row.aliases ? JSON.parse(row.aliases) : [],
      state: row.state ? JSON.parse(row.state) : { type: row.type },
      adventureState: row.adventure_state ? JSON.parse(row.adventure_state) : null,
      creativeState: row.creative_state ? JSON.parse(row.creative_state) : null,
      injection: row.injection
        ? JSON.parse(row.injection)
        : { mode: 'keyword', keywords: [], priority: 0 },
      firstMentioned: row.first_mentioned,
      lastMentioned: row.last_mentioned,
      mentionCount: row.mention_count ?? 0,
      createdBy: row.created_by || 'user',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      loreManagementBlacklisted: row.lore_management_blacklisted === 1,
      branchId: row.branch_id || null,
      overridesId: row.overrides_id || null,
      deleted: row.deleted === 1,
    }
  }

  // ===== Character Vault Operations =====

  async getVaultCharacters(): Promise<VaultCharacter[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM character_vault ORDER BY favorite DESC, updated_at DESC',
    )
    return results.map(this.mapVaultCharacter)
  }

  async getVaultCharacter(id: string): Promise<VaultCharacter | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM character_vault WHERE id = ?', [id])
    return results.length > 0 ? this.mapVaultCharacter(results[0]) : null
  }

  async addVaultCharacter(character: VaultCharacter): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO character_vault (
        id, name, description,
        traits, visual_descriptors, portrait,
        tags, favorite, source, original_story_id, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        character.id,
        character.name,
        character.description,
        JSON.stringify(character.traits),
        JSON.stringify(character.visualDescriptors),
        character.portrait,
        JSON.stringify(character.tags),
        character.favorite ? 1 : 0,
        character.source,
        character.originalStoryId,
        character.metadata ? JSON.stringify(character.metadata) : null,
        character.createdAt,
        character.updatedAt,
      ],
    )
  }

  async updateVaultCharacter(id: string, updates: Partial<VaultCharacter>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = ['updated_at = ?']
    const values: any[] = [Date.now()]

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.traits !== undefined) {
      setClauses.push('traits = ?')
      values.push(JSON.stringify(updates.traits))
    }
    if (updates.visualDescriptors !== undefined) {
      setClauses.push('visual_descriptors = ?')
      values.push(JSON.stringify(updates.visualDescriptors))
    }
    if (updates.portrait !== undefined) {
      setClauses.push('portrait = ?')
      values.push(updates.portrait)
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?')
      values.push(JSON.stringify(updates.tags))
    }
    if (updates.favorite !== undefined) {
      setClauses.push('favorite = ?')
      values.push(updates.favorite ? 1 : 0)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null)
    }

    values.push(id)
    await db.execute(`UPDATE character_vault SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteVaultCharacter(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM character_vault WHERE id = ?', [id])
  }

  async searchVaultCharacters(query: string): Promise<VaultCharacter[]> {
    const db = await this.getDb()
    const searchPattern = `%${query}%`
    const results = await db.select<any[]>(
      `SELECT * FROM character_vault WHERE 
        name LIKE ? OR description LIKE ? OR tags LIKE ?
      ORDER BY favorite DESC, updated_at DESC`,
      [searchPattern, searchPattern, searchPattern],
    )
    return results.map(this.mapVaultCharacter)
  }

  private mapVaultCharacter(row: any): VaultCharacter {
    const rawDescriptors = row.visual_descriptors ? JSON.parse(row.visual_descriptors) : null

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      traits: row.traits ? JSON.parse(row.traits) : [],
      visualDescriptors: migrateVisualDescriptors(rawDescriptors),
      portrait: row.portrait,
      tags: row.tags ? JSON.parse(row.tags) : [],
      favorite: row.favorite === 1,
      source: row.source || 'manual',
      originalStoryId: row.original_story_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // ===== Lorebook Vault Operations =====

  async getVaultLorebooks(): Promise<VaultLorebook[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM lorebook_vault ORDER BY favorite DESC, updated_at DESC',
    )
    return results.map(this.mapVaultLorebook)
  }

  async getVaultLorebook(id: string): Promise<VaultLorebook | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM lorebook_vault WHERE id = ?', [id])
    return results.length > 0 ? this.mapVaultLorebook(results[0]) : null
  }

  async addVaultLorebook(lorebook: VaultLorebook): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO lorebook_vault (
        id, name, description, entries,
        tags, favorite, source, original_filename, original_story_id,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lorebook.id,
        lorebook.name,
        lorebook.description,
        JSON.stringify(lorebook.entries),
        JSON.stringify(lorebook.tags),
        lorebook.favorite ? 1 : 0,
        lorebook.source,
        lorebook.originalFilename,
        lorebook.originalStoryId,
        lorebook.metadata ? JSON.stringify(lorebook.metadata) : null,
        lorebook.createdAt,
        lorebook.updatedAt,
      ],
    )
  }

  async updateVaultLorebook(id: string, updates: Partial<VaultLorebook>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = ['updated_at = ?']
    const values: any[] = [Date.now()]

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.entries !== undefined) {
      setClauses.push('entries = ?')
      values.push(JSON.stringify(updates.entries))
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?')
      values.push(JSON.stringify(updates.tags))
    }
    if (updates.favorite !== undefined) {
      setClauses.push('favorite = ?')
      values.push(updates.favorite ? 1 : 0)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null)
    }

    values.push(id)
    await db.execute(`UPDATE lorebook_vault SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteVaultLorebook(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM lorebook_vault WHERE id = ?', [id])
  }

  async searchVaultLorebooks(query: string): Promise<VaultLorebook[]> {
    const db = await this.getDb()
    const searchPattern = `%${query}%`
    const results = await db.select<any[]>(
      `SELECT * FROM lorebook_vault WHERE 
        name LIKE ? OR description LIKE ? OR tags LIKE ?
      ORDER BY favorite DESC, updated_at DESC`,
      [searchPattern, searchPattern, searchPattern],
    )
    return results.map(this.mapVaultLorebook)
  }

  private mapVaultLorebook(row: any): VaultLorebook {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      entries: row.entries ? JSON.parse(row.entries) : [],
      tags: row.tags ? JSON.parse(row.tags) : [],
      favorite: row.favorite === 1,
      source: row.source || 'import',
      originalFilename: row.original_filename,
      originalStoryId: row.original_story_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  // ===== Scenario Vault Operations =====

  async getVaultScenarios(): Promise<VaultScenario[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM scenario_vault ORDER BY favorite DESC, updated_at DESC',
    )
    return results.map(this.mapVaultScenario)
  }

  async getVaultScenario(id: string): Promise<VaultScenario | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM scenario_vault WHERE id = ?', [id])
    return results.length > 0 ? this.mapVaultScenario(results[0]) : null
  }

  async addVaultScenario(scenario: VaultScenario): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO scenario_vault (
        id, name, description, setting_seed, npcs, primary_character_name,
        first_message, alternate_greetings, tags, favorite, source,
        original_filename, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scenario.id,
        scenario.name,
        scenario.description,
        scenario.settingSeed,
        JSON.stringify(scenario.npcs),
        scenario.primaryCharacterName,
        scenario.firstMessage,
        JSON.stringify(scenario.alternateGreetings),
        JSON.stringify(scenario.tags),
        scenario.favorite ? 1 : 0,
        scenario.source,
        scenario.originalFilename,
        scenario.metadata ? JSON.stringify(scenario.metadata) : null,
        scenario.createdAt,
        scenario.updatedAt,
      ],
    )
  }

  async updateVaultScenario(id: string, updates: Partial<VaultScenario>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = ['updated_at = ?']
    const values: any[] = [Date.now()]

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.settingSeed !== undefined) {
      setClauses.push('setting_seed = ?')
      values.push(updates.settingSeed)
    }
    if (updates.npcs !== undefined) {
      setClauses.push('npcs = ?')
      values.push(JSON.stringify(updates.npcs))
    }
    if (updates.primaryCharacterName !== undefined) {
      setClauses.push('primary_character_name = ?')
      values.push(updates.primaryCharacterName)
    }
    if (updates.firstMessage !== undefined) {
      setClauses.push('first_message = ?')
      values.push(updates.firstMessage)
    }
    if (updates.alternateGreetings !== undefined) {
      setClauses.push('alternate_greetings = ?')
      values.push(JSON.stringify(updates.alternateGreetings))
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?')
      values.push(JSON.stringify(updates.tags))
    }
    if (updates.favorite !== undefined) {
      setClauses.push('favorite = ?')
      values.push(updates.favorite ? 1 : 0)
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?')
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null)
    }

    values.push(id)
    await db.execute(`UPDATE scenario_vault SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deleteVaultScenario(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM scenario_vault WHERE id = ?', [id])
  }

  async searchVaultScenarios(query: string): Promise<VaultScenario[]> {
    const db = await this.getDb()
    const searchPattern = `%${query}%`
    const results = await db.select<any[]>(
      `SELECT * FROM scenario_vault WHERE 
        name LIKE ? OR description LIKE ? OR tags LIKE ? OR setting_seed LIKE ?
      ORDER BY favorite DESC, updated_at DESC`,
      [searchPattern, searchPattern, searchPattern, searchPattern],
    )
    return results.map(this.mapVaultScenario)
  }

  // ===== Vault Tag Operations =====

  async getVaultTags(type?: VaultType): Promise<VaultTag[]> {
    const db = await this.getDb()
    const query = type
      ? 'SELECT * FROM vault_tags WHERE type = ? ORDER BY name ASC'
      : 'SELECT * FROM vault_tags ORDER BY type ASC, name ASC'
    const params = type ? [type] : []

    const results = await db.select<any[]>(query, params)
    return results.map(this.mapVaultTag)
  }

  async addVaultTag(tag: VaultTag): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      'INSERT INTO vault_tags (id, name, type, color, created_at) VALUES (?, ?, ?, ?, ?)',
      [tag.id, tag.name, tag.type, tag.color, tag.createdAt],
    )
  }

  async updateVaultTag(id: string, updates: Partial<VaultTag>): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    // Get current tag first if we're updating the name
    let oldName: string | null = null
    let type: VaultType | null = null

    if (updates.name !== undefined) {
      const currentTag = await this.getDb().then((d) =>
        d.select<any[]>('SELECT name, type FROM vault_tags WHERE id = ?', [id]),
      )
      if (currentTag.length > 0) {
        oldName = currentTag[0].name
        type = currentTag[0].type as VaultType
      }
    }

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.color !== undefined) {
      setClauses.push('color = ?')
      values.push(updates.color)
    }

    if (setClauses.length === 0) return

    values.push(id)
    await db.execute(`UPDATE vault_tags SET ${setClauses.join(', ')} WHERE id = ?`, values)

    // If name changed, we must update all vault items that use this tag
    // This is a heavy operation but safe because we use transactions implicitly or just sequence it
    if (oldName && updates.name && type && oldName !== updates.name) {
      await this.migrateTagInVaultItems(type, oldName, updates.name)
    }
  }

  async deleteVaultTag(id: string): Promise<void> {
    const db = await this.getDb()

    // Get the tag first to know its name and type
    const tagResult = await db.select<any[]>('SELECT name, type FROM vault_tags WHERE id = ?', [id])
    if (tagResult.length === 0) return

    const { name, type } = tagResult[0]

    // Delete definition
    await db.execute('DELETE FROM vault_tags WHERE id = ?', [id])

    // Remove from all vault items
    await this.removeTagFromVaultItems(type, name)
  }

  // Helper to rename a tag across all vault items
  private async migrateTagInVaultItems(
    type: VaultType,
    oldName: string,
    newName: string,
  ): Promise<void> {
    const db = await this.getDb()
    let table = ''

    if (type === 'character') table = 'character_vault'
    else if (type === 'lorebook') table = 'lorebook_vault'
    else if (type === 'scenario') table = 'scenario_vault'

    if (!table) return

    // We have to read all rows that might contain the tag, update JSON, and write back
    // A simple REPLACE string might be dangerous if tag name is a substring of another tag
    const rows = await db.select<{ id: string; tags: string }[]>(
      `SELECT id, tags FROM ${table} WHERE tags LIKE ?`,
      [`%${oldName}%`],
    )

    for (const row of rows) {
      try {
        const tags = JSON.parse(row.tags) as string[]
        const index = tags.indexOf(oldName)
        if (index !== -1) {
          tags[index] = newName
          await db.execute(`UPDATE ${table} SET tags = ? WHERE id = ?`, [
            JSON.stringify(tags),
            row.id,
          ])
        }
      } catch (e) {
        console.error(`[Database] Failed to migrate tag for ${table} row ${row.id}`, e)
      }
    }
  }

  // Helper to remove a tag from all vault items
  private async removeTagFromVaultItems(type: VaultType, tagName: string): Promise<void> {
    const db = await this.getDb()
    let table = ''

    if (type === 'character') table = 'character_vault'
    else if (type === 'lorebook') table = 'lorebook_vault'
    else if (type === 'scenario') table = 'scenario_vault'

    if (!table) return

    const rows = await db.select<{ id: string; tags: string }[]>(
      `SELECT id, tags FROM ${table} WHERE tags LIKE ?`,
      [`%${tagName}%`],
    )

    for (const row of rows) {
      try {
        let tags = JSON.parse(row.tags) as string[]
        if (tags.includes(tagName)) {
          tags = tags.filter((t) => t !== tagName)
          await db.execute(`UPDATE ${table} SET tags = ? WHERE id = ?`, [
            JSON.stringify(tags),
            row.id,
          ])
        }
      } catch (e) {
        console.error(`[Database] Failed to remove tag for ${table} row ${row.id}`, e)
      }
    }
  }

  // Migration: Populate vault_tags from existing vault data
  async ensureTagsMigrated(): Promise<void> {
    const db = await this.getDb()

    // Check if we have any tags
    const count = await db.select<{ c: number }[]>('SELECT COUNT(*) as c FROM vault_tags')
    // If we already have tags, we assume migration is done or in progress
    // But we might want to check for new tags that appeared from imports?
    // For now, let's just do it if empty to seed the system
    if (count[0].c > 0) return

    console.log('[Database] Migrating existing tags to vault_tags table...')

    const colors = [
      'red-500',
      'orange-500',
      'amber-500',
      'yellow-500',
      'lime-500',
      'green-500',
      'emerald-500',
      'teal-500',
      'cyan-500',
      'sky-500',
      'blue-500',
      'indigo-500',
      'violet-500',
      'purple-500',
      'fuchsia-500',
      'pink-500',
      'rose-500',
    ]

    const processTable = async (table: string, type: VaultType) => {
      const rows = await db.select<{ tags: string }[]>(`SELECT tags FROM ${table}`)
      const uniqueTags = new Set<string>()

      for (const row of rows) {
        try {
          const tags = JSON.parse(row.tags) as string[]
          tags.forEach((t) => uniqueTags.add(t.trim()))
        } catch {}
      }

      for (const tagName of uniqueTags) {
        if (!tagName) continue
        const color = colors[Math.floor(Math.random() * colors.length)]
        // Use crypto.randomUUID() if available, otherwise simple random
        const id = crypto.randomUUID()

        try {
          await db.execute(
            'INSERT INTO vault_tags (id, name, type, color, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, tagName, type, color, Date.now()],
          )
        } catch {
          // Ignore unique constraint errors
          console.warn(`[Database] Skipped duplicate tag ${tagName} during migration`)
        }
      }
    }

    await processTable('character_vault', 'character')
    await processTable('lorebook_vault', 'lorebook')
    await processTable('scenario_vault', 'scenario')

    console.log('[Database] Tag migration complete')
  }

  // Vault assistant conversation operations

  async createVaultConversation(conversation: VaultConversation): Promise<void> {
    const db = await this.getDb()
    await db.execute(
      `INSERT INTO vault_assistant_conversations (id, title, created_at, updated_at, messages, chat_messages, pending_changes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        conversation.id,
        conversation.title,
        conversation.createdAt,
        conversation.updatedAt,
        conversation.messages,
        conversation.chatMessages,
        conversation.pendingChanges,
      ],
    )
  }

  async listVaultConversations(): Promise<VaultConversation[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM vault_assistant_conversations ORDER BY updated_at DESC',
    )
    return results.map(this.mapVaultConversation)
  }

  async loadVaultConversation(id: string): Promise<VaultConversation | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM vault_assistant_conversations WHERE id = ?',
      [id],
    )
    return results.length > 0 ? this.mapVaultConversation(results[0]) : null
  }

  async saveVaultConversation(
    id: string,
    updates: { title?: string; messages?: string; chatMessages?: string; pendingChanges?: string },
  ): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = ['updated_at = ?']
    const values: unknown[] = [new Date().toISOString()]

    if (updates.title !== undefined) {
      setClauses.push('title = ?')
      values.push(updates.title)
    }
    if (updates.messages !== undefined) {
      setClauses.push('messages = ?')
      values.push(updates.messages)
    }
    if (updates.chatMessages !== undefined) {
      setClauses.push('chat_messages = ?')
      values.push(updates.chatMessages)
    }
    if (updates.pendingChanges !== undefined) {
      setClauses.push('pending_changes = ?')
      values.push(updates.pendingChanges)
    }

    values.push(id)
    await db.execute(
      `UPDATE vault_assistant_conversations SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    )
  }

  async deleteVaultConversation(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM vault_assistant_conversations WHERE id = ?', [id])
  }

  private mapVaultConversation(row: any): VaultConversation {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: row.messages,
      chatMessages: row.chat_messages ?? '[]',
      pendingChanges: row.pending_changes ?? '[]',
    }
  }

  // ===== Preset Pack Operations =====

  async getAllPacks(): Promise<PresetPack[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM preset_packs ORDER BY is_default DESC, name ASC',
    )
    return results.map(this.mapPack)
  }

  async getPack(id: string): Promise<PresetPack | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT * FROM preset_packs WHERE id = ?', [id])
    return results.length > 0 ? this.mapPack(results[0]) : null
  }

  async getDefaultPack(): Promise<PresetPack | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM preset_packs WHERE is_default = 1 LIMIT 1',
    )
    return results.length > 0 ? this.mapPack(results[0]) : null
  }

  async createPack(pack: Omit<PresetPack, 'createdAt' | 'updatedAt'>): Promise<PresetPack> {
    const db = await this.getDb()
    const now = Date.now()
    await db.execute(
      'INSERT INTO preset_packs (id, name, description, author, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [pack.id, pack.name, pack.description, pack.author, pack.isDefault ? 1 : 0, now, now],
    )
    return { ...pack, createdAt: now, updatedAt: now }
  }

  async updatePack(
    id: string,
    updates: { name?: string; description?: string | null; author?: string | null },
  ): Promise<void> {
    const db = await this.getDb()
    const now = Date.now()
    const setClauses: string[] = ['updated_at = ?']
    const values: any[] = [now]

    if (updates.name !== undefined) {
      setClauses.push('name = ?')
      values.push(updates.name)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description)
    }
    if (updates.author !== undefined) {
      setClauses.push('author = ?')
      values.push(updates.author)
    }

    values.push(id)
    await db.execute(`UPDATE preset_packs SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deletePack(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM preset_packs WHERE id = ? AND is_default = 0', [id])
  }

  async canDeletePack(packId: string): Promise<boolean> {
    const db = await this.getDb()
    // Cannot delete default pack
    const pack = await this.getPack(packId)
    if (!pack || pack.isDefault) return false
    // Cannot delete if stories reference it
    const results = await db.select<any[]>(
      'SELECT COUNT(*) as count FROM stories WHERE pack_id = ?',
      [packId],
    )
    return results[0].count === 0
  }

  async getPackUsageCount(packId: string): Promise<number> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT COUNT(*) as count FROM stories WHERE pack_id = ?',
      [packId],
    )
    return results[0].count
  }

  // ===== Pack Template Operations =====

  async getPackTemplates(packId: string): Promise<PackTemplate[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM pack_templates WHERE pack_id = ? ORDER BY template_id',
      [packId],
    )
    return results.map(this.mapPackTemplate)
  }

  async getPackTemplate(packId: string, templateId: string): Promise<PackTemplate | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM pack_templates WHERE pack_id = ? AND template_id = ?',
      [packId, templateId],
    )
    return results.length > 0 ? this.mapPackTemplate(results[0]) : null
  }

  async setPackTemplateContent(packId: string, templateId: string, content: string): Promise<void> {
    const db = await this.getDb()
    const now = Date.now()
    const contentHash = await hashContent(content)
    // Use INSERT OR REPLACE to handle both create and update
    // Need to preserve original created_at if exists
    const existing = await this.getPackTemplate(packId, templateId)
    const createdAt = existing ? existing.createdAt : now
    await db.execute(
      `INSERT OR REPLACE INTO pack_templates (id, pack_id, template_id, content, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        existing?.id ?? crypto.randomUUID(),
        packId,
        templateId,
        content,
        contentHash,
        createdAt,
        now,
      ],
    )
  }

  async deletePackTemplate(packId: string, templateId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM pack_templates WHERE pack_id = ? AND template_id = ?', [
      packId,
      templateId,
    ])
  }

  // ===== Pack Variable Operations =====

  async getPackVariables(packId: string): Promise<CustomVariable[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM pack_variables WHERE pack_id = ? ORDER BY sort_order ASC, variable_name ASC',
      [packId],
    )
    return results.map(this.mapPackVariable)
  }

  async getPackVariable(packId: string, variableName: string): Promise<CustomVariable | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM pack_variables WHERE pack_id = ? AND variable_name = ?',
      [packId, variableName],
    )
    return results.length > 0 ? this.mapPackVariable(results[0]) : null
  }

  async createPackVariable(
    packId: string,
    variable: Omit<CustomVariable, 'id' | 'packId' | 'createdAt'>,
  ): Promise<CustomVariable> {
    const db = await this.getDb()
    const id = crypto.randomUUID()
    const now = Date.now()
    await db.execute(
      `INSERT INTO pack_variables (id, pack_id, variable_name, display_name, description, variable_type, is_required, sort_order, default_value, enum_options, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        packId,
        variable.variableName,
        variable.displayName,
        variable.description ?? null,
        variable.variableType,
        variable.isRequired ? 1 : 0,
        variable.sortOrder ?? 0,
        variable.defaultValue ?? null,
        variable.enumOptions ? JSON.stringify(variable.enumOptions) : null,
        now,
      ],
    )
    return { id, packId, ...variable, createdAt: now }
  }

  async updatePackVariable(
    id: string,
    updates: Partial<Omit<CustomVariable, 'id' | 'packId' | 'createdAt'>>,
  ): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.variableName !== undefined) {
      setClauses.push('variable_name = ?')
      values.push(updates.variableName)
    }
    if (updates.displayName !== undefined) {
      setClauses.push('display_name = ?')
      values.push(updates.displayName)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description || null)
    }
    if (updates.variableType !== undefined) {
      setClauses.push('variable_type = ?')
      values.push(updates.variableType)
    }
    if (updates.isRequired !== undefined) {
      setClauses.push('is_required = ?')
      values.push(updates.isRequired ? 1 : 0)
    }
    if (updates.sortOrder !== undefined) {
      setClauses.push('sort_order = ?')
      values.push(updates.sortOrder)
    }
    if (updates.defaultValue !== undefined) {
      setClauses.push('default_value = ?')
      values.push(updates.defaultValue)
    }
    if (updates.enumOptions !== undefined) {
      setClauses.push('enum_options = ?')
      values.push(updates.enumOptions ? JSON.stringify(updates.enumOptions) : null)
    }

    if (setClauses.length === 0) return

    values.push(id)
    await db.execute(`UPDATE pack_variables SET ${setClauses.join(', ')} WHERE id = ?`, values)
  }

  async deletePackVariable(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM pack_variables WHERE id = ?', [id])
  }

  // ===== Runtime Variable Definition Operations =====

  async getRuntimeVariables(packId: string): Promise<RuntimeVariable[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM pack_runtime_variables WHERE pack_id = ? ORDER BY entity_type ASC, sort_order ASC, variable_name ASC',
      [packId],
    )
    return results.map(this.mapRuntimeVariable)
  }

  async getRuntimeVariablesByEntityType(
    packId: string,
    entityType: RuntimeEntityType,
  ): Promise<RuntimeVariable[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT * FROM pack_runtime_variables WHERE pack_id = ? AND entity_type = ? ORDER BY sort_order ASC, variable_name ASC',
      [packId, entityType],
    )
    return results.map(this.mapRuntimeVariable)
  }

  async createRuntimeVariable(
    packId: string,
    variable: Omit<RuntimeVariable, 'id' | 'packId' | 'createdAt'>,
  ): Promise<RuntimeVariable> {
    const db = await this.getDb()
    const id = crypto.randomUUID()
    const now = Date.now()
    await db.execute(
      `INSERT INTO pack_runtime_variables (id, pack_id, entity_type, variable_name, display_name, description, variable_type, default_value, min_value, max_value, enum_options, color, icon, pinned, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        packId,
        variable.entityType,
        variable.variableName,
        variable.displayName,
        variable.description ?? null,
        variable.variableType,
        variable.defaultValue ?? null,
        variable.minValue ?? null,
        variable.maxValue ?? null,
        variable.enumOptions ? JSON.stringify(variable.enumOptions) : null,
        variable.color,
        variable.icon ?? null,
        variable.pinned ? 1 : 0,
        variable.sortOrder ?? 0,
        now,
      ],
    )
    return { id, packId, ...variable, createdAt: now }
  }

  async updateRuntimeVariable(
    id: string,
    updates: {
      entityType?: RuntimeEntityType
      variableName?: string
      displayName?: string
      description?: string | null
      variableType?: RuntimeVariableType
      defaultValue?: string | null
      minValue?: number | null
      maxValue?: number | null
      enumOptions?: EnumOption[] | null
      color?: string
      icon?: string | null
      pinned?: boolean
      sortOrder?: number
    },
  ): Promise<void> {
    const db = await this.getDb()
    const setClauses: string[] = []
    const values: any[] = []

    if (updates.entityType !== undefined) {
      setClauses.push('entity_type = ?')
      values.push(updates.entityType)
    }
    if (updates.variableName !== undefined) {
      setClauses.push('variable_name = ?')
      values.push(updates.variableName)
    }
    if (updates.displayName !== undefined) {
      setClauses.push('display_name = ?')
      values.push(updates.displayName)
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?')
      values.push(updates.description || null)
    }
    if (updates.variableType !== undefined) {
      setClauses.push('variable_type = ?')
      values.push(updates.variableType)
    }
    if (updates.defaultValue !== undefined) {
      setClauses.push('default_value = ?')
      values.push(updates.defaultValue || null)
    }
    if (updates.minValue !== undefined) {
      setClauses.push('min_value = ?')
      values.push(updates.minValue)
    }
    if (updates.maxValue !== undefined) {
      setClauses.push('max_value = ?')
      values.push(updates.maxValue)
    }
    if (updates.enumOptions !== undefined) {
      setClauses.push('enum_options = ?')
      values.push(updates.enumOptions ? JSON.stringify(updates.enumOptions) : null)
    }
    if (updates.color !== undefined) {
      setClauses.push('color = ?')
      values.push(updates.color)
    }
    if (updates.icon !== undefined) {
      setClauses.push('icon = ?')
      values.push(updates.icon || null)
    }
    if (updates.pinned !== undefined) {
      setClauses.push('pinned = ?')
      values.push(updates.pinned ? 1 : 0)
    }
    if (updates.sortOrder !== undefined) {
      setClauses.push('sort_order = ?')
      values.push(updates.sortOrder)
    }

    if (setClauses.length === 0) return

    values.push(id)
    await db.execute(
      `UPDATE pack_runtime_variables SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    )
  }

  async deleteRuntimeVariable(id: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('DELETE FROM pack_runtime_variables WHERE id = ?', [id])
  }

  // ===== Runtime Variable Entity Value Operations =====

  async getStoriesUsingPack(packId: string): Promise<string[]> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT id FROM stories WHERE pack_id = ?', [packId])
    return results.map((r) => r.id)
  }

  async countEntitiesWithRuntimeVar(packId: string, defId: string): Promise<number> {
    const storyIds = await this.getStoriesUsingPack(packId)
    if (storyIds.length === 0) return 0

    const db = await this.getDb()
    const placeholders = storyIds.map(() => '?').join(', ')
    const jsonPath = `$.runtimeVars.${defId}`

    const tables = ['characters', 'locations', 'items', 'story_beats']
    let total = 0

    for (const table of tables) {
      const results = await db.select<any[]>(
        `SELECT COUNT(*) as cnt FROM ${table} WHERE story_id IN (${placeholders}) AND json_extract(metadata, ?) IS NOT NULL`,
        [...storyIds, jsonPath],
      )
      total += results[0]?.cnt ?? 0
    }

    return total
  }

  async clearRuntimeVarFromEntities(packId: string, defId: string): Promise<void> {
    const storyIds = await this.getStoriesUsingPack(packId)
    if (storyIds.length === 0) return

    const db = await this.getDb()
    const placeholders = storyIds.map(() => '?').join(', ')
    const jsonPath = `$.runtimeVars.${defId}`

    const tables = ['characters', 'locations', 'items', 'story_beats']
    for (const table of tables) {
      await db.execute(
        `UPDATE ${table} SET metadata = json_remove(metadata, ?) WHERE story_id IN (${placeholders}) AND json_extract(metadata, ?) IS NOT NULL`,
        [jsonPath, ...storyIds, jsonPath],
      )
    }
  }

  async renameRuntimeVarInEntities(
    packId: string,
    defId: string,
    newVariableName: string,
  ): Promise<void> {
    const storyIds = await this.getStoriesUsingPack(packId)
    if (storyIds.length === 0) return

    const db = await this.getDb()
    const placeholders = storyIds.map(() => '?').join(', ')
    const jsonPath = `$.runtimeVars.${defId}`
    const varNamePath = `$.runtimeVars.${defId}.variableName`

    const tables = ['characters', 'locations', 'items', 'story_beats']
    for (const table of tables) {
      await db.execute(
        `UPDATE ${table} SET metadata = json_set(metadata, ?, ?) WHERE story_id IN (${placeholders}) AND json_extract(metadata, ?) IS NOT NULL`,
        [varNamePath, newVariableName, ...storyIds, jsonPath],
      )
    }
  }

  // ===== Story-Pack Assignment =====

  async getStoryPackId(storyId: string): Promise<string | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>('SELECT pack_id FROM stories WHERE id = ?', [storyId])
    return results.length > 0 ? results[0].pack_id : null
  }

  async setStoryPack(storyId: string, packId: string): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET pack_id = ? WHERE id = ?', [packId, storyId])
  }

  /**
   * Get per-story custom variable value overrides.
   * Returns null if no overrides have been set.
   */
  async getStoryCustomVariables(storyId: string): Promise<Record<string, string> | null> {
    const db = await this.getDb()
    const results = await db.select<any[]>(
      'SELECT custom_variable_values FROM stories WHERE id = ?',
      [storyId],
    )
    if (results.length === 0 || !results[0].custom_variable_values) return null
    try {
      return JSON.parse(results[0].custom_variable_values)
    } catch {
      console.error('[Database] Malformed custom_variable_values JSON for story:', storyId)
      return null
    }
  }

  /**
   * Set per-story custom variable value overrides.
   * Pass an object mapping variable names to their story-specific values.
   */
  async setStoryCustomVariables(storyId: string, values: Record<string, string>): Promise<void> {
    const db = await this.getDb()
    await db.execute('UPDATE stories SET custom_variable_values = ? WHERE id = ?', [
      JSON.stringify(values),
      storyId,
    ])
  }

  private mapVaultTag(row: any): VaultTag {
    return {
      id: row.id,
      name: row.name,
      type: row.type as VaultType,
      color: row.color,
      createdAt: row.created_at,
    }
  }

  private mapVaultScenario(row: any): VaultScenario {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      settingSeed: row.setting_seed,
      npcs: row.npcs ? JSON.parse(row.npcs) : [],
      primaryCharacterName: row.primary_character_name || '',
      firstMessage: row.first_message,
      alternateGreetings: row.alternate_greetings ? JSON.parse(row.alternate_greetings) : [],
      tags: row.tags ? JSON.parse(row.tags) : [],
      favorite: row.favorite === 1,
      source: row.source || 'import',
      originalFilename: row.original_filename,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapPack(row: any): PresetPack {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      author: row.author,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapPackTemplate(row: any): PackTemplate {
    return {
      id: row.id,
      packId: row.pack_id,
      templateId: row.template_id,
      content: row.content,
      contentHash: row.content_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapRuntimeVariable(row: any): RuntimeVariable {
    return {
      id: row.id,
      packId: row.pack_id,
      entityType: row.entity_type,
      variableName: row.variable_name,
      displayName: row.display_name,
      description: row.description ?? undefined,
      variableType: row.variable_type,
      defaultValue: row.default_value ?? undefined,
      minValue: row.min_value != null ? Number(row.min_value) : undefined,
      maxValue: row.max_value != null ? Number(row.max_value) : undefined,
      enumOptions: row.enum_options
        ? (() => {
            try {
              return JSON.parse(row.enum_options)
            } catch {
              return undefined
            }
          })()
        : undefined,
      color: row.color,
      icon: row.icon ?? undefined,
      pinned: !!row.pinned,
      sortOrder: row.sort_order ?? 0,
      createdAt: row.created_at,
    }
  }

  private mapPackVariable(row: any): CustomVariable {
    return {
      id: row.id,
      packId: row.pack_id,
      variableName: row.variable_name,
      displayName: row.display_name,
      description: row.description ?? undefined,
      variableType: row.variable_type,
      isRequired: row.is_required === 1,
      sortOrder: row.sort_order ?? 0,
      defaultValue: row.default_value ?? undefined,
      enumOptions: row.enum_options
        ? (() => {
            try {
              return JSON.parse(row.enum_options)
            } catch {
              return undefined
            }
          })()
        : undefined,
      createdAt: row.created_at,
    }
  }
}

export const database = new DatabaseService()
