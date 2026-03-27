import type { VaultScenario, VaultScenarioNpc } from '$lib/types'
import { database } from '$lib/services/database'
import { discoveryService, type DiscoveryCard } from '$lib/services/discovery'
import { CharacterCardImport } from '$lib/services/characterCardImport'
import { LorebookImportExport } from '$lib/services/lorebookImportExport'
import { lorebookVault } from './lorebookVault.svelte'
import type { Genre } from '$lib/services/ai/wizard/ScenarioService'
import { ui } from './ui.svelte'
import { createLogger } from '$lib/log'

const log = createLogger('ScenarioVault')

/**
 * Store for managing the global Scenario Vault.
 * Scenarios are extracted from character cards and can be loaded in the wizard.
 */
class ScenarioVaultStore {
  scenarios = $state<VaultScenario[]>([])
  isLoaded = $state(false)

  get favorites(): VaultScenario[] {
    return this.scenarios.filter((s) => s.favorite)
  }

  get items(): VaultScenario[] {
    return this.scenarios
  }

  async load(): Promise<void> {
    try {
      this.scenarios = await database.getVaultScenarios()
      this.isLoaded = true
      log('Loaded', this.scenarios.length, 'vault scenarios')
    } catch (error) {
      console.error('[ScenarioVault] Failed to load:', error)
      this.scenarios = []
      this.isLoaded = true
    }
  }

  async add(input: Omit<VaultScenario, 'id' | 'createdAt' | 'updatedAt'>): Promise<VaultScenario> {
    const now = Date.now()
    const scenario: VaultScenario = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }

    await database.addVaultScenario(scenario)
    this.scenarios = [scenario, ...this.scenarios]
    log('Added vault scenario:', scenario.name)
    return scenario
  }

  async update(id: string, updates: Partial<VaultScenario>): Promise<void> {
    await database.updateVaultScenario(id, updates)
    this.scenarios = this.scenarios.map((s) =>
      s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s,
    )
    log('Updated vault scenario:', id)
  }

  async delete(id: string): Promise<void> {
    await database.deleteVaultScenario(id)
    this.scenarios = this.scenarios.filter((s) => s.id !== id)
    log('Deleted vault scenario:', id)
  }

  async toggleFavorite(id: string): Promise<void> {
    const scenario = this.scenarios.find((s) => s.id === id)
    if (scenario) {
      await this.update(id, { favorite: !scenario.favorite })
    }
  }

  getById(id: string): VaultScenario | undefined {
    return this.scenarios.find((s) => s.id === id)
  }

  async search(query: string): Promise<VaultScenario[]> {
    if (!query.trim()) {
      return this.scenarios
    }
    return database.searchVaultScenarios(query)
  }

  /**
   * Save a CardImportResult to the vault.
   */
  async saveFromImport(
    result: CharacterCardImport.CardImportResult,
    filename: string,
    options?: { tags?: string[]; sourceUrl?: string },
  ): Promise<VaultScenario> {
    const npcs: VaultScenarioNpc[] = result.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      description: npc.description,
      relationship: npc.relationship,
      traits: npc.traits || [],
    }))

    return this.add({
      name: result.storyTitle || filename.replace(/\.[^/.]+$/, ''),
      description:
        result.settingSeed.slice(0, 200) + (result.settingSeed.length > 200 ? '...' : ''),
      settingSeed: result.settingSeed,
      npcs,
      primaryCharacterName: result.primaryCharacterName,
      firstMessage: result.firstMessage || null,
      alternateGreetings: result.alternateGreetings || [],
      tags: options?.tags || ['imported'],
      favorite: false,
      source: 'import',
      originalFilename: filename,
      metadata: {
        hasFirstMessage: !!result.firstMessage,
        alternateGreetingsCount: result.alternateGreetings?.length || 0,
        npcCount: npcs.length,
        sourceUrl: options?.sourceUrl,
      },
    })
  }

  /**
   * Save current wizard setting to vault.
   */
  async saveFromWizard(
    name: string,
    settingSeed: string,
    npcs: VaultScenarioNpc[],
    options?: {
      description?: string
      firstMessage?: string
      alternateGreetings?: string[]
      tags?: string[]
    },
  ): Promise<VaultScenario> {
    return this.add({
      name,
      description: options?.description || settingSeed.slice(0, 200),
      settingSeed,
      npcs,
      primaryCharacterName: '',
      firstMessage: options?.firstMessage || null,
      alternateGreetings: options?.alternateGreetings || [],
      tags: options?.tags || ['created'],
      favorite: false,
      source: 'wizard',
      originalFilename: null,
      metadata: {
        hasFirstMessage: !!options?.firstMessage,
        alternateGreetingsCount: options?.alternateGreetings?.length || 0,
        npcCount: npcs.length,
      },
    })
  }

  /**
   * Import scenario from Discovery in the background.
   */
  async importFromDiscovery(card: DiscoveryCard, genre: Genre = 'fantasy'): Promise<void> {
    const tempId = crypto.randomUUID()
    const now = Date.now()

    // 1. Create placeholder
    const placeholder: VaultScenario = {
      id: tempId,
      name: card.name,
      description: card.description || 'Importing...',
      settingSeed: '',
      npcs: [],
      primaryCharacterName: '',
      firstMessage: null,
      alternateGreetings: [],
      tags: card.tags,
      favorite: false,
      source: 'import',
      originalFilename: null,
      createdAt: now,
      updatedAt: now,
      metadata: {
        importing: true,
        sourceUrl: card.imageUrl || card.avatarUrl,
      },
    }

    this.scenarios = [placeholder, ...this.scenarios]
    log('Started background import for:', card.name)

    // 2. Process in background
    this._processDiscoveryImport(tempId, card, genre).catch((err) => {
      const message = err instanceof Error ? err.message : `Failed to import ${card.name}`
      ui.showToast(message, 'error')
      this.scenarios = this.scenarios.filter((s) => s.id !== tempId)
    })
  }

  private async _processDiscoveryImport(
    tempId: string,
    card: DiscoveryCard,
    genre: Genre,
  ): Promise<void> {
    const blob = await discoveryService.downloadCard(card)
    const file = new File([blob], `${card.name}.${blob.type.includes('json') ? 'json' : 'png'}`, {
      type: blob.type,
    })

    await this._processFileImport(tempId, file, {
      sourceUrl: card.imageUrl || card.avatarUrl,
      tags: card.tags,
      genre,
    })
  }

  /**
   * Import scenario from a file in the background.
   */
  async importFromFile(file: File, genre: Genre = 'fantasy'): Promise<void> {
    const tempId = crypto.randomUUID()
    const now = Date.now()
    const name = file.name.replace(/\.[^/.]+$/, '')

    // 1. Create placeholder
    const placeholder: VaultScenario = {
      id: tempId,
      name: name,
      description: 'Importing from file...',
      settingSeed: '',
      npcs: [],
      primaryCharacterName: '',
      firstMessage: null,
      alternateGreetings: [],
      tags: ['imported'],
      favorite: false,
      source: 'import',
      originalFilename: file.name,
      createdAt: now,
      updatedAt: now,
      metadata: { importing: true },
    }

    this.scenarios = [placeholder, ...this.scenarios]
    log('Started file import for:', name)

    // 2. Process in background
    this._processFileImport(tempId, file, { genre }).catch((err) => {
      const message = err instanceof Error ? err.message : `Failed to import ${name}`
      ui.showToast(message, 'error')
      this.scenarios = this.scenarios.filter((s) => s.id !== tempId)
    })
  }

  private async _processFileImport(
    tempId: string,
    file: File,
    options: { sourceUrl?: string; tags?: string[]; genre?: Genre },
  ): Promise<void> {
    // Parse and convert
    const jsonString = await CharacterCardImport.readFile(file)
    const result = await CharacterCardImport.clean(jsonString, options.genre)

    if (!result.success && result.errors.length > 0 && !result.settingSeed) {
      throw new Error(result.errors.join('; '))
    }

    const npcs: VaultScenarioNpc[] = result.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      description: npc.description,
      relationship: npc.relationship,
      traits: npc.traits || [],
    }))

    let finalData: VaultScenario = {
      id: tempId,
      name: result.storyTitle || file.name.replace(/\.[^/.]+$/, ''),
      description:
        result.settingSeed.slice(0, 200) + (result.settingSeed.length > 200 ? '...' : ''),
      settingSeed: result.settingSeed,
      npcs,
      primaryCharacterName: result.primaryCharacterName,
      firstMessage: result.firstMessage || null,
      alternateGreetings: result.alternateGreetings || [],
      tags: options.tags || ['imported'],
      favorite: false,
      source: 'import',
      originalFilename: file.name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        hasFirstMessage: !!result.firstMessage,
        alternateGreetingsCount: result.alternateGreetings?.length || 0,
        npcCount: npcs.length,
        sourceUrl: options.sourceUrl,
      },
    }

    // Extract embedded lorebook if present
    const parsed = CharacterCardImport.parseJson(jsonString)
    if (parsed?.characterBook) {
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
            { name: finalData.name, type: 'scenario' },
          )
          finalData = {
            ...finalData,
            metadata: {
              ...finalData.metadata,
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
    await database.addVaultScenario(finalData)

    // Update store
    this.scenarios = this.scenarios.map((s) => (s.id === tempId ? finalData : s))
    log('Completed import for:', finalData.name)
  }
}

export const scenarioVault = new ScenarioVaultStore()
