// The bundled pack's stable id. M2 stories carry this literal in
// settings.activePackId; the engine resolves it to the embedded bundled pack.
export const BUNDLED_PACK_ID = 'pack_bundled_default'

// Consumers (Slices 2.3 / 2.5 / 2.7) reference templates/macros by these
// constants only — never inline string literals (enforced by a grep test).
export const TEMPLATE_IDS = {
  perTurnNarrative: 'tmpl_per_turn_narrative',
  wizardOpening: 'tmpl_wizard_opening',
  wizardTitleChips: 'tmpl_wizard_title_chips',
  wizardDescription: 'tmpl_wizard_description',
} as const

export const MACRO_IDS = {
  outputFormatNarrative: 'macro_output_format_narrative',
  outputFormatJson: 'macro_output_format_json',
} as const

export type TemplateId = (typeof TEMPLATE_IDS)[keyof typeof TEMPLATE_IDS]
export type MacroId = (typeof MACRO_IDS)[keyof typeof MACRO_IDS]
