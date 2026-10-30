import { MACRO_IDS, TEMPLATE_IDS } from '../ids'
import type { Pack, TemplateEntry } from '../types'
import { CLASSIFIER_MODE_RULE } from './classifier-mode-rule'
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

// A wizard template's system half is empty (architecture.md → System and user halves).
function wizardTemplate(user: string): TemplateEntry {
  return { group: 'wizard', system: '', user }
}

export const bundledPack: Pack = {
  templates: {
    [TEMPLATE_IDS.perTurnNarrative]: { group: 'generationContext', ...PER_TURN_NARRATIVE },
    [TEMPLATE_IDS.piggybackFallbackClassifier]: {
      group: 'generationContext',
      ...PIGGYBACK_FALLBACK_CLASSIFIER,
    },
    [TEMPLATE_IDS.periodicClassifier]: { group: 'classifierContext', ...PERIODIC_CLASSIFIER },
    [TEMPLATE_IDS.suggestionRefresh]: { group: 'generationContext', ...SUGGESTION_REFRESH },
    [TEMPLATE_IDS.wizardOpening]: wizardTemplate(WIZARD_OPENING),
    [TEMPLATE_IDS.wizardOpeningRefine]: wizardTemplate(WIZARD_OPENING_REFINE),
    [TEMPLATE_IDS.wizardTitleChips]: wizardTemplate(WIZARD_TITLE_CHIPS),
    [TEMPLATE_IDS.wizardDescription]: wizardTemplate(WIZARD_DESCRIPTION),
    [TEMPLATE_IDS.wizardDescriptionRefine]: wizardTemplate(WIZARD_DESCRIPTION_REFINE),
    [TEMPLATE_IDS.wizardLore]: wizardTemplate(WIZARD_LORE),
    [TEMPLATE_IDS.wizardCast]: wizardTemplate(WIZARD_CAST),
    [TEMPLATE_IDS.wizardGenre]: wizardTemplate(WIZARD_GENRE),
    [TEMPLATE_IDS.wizardGenreRefine]: wizardTemplate(WIZARD_GENRE_REFINE),
    [TEMPLATE_IDS.wizardTone]: wizardTemplate(WIZARD_TONE),
    [TEMPLATE_IDS.wizardToneRefine]: wizardTemplate(WIZARD_TONE_REFINE),
    [TEMPLATE_IDS.wizardSetting]: wizardTemplate(WIZARD_SETTING),
    [TEMPLATE_IDS.wizardSettingRefine]: wizardTemplate(WIZARD_SETTING_REFINE),
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
  },
}
