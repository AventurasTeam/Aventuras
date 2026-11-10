import { MACRO_IDS, TEMPLATE_IDS, type TemplateId } from '../ids'
import { TEMPLATE_GROUPS } from '../templateContextMap'
import type { Pack, TemplateEntry, TemplateSources } from '../types'
import { CHAPTER_METADATA } from './chapter-metadata'
import { CHAPTER_METADATA_MERGE } from './chapter-metadata-merge'
import { CHAPTER_METADATA_PART } from './chapter-metadata-part'
import { CLASSIFIER_MODE_RULE } from './classifier-mode-rule'
import { CLOSE_IDENTITY } from './close-identity'
import { CLOSE_INSTRUCTIONS } from './close-instructions'
import { CLOSE_LORE } from './close-lore'
import { CLOSE_PROSE } from './close-prose'
import { CLOSE_THREADS } from './close-threads'
import { CLOSE_UPKEEP } from './close-upkeep'
import { ENTITY_STATE, ITEM_LINE } from './entity-state'
import { MEMORY_BLOCKS } from './memory-blocks'
import { NARRATOR_INSTRUCTIONS } from './narrator-instructions'
import { OUTPUT_FORMAT_NARRATIVE } from './output-format'
import { PER_TURN_NARRATIVE } from './per-turn'
import { PERIODIC_CLASSIFIER } from './periodic-classifier'
import { PIGGYBACK_FALLBACK_CLASSIFIER } from './piggyback-fallback-classifier'
import { STATE_EMISSION } from './state-emission'
import { STORY_ENTRY } from './story-entry'
import { SUGGESTION_EMISSION } from './suggestion-emission'
import { SUGGESTION_EMISSION_JSON } from './suggestion-emission-json'
import { SUGGESTION_REFRESH } from './suggestion-refresh'
import { SUGGESTION_VOICE } from './suggestion-voice'
import {
  MACRO_WIZARD_DESCRIPTION_CONTEXT,
  MACRO_WIZARD_GENRE_CONTEXT,
  MACRO_WIZARD_OPENING_CONTEXT,
  MACRO_WIZARD_SETTING_CONTEXT,
  MACRO_WIZARD_STORY,
  MACRO_WIZARD_TONE_CONTEXT,
  WIZARD_CAST,
  WIZARD_DESCRIPTION,
  WIZARD_DESCRIPTION_REFINE,
  WIZARD_GENRE,
  WIZARD_GENRE_REFINE,
  WIZARD_LORE,
  WIZARD_OPENING,
  WIZARD_OPENING_REFINE,
  WIZARD_SETTING,
  WIZARD_SETTING_REFINE,
  WIZARD_TITLE_CHIPS,
  WIZARD_TONE,
  WIZARD_TONE_REFINE,
} from './wizard'

// The group is the registry's (architecture.md → Context groups); the include validator reads it.
function template(id: TemplateId, sources: TemplateSources): TemplateEntry {
  return { group: TEMPLATE_GROUPS[id], ...sources }
}

// A wizard template's system half is empty (architecture.md → System and user halves).
function wizardTemplate(id: TemplateId, user: string): TemplateEntry {
  return template(id, { system: '', user })
}

export const bundledPack: Pack = {
  templates: {
    [TEMPLATE_IDS.perTurnNarrative]: template(TEMPLATE_IDS.perTurnNarrative, PER_TURN_NARRATIVE),
    [TEMPLATE_IDS.piggybackFallbackClassifier]: template(
      TEMPLATE_IDS.piggybackFallbackClassifier,
      PIGGYBACK_FALLBACK_CLASSIFIER,
    ),
    [TEMPLATE_IDS.periodicClassifier]: template(
      TEMPLATE_IDS.periodicClassifier,
      PERIODIC_CLASSIFIER,
    ),
    [TEMPLATE_IDS.suggestionRefresh]: template(TEMPLATE_IDS.suggestionRefresh, SUGGESTION_REFRESH),
    [TEMPLATE_IDS.chapterMetadata]: template(TEMPLATE_IDS.chapterMetadata, CHAPTER_METADATA),
    [TEMPLATE_IDS.chapterMetadataPart]: template(
      TEMPLATE_IDS.chapterMetadataPart,
      CHAPTER_METADATA_PART,
    ),
    [TEMPLATE_IDS.chapterMetadataMerge]: template(
      TEMPLATE_IDS.chapterMetadataMerge,
      CHAPTER_METADATA_MERGE,
    ),
    [TEMPLATE_IDS.closeLore]: template(TEMPLATE_IDS.closeLore, CLOSE_LORE),
    [TEMPLATE_IDS.closeIdentity]: template(TEMPLATE_IDS.closeIdentity, CLOSE_IDENTITY),
    [TEMPLATE_IDS.closeThreads]: template(TEMPLATE_IDS.closeThreads, CLOSE_THREADS),
    [TEMPLATE_IDS.closeUpkeep]: template(TEMPLATE_IDS.closeUpkeep, CLOSE_UPKEEP),
    [TEMPLATE_IDS.wizardOpening]: wizardTemplate(TEMPLATE_IDS.wizardOpening, WIZARD_OPENING),
    [TEMPLATE_IDS.wizardOpeningRefine]: wizardTemplate(
      TEMPLATE_IDS.wizardOpeningRefine,
      WIZARD_OPENING_REFINE,
    ),
    [TEMPLATE_IDS.wizardTitleChips]: wizardTemplate(
      TEMPLATE_IDS.wizardTitleChips,
      WIZARD_TITLE_CHIPS,
    ),
    [TEMPLATE_IDS.wizardDescription]: wizardTemplate(
      TEMPLATE_IDS.wizardDescription,
      WIZARD_DESCRIPTION,
    ),
    [TEMPLATE_IDS.wizardDescriptionRefine]: wizardTemplate(
      TEMPLATE_IDS.wizardDescriptionRefine,
      WIZARD_DESCRIPTION_REFINE,
    ),
    [TEMPLATE_IDS.wizardLore]: wizardTemplate(TEMPLATE_IDS.wizardLore, WIZARD_LORE),
    [TEMPLATE_IDS.wizardCast]: wizardTemplate(TEMPLATE_IDS.wizardCast, WIZARD_CAST),
    [TEMPLATE_IDS.wizardGenre]: wizardTemplate(TEMPLATE_IDS.wizardGenre, WIZARD_GENRE),
    [TEMPLATE_IDS.wizardGenreRefine]: wizardTemplate(
      TEMPLATE_IDS.wizardGenreRefine,
      WIZARD_GENRE_REFINE,
    ),
    [TEMPLATE_IDS.wizardTone]: wizardTemplate(TEMPLATE_IDS.wizardTone, WIZARD_TONE),
    [TEMPLATE_IDS.wizardToneRefine]: wizardTemplate(
      TEMPLATE_IDS.wizardToneRefine,
      WIZARD_TONE_REFINE,
    ),
    [TEMPLATE_IDS.wizardSetting]: wizardTemplate(TEMPLATE_IDS.wizardSetting, WIZARD_SETTING),
    [TEMPLATE_IDS.wizardSettingRefine]: wizardTemplate(
      TEMPLATE_IDS.wizardSettingRefine,
      WIZARD_SETTING_REFINE,
    ),
  },
  macros: {
    // Wizard-grouped, not staticContent: these read wizard working-state
    // variables, so only wizard templates may include them.
    [MACRO_IDS.wizardOpeningContext]: { group: 'wizard', source: MACRO_WIZARD_OPENING_CONTEXT },
    [MACRO_IDS.wizardDescriptionContext]: {
      group: 'wizard',
      source: MACRO_WIZARD_DESCRIPTION_CONTEXT,
    },
    [MACRO_IDS.wizardGenreContext]: { group: 'wizard', source: MACRO_WIZARD_GENRE_CONTEXT },
    [MACRO_IDS.wizardToneContext]: { group: 'wizard', source: MACRO_WIZARD_TONE_CONTEXT },
    [MACRO_IDS.wizardSettingContext]: { group: 'wizard', source: MACRO_WIZARD_SETTING_CONTEXT },
    [MACRO_IDS.wizardStory]: { group: 'wizard', source: MACRO_WIZARD_STORY },
    // architecture.md → Macros: generationContext, since they read its entity views.
    [MACRO_IDS.entityState]: { group: 'generationContext', source: ENTITY_STATE },
    [MACRO_IDS.itemLine]: { group: 'generationContext', source: ITEM_LINE },
    [MACRO_IDS.classifierModeRule]: { group: 'staticContent', source: CLASSIFIER_MODE_RULE },
    [MACRO_IDS.memoryBlocks]: { group: 'staticContent', source: MEMORY_BLOCKS },
    [MACRO_IDS.narratorInstructions]: { group: 'staticContent', source: NARRATOR_INSTRUCTIONS },
    [MACRO_IDS.outputFormatNarrative]: { group: 'staticContent', source: OUTPUT_FORMAT_NARRATIVE },
    [MACRO_IDS.stateEmission]: { group: 'staticContent', source: STATE_EMISSION },
    [MACRO_IDS.storyEntry]: { group: 'staticContent', source: STORY_ENTRY },
    [MACRO_IDS.suggestionEmission]: { group: 'staticContent', source: SUGGESTION_EMISSION },
    [MACRO_IDS.suggestionEmissionJson]: {
      group: 'staticContent',
      source: SUGGESTION_EMISSION_JSON,
    },
    [MACRO_IDS.suggestionVoice]: { group: 'staticContent', source: SUGGESTION_VOICE },
    // chapter: only a close's task templates include them (C3).
    [MACRO_IDS.closeInstructions]: { group: 'chapter', source: CLOSE_INSTRUCTIONS },
    [MACRO_IDS.closeProse]: { group: 'chapter', source: CLOSE_PROSE },
  },
}
