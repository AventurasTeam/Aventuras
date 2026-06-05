export type TierTuple = Record<string, number>

export type SuggestionCategory = {
  id: string
  label: string
  promptHint: string
  color: string
  enabled: boolean
  order: number
}

export type Appearance = {
  themeId: string
  readerFontScale: number
  accentOverride?: string
  density: 'default' | 'compact' | 'regular' | 'comfortable'
}

export type StoryDefinition = {
  mode: 'adventure' | 'creative'
  leadEntityId: string | null
  narration: 'first' | 'second' | 'third'
  genre: { label: string; promptBody: string }
  tone: { label: string; promptBody: string }
  setting: string
  calendarSystemId: string
  worldTimeOrigin: TierTuple
}

export type StorySettings = {
  chapterTokenThreshold: number
  chapterAutoClose: boolean
  fullChapterInBuffer: boolean
  partialChapterBuffer: number
  protectedBuffer: number
  classifierCadence: number
  piggybackMode: 'on' | 'off'
  embeddingBackend: 'provider' | 'local'
  embedding_model_id: string
  embedding_swap_target?: string
  embedding_provider_id?: string
  retrievalBudgets: {
    entities: number
    lore: number
    happenings: number
    threads: number
    chapters: number
  }
  effectiveDim?: number
  probe_mode_active: boolean
  composerModesEnabled: boolean
  composerWrapPov: 'first' | 'third'
  suggestionsEnabled: boolean
  suggestionCount: number
  suggestionCategories: SuggestionCategory[]
  translation: {
    enabled: boolean
    targetLanguage: string | null
    granularToggles: {
      narrative: boolean
      entityNames: boolean
      entityDescriptions: boolean
      lore: boolean
      threads: boolean
      happenings: boolean
      chapterMeta: boolean
    }
  }
  models: {
    narrative?: string
    classifier?: string
    translation?: string
    suggestion?: string
    'lore-mgmt'?: string
    retrieval?: string
  }
  activePackId: string | null
  packVariables: Record<string, unknown>
}
