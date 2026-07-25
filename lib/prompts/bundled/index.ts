import { MACRO_IDS, TEMPLATE_IDS } from '../ids'
import type { Pack } from '../types'
import { OUTPUT_FORMAT_NARRATIVE } from './output-format'
import { PER_TURN_NARRATIVE } from './per-turn'
import { PIGGYBACK_FALLBACK_CLASSIFIER } from './piggyback-fallback-classifier'
import { STATE_EMISSION } from './state-emission'
import { SUGGESTION_EMISSION } from './suggestion-emission'
import { SUGGESTION_EMISSION_JSON } from './suggestion-emission-json'
import { SUGGESTION_REFRESH } from './suggestion-refresh'
import { WIZARD_DESCRIPTION, WIZARD_OPENING, WIZARD_TITLE_CHIPS } from './wizard'

export const bundledPack: Pack = {
  templates: {
    [TEMPLATE_IDS.perTurnNarrative]: { group: 'generationContext', source: PER_TURN_NARRATIVE },
    [TEMPLATE_IDS.piggybackFallbackClassifier]: {
      group: 'generationContext',
      source: PIGGYBACK_FALLBACK_CLASSIFIER,
    },
    [TEMPLATE_IDS.suggestionRefresh]: {
      group: 'generationContext',
      source: SUGGESTION_REFRESH,
    },
    [TEMPLATE_IDS.wizardOpening]: { group: 'wizard', source: WIZARD_OPENING },
    [TEMPLATE_IDS.wizardTitleChips]: { group: 'wizard', source: WIZARD_TITLE_CHIPS },
    [TEMPLATE_IDS.wizardDescription]: { group: 'wizard', source: WIZARD_DESCRIPTION },
  },
  macros: {
    [MACRO_IDS.outputFormatNarrative]: { group: 'staticContent', source: OUTPUT_FORMAT_NARRATIVE },
    [MACRO_IDS.stateEmission]: { group: 'staticContent', source: STATE_EMISSION },
    [MACRO_IDS.suggestionEmission]: { group: 'staticContent', source: SUGGESTION_EMISSION },
    [MACRO_IDS.suggestionEmissionJson]: {
      group: 'staticContent',
      source: SUGGESTION_EMISSION_JSON,
    },
  },
}
