// The bundled pack's stable id. Stories carry this literal in
// settings.activePackId; the engine resolves it to the embedded bundled pack.
export const BUNDLED_PACK_ID = 'pack_bundled_default'

// Consumers reference templates/macros by these
// constants only — never inline string literals (enforced by a grep test).
export const TEMPLATE_IDS = {
  perTurnNarrative: 'tmpl_per_turn_narrative',
  piggybackFallbackClassifier: 'tmpl_piggyback_fallback_classifier',
  periodicClassifier: 'tmpl_periodic_classifier',
  suggestionRefresh: 'tmpl_suggestion_refresh',
  chapterMetadata: 'tmpl_chapter_metadata',
  chapterMetadataPart: 'tmpl_chapter_metadata_part',
  chapterMetadataMerge: 'tmpl_chapter_metadata_merge',
  closeHappenings: 'tmpl_close_happenings',
  closeLore: 'tmpl_close_lore',
  closeIdentity: 'tmpl_close_identity',
  closeThreads: 'tmpl_close_threads',
  closeUpkeep: 'tmpl_close_upkeep',
  closeLifecycle: 'tmpl_close_lifecycle',
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
  entityState: 'macro_entity_state',
  classifierModeRule: 'macro_classifier_mode_rule',
  itemLine: 'macro_item_line',
  memoryBlocks: 'macro_memory_blocks',
  narratorInstructions: 'macro_narrator_instructions',
  outputFormatNarrative: 'macro_output_format_narrative',
  stateEmission: 'macro_state_emission',
  storyEntry: 'macro_story_entry',
  suggestionEmission: 'macro_suggestion_emission',
  suggestionEmissionJson: 'macro_suggestion_emission_json',
  suggestionVoice: 'macro_suggestion_voice',
  // One per prose field: everything its generate and refine templates share.
  wizardOpeningContext: 'macro_wizard_opening_context',
  wizardDescriptionContext: 'macro_wizard_description_context',
  wizardGenreContext: 'macro_wizard_genre_context',
  wizardToneContext: 'macro_wizard_tone_context',
  wizardSettingContext: 'macro_wizard_setting_context',
  wizardStory: 'macro_wizard_story',
  // A close task's system half: the instructions every task shares, then its chapter or part.
  closeInstructions: 'macro_close_instructions',
  closeProse: 'macro_close_prose',
} as const

export type TemplateId = (typeof TEMPLATE_IDS)[keyof typeof TEMPLATE_IDS]
export type MacroId = (typeof MACRO_IDS)[keyof typeof MACRO_IDS]
