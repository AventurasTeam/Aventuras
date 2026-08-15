// The bundled pack's stable id. M2 stories carry this literal in
// settings.activePackId; the engine resolves it to the embedded bundled pack.
export const BUNDLED_PACK_ID = 'pack_bundled_default'

// Consumers (Slices 2.3 / 2.5 / 2.7) reference templates/macros by these
// constants only — never inline string literals (enforced by a grep test).
export const TEMPLATE_IDS = {
  perTurnNarrative: 'tmpl_per_turn_narrative',
  piggybackFallbackClassifier: 'tmpl_piggyback_fallback_classifier',
  periodicClassifier: 'tmpl_periodic_classifier',
  suggestionRefresh: 'tmpl_suggestion_refresh',
  wizardOpening: 'tmpl_wizard_opening',
  wizardOpeningRefine: 'tmpl_wizard_opening_refine',
  wizardTitleChips: 'tmpl_wizard_title_chips',
  wizardDescription: 'tmpl_wizard_description',
  wizardDescriptionRefine: 'tmpl_wizard_description_refine',
  wizardLore: 'tmpl_wizard_lore',
  wizardGenre: 'tmpl_wizard_genre',
  wizardGenreRefine: 'tmpl_wizard_genre_refine',
  wizardTone: 'tmpl_wizard_tone',
  wizardToneRefine: 'tmpl_wizard_tone_refine',
  wizardSetting: 'tmpl_wizard_setting',
  wizardSettingRefine: 'tmpl_wizard_setting_refine',
  wizardCast: 'tmpl_wizard_cast',
} as const

export const MACRO_IDS = {
  memoryBlocks: 'macro_memory_blocks',
  outputFormatNarrative: 'macro_output_format_narrative',
  stateEmission: 'macro_state_emission',
  suggestionEmission: 'macro_suggestion_emission',
  suggestionEmissionJson: 'macro_suggestion_emission_json',
  // One per prose field: everything its generate and refine templates share.
  wizardOpeningContext: 'macro_wizard_opening_context',
  wizardDescriptionContext: 'macro_wizard_description_context',
  wizardGenreContext: 'macro_wizard_genre_context',
  wizardToneContext: 'macro_wizard_tone_context',
  wizardSettingContext: 'macro_wizard_setting_context',
} as const

export type TemplateId = (typeof TEMPLATE_IDS)[keyof typeof TEMPLATE_IDS]
export type MacroId = (typeof MACRO_IDS)[keyof typeof MACRO_IDS]
