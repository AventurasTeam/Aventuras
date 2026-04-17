// src/lib/stores/story/settings.svelte.ts
import { database } from '$lib/services/database'
import { DEFAULT_MEMORY_CONFIG } from '$lib/services/ai/generation/MemoryService'
import type { StorySettings, MemoryConfig, POV, Tense } from '$lib/types'
import type { StoryStore } from './index.svelte'

export class StorySettingsStore {
  constructor(private story: StoryStore) {}

  // Raw stored values (private — exposed via getters with defaults)
  private _pov = $state<POV | undefined>()
  private _tense = $state<Tense | undefined>()
  private _memoryConfig = $state<MemoryConfig | null>(null)

  // Flattened StorySettings fields
  model = $state<string | undefined>()
  temperature = $state<number | undefined>()
  maxTokens = $state<number | undefined>()
  tone = $state<string | undefined>()
  themes = $state<string[] | undefined>()
  visualProseMode = $state<boolean | undefined>()
  imageGenerationMode = $state<'none' | 'agentic' | 'inline' | undefined>()
  backgroundImagesEnabled = $state<boolean | undefined>()
  referenceMode = $state<boolean | undefined>()

  // Getters with mode-dependent defaults (moved from generationContext)
  get pov(): POV {
    if (this._pov) return this._pov
    return this.story.mode === 'creative-writing' ? 'third' : 'first'
  }

  get tense(): Tense {
    if (this.story.mode === 'creative-writing') return 'past'
    return this._tense ?? 'present'
  }

  get memoryConfig(): MemoryConfig {
    return this._memoryConfig ?? DEFAULT_MEMORY_CONFIG
  }

  load(settings: StorySettings | null, memoryConfig: MemoryConfig | null) {
    this._pov = settings?.pov
    this._tense = settings?.tense
    this._memoryConfig = memoryConfig
    this.model = settings?.model
    this.temperature = settings?.temperature
    this.maxTokens = settings?.maxTokens
    this.tone = settings?.tone
    this.themes = settings?.themes
    this.visualProseMode = settings?.visualProseMode
    this.imageGenerationMode = settings?.imageGenerationMode
    this.backgroundImagesEnabled = settings?.backgroundImagesEnabled
    this.referenceMode = settings?.referenceMode
  }

  /** Reconstruct the StorySettings object (for DB persistence or Story snapshots). */
  toSnapshot(): StorySettings {
    return this.toStorySettings()
  }

  private toStorySettings(): StorySettings {
    return {
      pov: this._pov,
      tense: this._tense,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      tone: this.tone,
      themes: this.themes,
      visualProseMode: this.visualProseMode,
      imageGenerationMode: this.imageGenerationMode,
      backgroundImagesEnabled: this.backgroundImagesEnabled,
      referenceMode: this.referenceMode,
    }
  }

  async updateSettings(updates: Partial<StorySettings>) {
    if (!this.story.id) throw new Error('No story loaded')
    const newSettings = { ...this.toStorySettings(), ...updates }
    await database.updateStory(this.story.id, { settings: newSettings })
    this.load(newSettings, this._memoryConfig)
  }

  async setMemoryConfig(config: MemoryConfig) {
    if (!this.story.id) throw new Error('No story loaded')
    await database.updateStory(this.story.id, { memoryConfig: config })
    this._memoryConfig = config
  }

  async updateMemoryConfig(updates: Partial<MemoryConfig>) {
    if (!this.story.id) throw new Error('No story loaded')
    const newConfig = { ...this.memoryConfig, ...updates }
    await database.updateStory(this.story.id, { memoryConfig: newConfig as MemoryConfig })
    this._memoryConfig = newConfig as MemoryConfig
  }

  clear() {
    this._pov = undefined
    this._tense = undefined
    this._memoryConfig = null
    this.model = undefined
    this.temperature = undefined
    this.maxTokens = undefined
    this.tone = undefined
    this.themes = undefined
    this.visualProseMode = undefined
    this.imageGenerationMode = undefined
    this.backgroundImagesEnabled = undefined
    this.referenceMode = undefined
  }
}
