import { MACRO_IDS, TEMPLATE_IDS } from '../ids'
import type { Pack } from '../types'
import { MEMORY_BLOCKS } from './memory-blocks'
import { OUTPUT_FORMAT_NARRATIVE } from './output-format'
import { PER_TURN_NARRATIVE } from './per-turn'
import { PERIODIC_CLASSIFIER } from './periodic-classifier'
import { PIGGYBACK_FALLBACK_CLASSIFIER } from './piggyback-fallback-classifier'
import { STATE_EMISSION } from './state-emission'
import { SUGGESTION_EMISSION } from './suggestion-emission'
import { SUGGESTION_EMISSION_JSON } from './suggestion-emission-json'
import { SUGGESTION_REFRESH } from './suggestion-refresh'
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

export const bundledPack: Pack = {
  templates: {
    [TEMPLATE_IDS.perTurnNarrative]: {
      group: 'generationContext',
      system: '',
      user: PER_TURN_NARRATIVE,
    },
    [TEMPLATE_IDS.piggybackFallbackClassifier]: {
      group: 'generationContext',
      system: '',
      user: PIGGYBACK_FALLBACK_CLASSIFIER,
    },
    [TEMPLATE_IDS.periodicClassifier]: {
      group: 'classifierContext',
      system: '',
      user: PERIODIC_CLASSIFIER,
    },
    [TEMPLATE_IDS.suggestionRefresh]: {
      group: 'generationContext',
      system: '',
      user: SUGGESTION_REFRESH,
    },
    // A wizard template's system half is empty (architecture.md → System and user halves).
    [TEMPLATE_IDS.wizardOpening]: { group: 'wizard', system: '', user: WIZARD_OPENING },
    [TEMPLATE_IDS.wizardOpeningRefine]: {
      group: 'wizard',
      system: '',
      user: WIZARD_OPENING_REFINE,
    },
    [TEMPLATE_IDS.wizardTitleChips]: { group: 'wizard', system: '', user: WIZARD_TITLE_CHIPS },
    [TEMPLATE_IDS.wizardDescription]: { group: 'wizard', system: '', user: WIZARD_DESCRIPTION },
    [TEMPLATE_IDS.wizardDescriptionRefine]: {
      group: 'wizard',
      system: '',
      user: WIZARD_DESCRIPTION_REFINE,
    },
    [TEMPLATE_IDS.wizardLore]: { group: 'wizard', system: '', user: WIZARD_LORE },
    [TEMPLATE_IDS.wizardCast]: { group: 'wizard', system: '', user: WIZARD_CAST },
    [TEMPLATE_IDS.wizardGenre]: { group: 'wizard', system: '', user: WIZARD_GENRE },
    [TEMPLATE_IDS.wizardGenreRefine]: { group: 'wizard', system: '', user: WIZARD_GENRE_REFINE },
    [TEMPLATE_IDS.wizardTone]: { group: 'wizard', system: '', user: WIZARD_TONE },
    [TEMPLATE_IDS.wizardToneRefine]: { group: 'wizard', system: '', user: WIZARD_TONE_REFINE },
    [TEMPLATE_IDS.wizardSetting]: { group: 'wizard', system: '', user: WIZARD_SETTING },
    [TEMPLATE_IDS.wizardSettingRefine]: {
      group: 'wizard',
      system: '',
      user: WIZARD_SETTING_REFINE,
    },
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
    [MACRO_IDS.memoryBlocks]: { group: 'staticContent', source: MEMORY_BLOCKS },
    [MACRO_IDS.outputFormatNarrative]: { group: 'staticContent', source: OUTPUT_FORMAT_NARRATIVE },
    [MACRO_IDS.stateEmission]: { group: 'staticContent', source: STATE_EMISSION },
    [MACRO_IDS.suggestionEmission]: { group: 'staticContent', source: SUGGESTION_EMISSION },
    [MACRO_IDS.suggestionEmissionJson]: {
      group: 'staticContent',
      source: SUGGESTION_EMISSION_JSON,
    },
  },
}
