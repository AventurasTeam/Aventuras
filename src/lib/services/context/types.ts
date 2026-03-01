/**
 * Context System - Type Definitions
 */

/**
 * Render result from ContextBuilder.render()
 * A single render call returns both system and user prompts.
 */
export interface RenderResult {
  system: string
  user: string
}

/**
 * Wizard steps in order.
 * Used by wizard services to track progressive context building.
 */
export enum WizardStep {
  PackSelection = 1,
  SettingCreation = 2,
  WritingStyle = 3,
  CharacterCreation = 4,
  SupportingCharacters = 5,
  OpeningGeneration = 6,
}
