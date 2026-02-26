import type { VaultLorebook, EntryType, VaultLorebookEntry } from '$lib/types'
import type { LorebookImportResult } from '$lib/services/lorebookImporter'
import { database } from '$lib/services/database'
import { discoveryService, type DiscoveryCard } from '$lib/services/discovery'
import { parseLorebook, classifyEntriesWithLLM } from '$lib/services/lorebookImporter'
import { ui } from './ui.svelte'

const DEBUG = true

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[LorebookVault]', ...args)
  }
}

/**
 * Store for managing the global Lorebook Vault.
 * Lorebooks in the vault are templates that can be copied to stories.
 */
class LorebookVaultStore {
  lorebooks = $state<VaultLorebook[]>([])
  isLoaded = $state(false)

  get favorites(): VaultLorebook[] {
    return this.lorebooks.filter((lb) => lb.favorite)
  }

  get items(): VaultLorebook[] {
    return this.lorebooks
  }

  async load(): Promise<void> {
    try {
      this.lorebooks = await database.getVaultLorebooks()
      this.isLoaded = true
      log('Loaded', this.lorebooks.length, 'vault lorebooks')
    } catch (error) {
      console.error('[LorebookVault] Failed to load:', error)
      this.lorebooks = []
      this.isLoaded = true
    }
  }

  async add(
    input: Omit<VaultLorebook, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<VaultLorebook> {
    const now = Date.now()
    const lorebook: VaultLorebook = {
      ...input,
      id: input.id || crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }

    await database.addVaultLorebook(lorebook)
    this.lorebooks = [lorebook, ...this.lorebooks]
    log('Added vault lorebook:', lorebook.name)
    return lorebook
  }

  async update(id: string, updates: Partial<VaultLorebook>): Promise<void> {
    await database.updateVaultLorebook(id, updates)
    this.lorebooks = this.lorebooks.map((lb) =>
      lb.id === id ? { ...lb, ...updates, updatedAt: Date.now() } : lb,
    )
    log('Updated vault lorebook:', id)
  }

  async delete(id: string): Promise<void> {
    await database.deleteVaultLorebook(id)
    this.lorebooks = this.lorebooks.filter((lb) => lb.id !== id)
    log('Deleted vault lorebook:', id)
  }

  async toggleFavorite(id: string): Promise<void> {
    const lorebook = this.lorebooks.find((lb) => lb.id === id)
    if (lorebook) {
      await this.update(id, { favorite: !lorebook.favorite })
    }
  }

  /**
   * Save imported lorebook result to the vault.
   */
  async saveFromImport(
    name: string,
    entries: VaultLorebookEntry[],
    result: LorebookImportResult,
    filename: string,
    linkedFrom?: { name: string; type: 'character' | 'scenario' },
  ): Promise<VaultLorebook> {
    // Dedup: if an embedded lorebook from the same file already exists, reuse it
    if (linkedFrom) {
      const existing = this.lorebooks.find(
        (lb) => lb.originalFilename === filename && lb.name === name,
      )
      if (existing) return existing
    }

    const entryBreakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }
    for (const entry of entries) {
      entryBreakdown[entry.type]++
    }

    return this.add({
      name,
      description: null,
      entries,
      tags: [],
      favorite: false,
      source: 'import',
      originalFilename: filename,
      originalStoryId: null,
      metadata: {
        format: result.metadata.format,
        totalEntries: entries.length,
        entryBreakdown,
        ...(linkedFrom && { linkedFromName: linkedFrom.name, linkedFromType: linkedFrom.type }),
      },
    })
  }

  /**
   * Save lorebook entries from a story to the vault.
   */
  async saveFromStory(
    name: string,
    entries: VaultLorebookEntry[],
    storyId: string,
  ): Promise<VaultLorebook> {
    const entryBreakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }
    for (const entry of entries) {
      entryBreakdown[entry.type]++
    }

    return this.add({
      name,
      description: null,
      entries,
      tags: [],
      favorite: false,
      source: 'story',
      originalFilename: null,
      originalStoryId: storyId,
      metadata: {
        format: 'aventura',
        totalEntries: entries.length,
        entryBreakdown,
      },
    })
  }

  /**
   * Get a lorebook by ID.
   */
  getById(id: string): VaultLorebook | undefined {
    return this.lorebooks.find((lb) => lb.id === id)
  }

  /**
   * Search vault lorebooks.
   */
  async search(query: string): Promise<VaultLorebook[]> {
    if (!query.trim()) {
      return this.lorebooks
    }
    return database.searchVaultLorebooks(query)
  }

  /**
   * Import a lorebook from discovery (simplified - no LLM classification).
   */
  async importLorebook(
    name: string,
    entries: Array<{
      name: string
      description: string
      keywords: string[]
      type?: EntryType
    }>,
    options?: {
      description?: string
      tags?: string[]
    },
  ): Promise<VaultLorebook> {
    const entryBreakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }

    const vaultEntries: VaultLorebookEntry[] = entries.map((e) => {
      const type = e.type || 'concept'
      entryBreakdown[type]++
      return {
        name: e.name,
        type,
        description: e.description,
        keywords: e.keywords,
        aliases: [],
        injectionMode: 'keyword' as const,
        priority: 100,
      }
    })

    return this.add({
      name,
      description: options?.description || null,
      entries: vaultEntries,
      tags: options?.tags || ['imported'],
      favorite: false,
      source: 'import',
      originalFilename: null,
      originalStoryId: null,
      metadata: {
        format: 'sillytavern',
        totalEntries: vaultEntries.length,
        entryBreakdown,
      },
    })
  }

  /**
   * Import a lorebook from Discovery in the background.
   */
  async importFromDiscovery(card: DiscoveryCard): Promise<void> {
    const tempId = crypto.randomUUID()
    const now = Date.now()

    const placeholder: VaultLorebook = {
      id: tempId,
      name: card.name,
      description: card.description || 'Importing...',
      entries: [],
      tags: card.tags,
      favorite: false,
      source: 'import',
      originalFilename: null,
      originalStoryId: null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        format: 'unknown',
        totalEntries: 0,
        entryBreakdown: { character: 0, location: 0, item: 0, faction: 0, concept: 0, event: 0 },
        importing: true,
        sourceUrl: card.imageUrl,
      },
    }

    this.lorebooks = [placeholder, ...this.lorebooks]
    log('Started background import for:', card.name)

    this._processDiscoveryImport(tempId, card).catch((err) => {
      const message = err instanceof Error ? err.message : `Failed to import ${card.name}`
      ui.showToast(message, 'error')
      this.lorebooks = this.lorebooks.filter((lb) => lb.id !== tempId)
    })
  }

  private async _processDiscoveryImport(tempId: string, card: DiscoveryCard): Promise<void> {
    const blob = await discoveryService.downloadCard(card)
    const text = await blob.text()
    const parsed = parseLorebook(text)
    if (!parsed.success || parsed.entries.length === 0) {
      throw new Error(parsed.errors.join('; ') || 'Failed to parse lorebook')
    }

    // Classify entries with LLM
    const entries = await classifyEntriesWithLLM(
      parsed.entries,
      // eslint-disable-next-line unused-imports/no-unused-vars
      (current, total) => {
        // Update progress logic could go here if we tracked it in metadata
      },
      'adventure',
    )

    const vaultEntries = entries.map((e) => {
      const { originalData: _originalData, ...rest } = e
      return rest
    })

    const entryBreakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }
    for (const entry of vaultEntries) {
      entryBreakdown[entry.type]++
    }

    const finalData: VaultLorebook = {
      id: tempId,
      name: card.name,
      description: card.description || null,
      entries: vaultEntries,
      tags: card.tags,
      favorite: false,
      source: 'import',
      originalFilename: null,
      originalStoryId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        format: parsed.metadata.format,
        totalEntries: vaultEntries.length,
        entryBreakdown,
        sourceUrl: card.imageUrl,
      },
    }

    await database.addVaultLorebook(finalData)
    this.lorebooks = this.lorebooks.map((lb) => (lb.id === tempId ? finalData : lb))
    log('Completed import for:', finalData.name)
  }

  /**
   * Import a lorebook from a file in the background.
   */
  async importFromFile(file: File): Promise<void> {
    const tempId = crypto.randomUUID()
    const now = Date.now()
    const name = file.name.replace(/\.[^/.]+$/, '')

    const placeholder: VaultLorebook = {
      id: tempId,
      name: name,
      description: 'Importing from file...',
      entries: [],
      tags: ['imported'],
      favorite: false,
      source: 'import',
      originalFilename: file.name,
      originalStoryId: null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        format: 'unknown',
        totalEntries: 0,
        entryBreakdown: { character: 0, location: 0, item: 0, faction: 0, concept: 0, event: 0 },
        importing: true,
      },
    }

    this.lorebooks = [placeholder, ...this.lorebooks]
    log('Started background import for file:', name)

    this._processFileImport(tempId, file, name).catch((err) => {
      const message = err instanceof Error ? err.message : `Failed to import ${name}`
      ui.showToast(message, 'error')
      this.lorebooks = this.lorebooks.filter((lb) => lb.id !== tempId)
    })
  }

  private async _processFileImport(tempId: string, file: File, name: string): Promise<void> {
    const text = await file.text()
    const parsed = parseLorebook(text)
    if (!parsed.success || parsed.entries.length === 0) {
      throw new Error(parsed.errors.join('; ') || 'Failed to parse lorebook')
    }

    const entries = await classifyEntriesWithLLM(
      parsed.entries,
      // eslint-disable-next-line unused-imports/no-unused-vars
      (current, total) => {
        // Update progress logic could go here if we tracked it in metadata
      },
      'adventure',
    )

    const vaultEntries = entries.map((e) => {
      const { originalData: _originalData, ...rest } = e
      return rest
    })

    const entryBreakdown: Record<EntryType, number> = {
      character: 0,
      location: 0,
      item: 0,
      faction: 0,
      concept: 0,
      event: 0,
    }
    for (const entry of vaultEntries) {
      entryBreakdown[entry.type]++
    }

    const finalData: VaultLorebook = {
      id: tempId,
      name: name,
      description: null,
      entries: vaultEntries,
      tags: ['imported'],
      favorite: false,
      source: 'import',
      originalFilename: file.name,
      originalStoryId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        format: parsed.metadata.format,
        totalEntries: vaultEntries.length,
        entryBreakdown,
      },
    }

    await database.addVaultLorebook(finalData)
    this.lorebooks = this.lorebooks.map((lb) => (lb.id === tempId ? finalData : lb))
    log('Completed import for:', finalData.name)
  }
}

export const lorebookVault = new LorebookVaultStore()
