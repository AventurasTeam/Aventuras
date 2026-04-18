import type { VaultCharacter, Character } from '$lib/types'
import { database } from '$lib/services/database'
import { discoveryService, type DiscoveryCard } from '$lib/services/discovery'
import { CharacterCardImport } from '$lib/services/characterCardImport'
import { LorebookImportExport } from '$lib/services/lorebookImportExport'
import { lorebookVault } from './lorebookVault.svelte'
import { ui } from './ui.svelte'
import { createLogger } from '$lib/log'

const log = createLogger('CharacterVault')

/**
 * Store for managing the global Character Vault.
 * Characters in the vault are templates that can be copied to stories.
 */
class CharacterVaultStore {
  // All vault characters
  characters = $state<VaultCharacter[]>([])

  // Loading state
  isLoaded = $state(false)

  // Derived: favorites
  get favorites(): VaultCharacter[] {
    return this.characters.filter((c) => c.favorite)
  }

  // Standardized interface for generic access
  get items(): VaultCharacter[] {
    return this.characters
  }

  /**
   * Load all vault characters from database.
   */
  async load(): Promise<void> {
    try {
      this.characters = await database.getVaultCharacters()
      this.isLoaded = true
      log('Loaded', this.characters.length, 'vault characters')
    } catch (error) {
      console.error('[CharacterVault] Failed to load:', error)
      this.characters = []
      this.isLoaded = true
    }
  }

  /**
   * Add a new character to the vault.
   */
  async add(
    input: Omit<VaultCharacter, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<VaultCharacter> {
    const now = Date.now()
    const character: VaultCharacter = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }

    await database.addVaultCharacter(character)
    this.characters = [character, ...this.characters]
    log('Added vault character:', character.name)
    return character
  }

  /**
   * Update an existing vault character.
   */
  async update(id: string, updates: Partial<VaultCharacter>): Promise<void> {
    await database.updateVaultCharacter(id, updates)
    this.characters = this.characters.map((c) =>
      c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c,
    )
    log('Updated vault character:', id)
  }

  /**
   * Delete a vault character.
   */
  async delete(id: string): Promise<void> {
    await database.deleteVaultCharacter(id)
    this.characters = this.characters.filter((c) => c.id !== id)
    log('Deleted vault character:', id)
  }

  /**
   * Toggle favorite status.
   */
  async toggleFavorite(id: string): Promise<void> {
    const character = this.characters.find((c) => c.id === id)
    if (character) {
      await this.update(id, { favorite: !character.favorite })
    }
  }

  /**
   * Save a story character to the vault.
   * Creates a copy of the character as a vault template.
   */
  async saveFromStory(storyCharacter: Character, storyId: string): Promise<VaultCharacter> {
    return this.add({
      name: storyCharacter.name,
      description: storyCharacter.description,
      traits: [...storyCharacter.traits],
      visualDescriptors: { ...(storyCharacter.visualDescriptors || {}) },
      portrait: storyCharacter.portrait,
      tags: [],
      favorite: false,
      source: 'story',
      originalStoryId: storyId,
      metadata: null,
    })
  }

  /**
   * Copy a vault character to a story.
   * Returns the data needed to create a story Character.
   */
  copyToStory(
    vaultCharacter: VaultCharacter,
    storyId: string,
    branchId: string | null,
  ): Omit<Character, 'id'> {
    return {
      storyId,
      name: vaultCharacter.name,
      description: vaultCharacter.description,
      // Relationship, motivation, and role will be set by the wizard or default
      relationship: null,
      traits: [...vaultCharacter.traits],
      visualDescriptors: { ...vaultCharacter.visualDescriptors },
      portrait: vaultCharacter.portrait,
      status: 'active',
      metadata: null,
      branchId,
    }
  }

  /**
   * Search vault characters by name, description, or tags.
   */
  async search(query: string): Promise<VaultCharacter[]> {
    if (!query.trim()) {
      return this.characters
    }
    return database.searchVaultCharacters(query)
  }

  /**
   * Get a character by ID.
   */
  getById(id: string): VaultCharacter | undefined {
    return this.characters.find((c) => c.id === id)
  }

  /**
   * Import a sanitized character (from LLM processing).
   */
  async importSanitizedCharacter(
    sanitized: CharacterCardImport.SanitizedCharacter,
    originalCard: {
      scenario?: string
      tags?: string[]
      version?: string
    },
  ): Promise<VaultCharacter> {
    return this.add({
      name: sanitized.name,
      description: sanitized.description,
      traits: sanitized.traits || [],
      visualDescriptors: sanitized.visualDescriptors || {},
      portrait: null,
      tags: originalCard.tags || ['imported', 'sanitized'],
      favorite: false,
      source: 'import',
      originalStoryId: null,
      metadata: { cardVersion: originalCard.version || 'unknown', sanitized: true },
    })
  }

  /**
   * Import a character from a parsed character card (from discovery or file).
   */
  async importCharacter(card: {
    name: string
    description?: string
    personality?: string
    scenario?: string
    first_mes?: string
    mes_example?: string
    creator_notes?: string
    tags?: string[]
    version?: string
  }): Promise<VaultCharacter> {
    const traits = card.personality
      ? card.personality
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10)
      : []

    return this.add({
      name: card.name,
      description: card.description || card.creator_notes || null,
      traits,
      visualDescriptors: {},
      portrait: null,
      tags: card.tags || ['imported'],
      favorite: false,
      source: 'import',
      originalStoryId: null,
      metadata: { cardVersion: card.version || 'unknown' },
    })
  }

  /**
   * Import a character from Discovery in the background.
   * Adds a placeholder immediately, then sanitizes and saves.
   */
  async importFromDiscovery(card: DiscoveryCard): Promise<void> {
    const tempId = crypto.randomUUID()
    const now = Date.now()

    // 1. Create Placeholder
    const placeholder: VaultCharacter = {
      id: tempId,
      name: card.name,
      description: card.description || 'Importing...',
      traits: [],
      visualDescriptors: {},
      portrait: card.avatarUrl || null,
      tags: card.tags,
      favorite: false,
      source: 'import',
      originalStoryId: null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        importing: true,
        sourceUrl: card.imageUrl || card.avatarUrl,
      },
    }

    // Add to store immediately
    this.characters = [placeholder, ...this.characters]
    log('Started background import for:', card.name)

    // 2. Process in background
    this._processDiscoveryImport(tempId, card).catch((err) => {
      const message = err instanceof Error ? err.message : `Failed to import ${card.name}`
      ui.showToast(message, 'error')
      this.characters = this.characters.filter((c) => c.id !== tempId)
    })
  }

  private async _processDiscoveryImport(tempId: string, card: DiscoveryCard): Promise<void> {
    const blob = await discoveryService.downloadCard(card)
    const file = new File([blob], `${card.name}.${blob.type.includes('json') ? 'json' : 'png'}`, {
      type: blob.type,
    })

    await this._processFileImport(tempId, file, {
      sourceUrl: card.imageUrl || card.avatarUrl,
      tags: card.tags,
    })
  }

  /**
   * Import a character from a file in the background.
   */
  async importFromFile(file: File): Promise<void> {
    const tempId = crypto.randomUUID()
    const now = Date.now()
    const name = file.name.replace(/\.[^/.]+$/, '')

    // 1. Create Placeholder
    const placeholder: VaultCharacter = {
      id: tempId,
      name: name,
      description: 'Importing from file...',
      traits: [],
      visualDescriptors: {},
      portrait: null,
      tags: ['imported'],
      favorite: false,
      source: 'import',
      originalStoryId: null,
      createdAt: now,
      updatedAt: now,
      metadata: { importing: true },
    }

    // Add to store immediately
    this.characters = [placeholder, ...this.characters]
    log('Started file import for:', name)

    // 2. Process in background
    this._processFileImport(tempId, file, {}).catch((err) => {
      const message = err instanceof Error ? err.message : `Failed to import ${name}`
      ui.showToast(message, 'error')
      this.characters = this.characters.filter((c) => c.id !== tempId)
    })
  }

  private async _processFileImport(
    tempId: string,
    file: File,
    extraMetadata: Record<string, any>,
  ): Promise<void> {
    try {
      // Parse
      const jsonString = await CharacterCardImport.readFile(file)
      const parsed = CharacterCardImport.parseJson(jsonString)
      if (!parsed) throw new Error('Failed to parse character card')

      // Sanitize
      const sanitized = await CharacterCardImport.sanitize(jsonString)

      // Convert image if needed
      let portrait: string | null = null
      if (file.type.startsWith('image/')) {
        portrait = await this._blobToBase64(file)
      } else if (extraMetadata.sourceUrl) {
        // Try to fetch image from source URL
        try {
          const response = await fetch(extraMetadata.sourceUrl)
          if (response.ok) {
            const blob = await response.blob()
            if (blob.type.startsWith('image/')) {
              portrait = await this._blobToBase64(blob)
            }
          }
        } catch (e) {
          console.warn('Failed to fetch portrait from sourceUrl, using URL as fallback', e)
        }
        // Fallback to URL if fetch failed or returned non-image
        if (!portrait) {
          portrait = extraMetadata.sourceUrl
        }
      }

      // Prepare final data
      let finalData: VaultCharacter = {
        id: tempId,
        name: sanitized?.name || parsed.name,
        description: sanitized?.description || parsed.description || parsed.creator_notes || null,
        traits:
          sanitized?.traits ||
          (parsed.personality
            ? parsed.personality
                .split(/[,;]/)
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 10)
            : []),
        visualDescriptors: sanitized?.visualDescriptors || {},
        portrait: portrait || null,
        tags: extraMetadata.tags || parsed.tags || ['imported'],
        favorite: false,
        source: 'import',
        originalStoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {
          cardVersion: parsed.version || 'unknown',
          sanitized: !!sanitized,
          ...extraMetadata,
        },
      }

      // Extract embedded lorebook if present
      if (parsed.characterBook) {
        const extracted = LorebookImportExport.extractEmbeddedLorebook(
          parsed.characterBook,
          parsed.name,
        )
        if (extracted) {
          try {
            if (!lorebookVault.isLoaded) await lorebookVault.load()
            const savedLorebook = await lorebookVault.saveFromImport(
              extracted.name,
              extracted.entries,
              extracted.result,
              file.name,
              { name: finalData.name, type: 'character' },
            )
            finalData = {
              ...finalData,
              metadata: {
                ...(finalData.metadata as Record<string, unknown>),
                linkedLorebookId: savedLorebook.id,
              },
            }
            ui.showToast(`Embedded lorebook extracted: ${extracted.name}`, 'info')
          } catch (err) {
            log('Failed to extract embedded lorebook:', err)
          }
        }
      }

      // Save to DB
      await database.addVaultCharacter(finalData)

      // Update store
      this.characters = this.characters.map((c) => (c.id === tempId ? finalData : c))
      log('Completed import for:', finalData.name)
    } catch (error) {
      this.characters = this.characters.filter((c) => c.id !== tempId)
      throw error
    }
  }

  private _blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }
}

export const characterVault = new CharacterVaultStore()
