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
import { WIZARD_DESCRIPTION, WIZARD_LORE, WIZARD_OPENING, WIZARD_TITLE_CHIPS } from './wizard'

export const bundledPack: Pack = {
  templates: {
    [TEMPLATE_IDS.perTurnNarrative]: { group: 'generationContext', source: PER_TURN_NARRATIVE },
    [TEMPLATE_IDS.piggybackFallbackClassifier]: {
      group: 'generationContext',
      source: PIGGYBACK_FALLBACK_CLASSIFIER,
    },
    [TEMPLATE_IDS.periodicClassifier]: {
      group: 'classifierContext',
      source: PERIODIC_CLASSIFIER,
    },
    [TEMPLATE_IDS.suggestionRefresh]: {
      group: 'generationContext',
      source: SUGGESTION_REFRESH,
    },
    [TEMPLATE_IDS.wizardOpening]: { group: 'wizard', source: WIZARD_OPENING },
    [TEMPLATE_IDS.wizardTitleChips]: { group: 'wizard', source: WIZARD_TITLE_CHIPS },
    [TEMPLATE_IDS.wizardDescription]: { group: 'wizard', source: WIZARD_DESCRIPTION },
    [TEMPLATE_IDS.wizardLore]: { group: 'wizard', source: WIZARD_LORE },
  },
  macros: {
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
