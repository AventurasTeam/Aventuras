// src/test/fixtures/templateManifests.ts

export interface TemplateVariableManifest {
  templateId: string
  hasUserContent: boolean
  variables: Array<{
    /** Variable name (dot-notation for nested, e.g. 'relevantWorldState.characters') */
    name: string
    /** Strings expected in rendered system content */
    expectedInSystem?: string[]
    /** Strings expected in rendered user content */
    expectedInUser?: string[]
    /** Context overrides needed for this variable to render (for conditionally-rendered vars) */
    requiresContext?: Record<string, any>
  }>
}

// ---------------------------------------------------------------------------
// Translation manifests
// ---------------------------------------------------------------------------

export const translateNarrationManifest: TemplateVariableManifest = {
  templateId: 'translate-narration',
  hasUserContent: true,
  variables: [
    {
      name: 'userSettings.translationSettings.targetLanguage.name',
      expectedInSystem: ['French'],
    },
    {
      name: 'narrativeResult.content',
      expectedInUser: ['The gate opened slowly'],
    },
  ],
}

export const translateInputManifest: TemplateVariableManifest = {
  templateId: 'translate-input',
  hasUserContent: true,
  variables: [
    {
      name: 'userSettings.translationSettings.sourceLanguage.name',
      expectedInSystem: ['Japanese'],
    },
    {
      name: 'userActionOriginal',
      expectedInUser: ['I draw my sword and step forward'],
    },
  ],
}

export const translateUIManifest: TemplateVariableManifest = {
  templateId: 'translate-ui',
  hasUserContent: true,
  variables: [
    {
      name: 'userSettings.translationSettings.targetLanguage.name',
      expectedInSystem: ['French'],
    },
    {
      name: 'uiElementsToTranslate',
      expectedInUser: ['The Keep', 'The Marketplace'],
    },
  ],
}

export const translateSuggestionsManifest: TemplateVariableManifest = {
  templateId: 'translate-suggestions',
  hasUserContent: true,
  variables: [
    {
      name: 'userSettings.translationSettings.targetLanguage.name',
      expectedInSystem: ['French'],
    },
    {
      name: 'suggestionsToTranslate',
      expectedInUser: ['Draw your sword and charge.', 'Ask the guardian about the prophecy.'],
    },
  ],
}

export const translateActionChoicesManifest: TemplateVariableManifest = {
  templateId: 'translate-action-choices',
  hasUserContent: true,
  variables: [
    {
      name: 'userSettings.translationSettings.targetLanguage.name',
      expectedInSystem: ['French'],
    },
    {
      name: 'actionChoicesToTranslate',
      expectedInUser: ['Open the ancient chest.', 'Greet the stranger.'],
    },
  ],
}

// ---------------------------------------------------------------------------
// Memory manifests
// ---------------------------------------------------------------------------

export const chapterAnalysisManifest: TemplateVariableManifest = {
  templateId: 'chapter-analysis',
  hasUserContent: true,
  variables: [
    { name: 'chapterAnalysis.analysisEntries', expectedInUser: ['I open the gate.', 'The gate creaks open, revealing a passage.', 'Ancient runes glow along the walls.'] },
    { name: 'firstValidId (computed)', expectedInUser: ['1'] },
    { name: 'lastValidId (computed)', expectedInUser: ['3'] },
  ],
}

export const chapterSummarizationManifest: TemplateVariableManifest = {
  templateId: 'chapter-summarization',
  hasUserContent: true,
  variables: [
    { name: 'previousChapters', expectedInUser: ['Chapter 1', 'Chapter 2'] },
    { name: 'chapterAnalysis.chapterEntries', expectedInUser: ['The hero arrived at dawn.', 'I search the room carefully.'] },
  ],
}

export const agenticRetrievalManifest: TemplateVariableManifest = {
  templateId: 'agentic-retrieval',
  hasUserContent: true,
  variables: [
    { name: 'userInput', expectedInUser: ['I look around the chamber carefully'] },
    { name: 'storyEntries', expectedInUser: ['The torches flickered'] },
    { name: 'agenticChapters', expectedInUser: ['Into the Woods'] },
    { name: 'agenticEntries', expectedInUser: ['The Shadow Guild'] },
  ],
}

export const interactiveLorebookManifest: TemplateVariableManifest = {
  templateId: 'interactive-lorebook',
  hasUserContent: false,
  variables: [
    { name: 'characterCount', expectedInSystem: ['2'] },
    { name: 'lorebookCount', expectedInSystem: ['2'] },
    { name: 'totalEntryCount', expectedInSystem: ['4'] },
    { name: 'scenarioCount', expectedInSystem: ['1'] },
    { name: 'focusedEntity.entityType', expectedInSystem: ['character'] },
    { name: 'focusedEntity.entityName', expectedInSystem: ['Aria'] },
    { name: 'focusedEntity.entityId', expectedInSystem: ['c1'] },
  ],
}

export const loreManagementManifest: TemplateVariableManifest = {
  templateId: 'lore-management',
  hasUserContent: true,
  variables: [
    { name: 'loreEntries', expectedInUser: ['The Shadow Guild', 'Elder Dragon'] },
    { name: 'loreChapters', expectedInUser: ['Into the Woods', 'The Sunken Temple'] },
  ],
}
