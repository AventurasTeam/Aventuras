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
    {
      name: 'chapterAnalysis.analysisEntries',
      expectedInUser: [
        'I open the gate.',
        'The gate creaks open, revealing a passage.',
        'Ancient runes glow along the walls.',
      ],
    },
    { name: 'firstValidId (computed)', expectedInUser: ['1'] },
    { name: 'lastValidId (computed)', expectedInUser: ['3'] },
  ],
}

export const chapterSummarizationManifest: TemplateVariableManifest = {
  templateId: 'chapter-summarization',
  hasUserContent: true,
  variables: [
    { name: 'previousChapters', expectedInUser: ['Chapter 1', 'Chapter 2'] },
    {
      name: 'chapterAnalysis.chapterEntries',
      expectedInUser: ['The hero arrived at dawn.', 'I search the room carefully.'],
    },
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

// ---------------------------------------------------------------------------
// Suggestions manifests
// ---------------------------------------------------------------------------

export const suggestionsManifest: TemplateVariableManifest = {
  templateId: 'suggestions',
  hasUserContent: true,
  variables: [
    { name: 'genre', expectedInUser: ['Fantasy'] },
    { name: 'storyBeats (activeThreads)', expectedInUser: ['Find the Lost Temple'] },
    {
      name: 'storyEntriesVisible',
      expectedInUser: ['I draw my sword and step cautiously forward.'],
    },
    { name: 'lorebookEntries', expectedInUser: ['The Shadow Guild', 'Elder Dragon'] },
  ],
}

// ---------------------------------------------------------------------------
// Generation manifests
// ---------------------------------------------------------------------------

export const actionChoicesManifest: TemplateVariableManifest = {
  templateId: 'action-choices',
  hasUserContent: true,
  variables: [
    { name: 'protagonistName', expectedInUser: ['Kael'] },
    { name: 'protagonistDescription', expectedInUser: ['wandering swordsman'] },
    {
      name: 'lastNarrativeEntry.content',
      expectedInUser: ['revealing a vast underground chamber'],
    },
    {
      name: 'storyEntriesVisible',
      expectedInUser: ['I draw my sword and step cautiously forward.'],
    },
    { name: 'inventory (items | where: equipped)', expectedInUser: ['Iron Sword'] },
    { name: 'retrievalResult.lorebookEntries', expectedInUser: ['The Shadow Guild'] },
    { name: 'styleReview.phrases', expectedInUser: ['dark and stormy'] },
  ],
}

export const timelineFillManifest: TemplateVariableManifest = {
  templateId: 'timeline-fill',
  hasUserContent: true,
  variables: [
    { name: 'storyEntriesVisible', expectedInUser: ['The torches flickered'] },
    { name: 'chapters', expectedInUser: ['The party ventured into the Thornwood'] },
  ],
}

export const timelineFillAnswerManifest: TemplateVariableManifest = {
  templateId: 'timeline-fill-answer',
  hasUserContent: true,
  variables: [
    { name: 'answerChapters', expectedInUser: ['Into the Woods'] },
    { name: 'query', expectedInUser: ['What happened at the gate?'] },
    {
      name: 'answerChapters[].entries',
      expectedInUser: ['I open the gate.', 'The gate creaks open'],
    },
  ],
}

// ---------------------------------------------------------------------------
// Analysis manifests
// ---------------------------------------------------------------------------

export const classifierManifest: TemplateVariableManifest = {
  templateId: 'classifier',
  hasUserContent: true,
  variables: [
    { name: 'genre', expectedInUser: ['Fantasy'] },
    { name: 'mode', expectedInUser: ['adventure'] },
    { name: 'characters', expectedInUser: ['Aria', 'Marcus'] },
    { name: 'locations', expectedInUser: ['Thornwood Edge', 'Sunken Temple'] },
    { name: 'items', expectedInUser: ['Iron Sword', 'Health Potion'] },
    { name: 'storyBeats', expectedInUser: ['Find the Lost Temple'] },
    { name: 'userInput', expectedInUser: ['I look around the chamber carefully'] },
    { name: 'narrativeResult.content', expectedInUser: ['The gate opened slowly'] },
    { name: 'timeTracker', expectedInUser: ['Year 1, Day 42'] },
    { name: 'storyEntriesVisible', expectedInUser: ['I draw my sword'] },
    { name: 'characters[].visualDescriptors', expectedInUser: ['Silver pendant'] },
    {
      name: 'packVariables.runtimeVariables',
      expectedInUser: ['loyalty'],
      requiresContext: {
        packVariables: {
          runtimeVariables: {
            character: [
              {
                variableName: 'loyalty',
                variableType: 'number',
                minValue: 0,
                maxValue: 100,
                defaultValue: '50',
                description: 'Loyalty toward protagonist',
              },
            ],
          },
        },
      },
    },
  ],
}

export const lorebookClassifierManifest: TemplateVariableManifest = {
  templateId: 'lorebook-classifier',
  hasUserContent: true,
  variables: [{ name: 'entriesJson', expectedInUser: ['The Shadow Guild', 'Elder Dragon'] }],
}

export const styleReviewerManifest: TemplateVariableManifest = {
  templateId: 'style-reviewer',
  hasUserContent: true,
  variables: [
    { name: 'storyEntriesVisible (narration)', expectedInUser: ['The torches flickered'] },
  ],
}

export const tier3EntrySelectionManifest: TemplateVariableManifest = {
  templateId: 'tier3-entry-selection',
  hasUserContent: true,
  variables: [
    { name: 'loreEntriesForTier3', expectedInUser: ['The Shadow Guild'] },
    { name: 'storyEntries', expectedInUser: ['The torches flickered'] },
    { name: 'userInput', expectedInUser: ['I look around the chamber carefully'] },
  ],
}

// ---------------------------------------------------------------------------
// Image manifests
// ---------------------------------------------------------------------------

export const imagePromptAnalysisManifest: TemplateVariableManifest = {
  templateId: 'image-prompt-analysis',
  hasUserContent: true,
  variables: [
    { name: 'userSettings.imageGeneration.maxImages', expectedInSystem: ['3'] },
    {
      name: 'userSettings.imageGeneration.stylePrompt',
      expectedInSystem: ['Soft cel-shaded anime'],
    },
    {
      name: 'characters[].visualDescriptors',
      expectedInSystem: ['Silver, waist-length, braided', 'Teal, sharp gaze'],
    },
    { name: 'storyEntriesVisible', expectedInUser: ['The torches flickered'] },
    { name: 'userInput', expectedInUser: ['I look around the chamber carefully'] },
    { name: 'lastNarrativeEntry.content', expectedInUser: ['phosphorescent moss'] },
    {
      name: 'translationResult.translatedContent',
      expectedInUser: ["La porte s'est ouverte lentement"],
    },
  ],
}

export const imagePromptAnalysisReferenceManifest: TemplateVariableManifest = {
  templateId: 'image-prompt-analysis-reference',
  hasUserContent: true,
  variables: [
    { name: 'userSettings.imageGeneration.maxImages', expectedInSystem: ['3'] },
    {
      name: 'userSettings.imageGeneration.stylePrompt',
      expectedInSystem: ['Soft cel-shaded anime'],
    },
    { name: 'characters[].visualDescriptors', expectedInSystem: ['Silver, waist-length, braided'] },
    { name: 'storyEntriesVisible', expectedInUser: ['The torches flickered'] },
    { name: 'userInput', expectedInUser: ['I look around the chamber carefully'] },
    { name: 'lastNarrativeEntry.content', expectedInUser: ['phosphorescent moss'] },
    {
      name: 'translationResult.translatedContent',
      expectedInUser: ["La porte s'est ouverte lentement"],
    },
  ],
}

export const imagePortraitGenerationManifest: TemplateVariableManifest = {
  templateId: 'image-portrait-generation',
  hasUserContent: false,
  variables: [
    {
      name: 'visualDescriptors',
      expectedInSystem: ['Angular features, bronze skin', 'Silver, waist-length, braided'],
      requiresContext: {
        visualDescriptors: {
          face: 'Angular features, bronze skin',
          hair: 'Silver, waist-length, braided',
          eyes: 'Teal, sharp',
          build: 'Tall, athletic',
        },
        imageStylePrompt: 'Anime style',
      },
    },
    {
      name: 'imageStylePrompt',
      expectedInSystem: ['Anime style'],
      requiresContext: {
        visualDescriptors: { face: 'Test face' },
        imageStylePrompt: 'Anime style',
      },
    },
  ],
}

export const backgroundImagePromptAnalysisManifest: TemplateVariableManifest = {
  templateId: 'background-image-prompt-analysis',
  hasUserContent: true,
  variables: [
    { name: 'storyEntriesVisible (narrations)', expectedInUser: ['phosphorescent moss'] },
  ],
}

// ---------------------------------------------------------------------------
// Narrative manifests
// ---------------------------------------------------------------------------

export const adventureManifest: TemplateVariableManifest = {
  templateId: 'adventure',
  hasUserContent: true,
  variables: [
    { name: 'protagonistName', expectedInSystem: ['Kael'] },
    { name: 'genre', expectedInSystem: ['Fantasy'] },
    { name: 'tone', expectedInSystem: ['Epic'] },
    { name: 'settingDescription', expectedInSystem: ['dark medieval realm'] },
    { name: 'themes', expectedInSystem: ['redemption'] },
    { name: 'pov', expectedInUser: ['second person'] },
    { name: 'tense', expectedInUser: ['present'] },
    { name: 'userSettings.visualProseMode' },
    { name: 'timeTracker.years', expectedInSystem: ['1'] },
    { name: 'timeTracker.days', expectedInSystem: ['42'] },
    { name: 'timeTracker.hours', expectedInSystem: ['14'] },
    { name: 'timeTracker.minutes', expectedInSystem: ['30'] },
    { name: 'relevantWorldState.characters', expectedInSystem: ['Aria', 'Marcus'] },
    { name: 'relevantWorldState.inventory', expectedInSystem: ['Iron Sword', 'Health Potion'] },
    { name: 'relevantWorldState.storyBeats', expectedInSystem: ['Find the Lost Temple'] },
    { name: 'relevantWorldState.locations', expectedInSystem: ['Thornwood Edge'] },
    { name: 'relevantWorldState.relevantItems', expectedInSystem: ['Crystal of Aethon'] },
    { name: 'relevantWorldState.relatedStoryBeats', expectedInSystem: ['The Prophecy'] },
    {
      name: 'retrievalResult.lorebookEntries',
      expectedInSystem: ['The Shadow Guild', 'Elder Dragon'],
    },
    {
      name: 'retrievalResult.agenticRetrieval.agenticReasoning',
      expectedInSystem: ['Selected entries relevant to the temple exploration.'],
    },
    {
      name: 'retrievalResult.agenticRetrieval.agenticChapterSummary',
      expectedInSystem: ['the party entered the Thornwood'],
    },
    {
      name: 'retrievalResult.agenticRetrieval.agenticSelectedEntries',
      expectedInSystem: ['## Elder Dragon (character)'],
    },
    { name: 'chapters', expectedInSystem: ['Into the Woods'] },
    { name: 'styleReview', expectedInSystem: ['dark and stormy'] },
    { name: 'storyEntriesVisibleRaw', expectedInUser: ['I draw my sword'] },
  ],
}

export const creativeWritingManifest: TemplateVariableManifest = {
  templateId: 'creative-writing',
  hasUserContent: true,
  variables: [
    { name: 'protagonistName', expectedInSystem: ['Kael'], expectedInUser: ['Kael'] },
    { name: 'genre', expectedInSystem: ['Fantasy'] },
    { name: 'tone', expectedInSystem: ['Epic'] },
    { name: 'settingDescription', expectedInSystem: ['dark medieval realm'] },
    { name: 'themes', expectedInSystem: ['redemption'] },
    { name: 'pov', expectedInSystem: ['SECOND PERSON'] },
    { name: 'tense', expectedInSystem: ['PRESENT TENSE'] },
    { name: 'userSettings.visualProseMode' },
    { name: 'styleReview', expectedInSystem: ['dark and stormy'] },
    { name: 'timeTracker.years', expectedInSystem: ['1'] },
    { name: 'relevantWorldState.characters', expectedInSystem: ['Aria', 'Marcus'] },
    { name: 'relevantWorldState.inventory', expectedInSystem: ['Iron Sword'] },
    { name: 'relevantWorldState.storyBeats', expectedInSystem: ['Find the Lost Temple'] },
    { name: 'retrievalResult.lorebookEntries', expectedInSystem: ['The Shadow Guild'] },
    {
      name: 'retrievalResult.agenticRetrieval.agenticReasoning',
      expectedInSystem: ['Selected entries relevant to the temple exploration.'],
    },
    { name: 'chapters', expectedInSystem: ['Into the Woods'] },
    { name: 'storyEntriesVisibleRaw', expectedInUser: ['I draw my sword'] },
  ],
}
