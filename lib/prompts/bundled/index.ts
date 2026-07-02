import { MACRO_IDS, TEMPLATE_IDS } from '../ids'
import type { Pack } from '../types'
import { OUTPUT_FORMAT_JSON, OUTPUT_FORMAT_NARRATIVE } from './output-format'
import { PER_TURN_NARRATIVE } from './per-turn'
import { WIZARD_DESCRIPTION, WIZARD_OPENING, WIZARD_TITLE_CHIPS } from './wizard'

export const bundledPack: Pack = {
  templates: {
    [TEMPLATE_IDS.perTurnNarrative]: { group: 'generationContext', source: PER_TURN_NARRATIVE },
    [TEMPLATE_IDS.wizardOpening]: { group: 'wizard', source: WIZARD_OPENING },
    [TEMPLATE_IDS.wizardTitleChips]: { group: 'wizard', source: WIZARD_TITLE_CHIPS },
    [TEMPLATE_IDS.wizardDescription]: { group: 'wizard', source: WIZARD_DESCRIPTION },
  },
  macros: {
    [MACRO_IDS.outputFormatNarrative]: { group: 'staticContent', source: OUTPUT_FORMAT_NARRATIVE },
    [MACRO_IDS.outputFormatJson]: { group: 'staticContent', source: OUTPUT_FORMAT_JSON },
  },
}
