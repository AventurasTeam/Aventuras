/**
 * Tool Definitions Index
 *
 * Exports all tool factory functions for agentic services.
 */

export {
  createLoreManagementTools,
  createInteractiveVaultLorebookTools,
  type LorebookEntryToolContext,
  type StoryToolContext,
  type VaultLorebookToolContext,
  type ChapterInfo,
  type VaultLorebookPendingChangeSchema,
  type LorebookEntryTools,
  type StoryTools,
  type VaultLorebookTools,
  type LoreManagementTools,
  type InteractiveVaultLorebookTools,
} from './lorebook'
export { createCharacterTools, type CharacterToolContext, type CharacterTools } from './character'
export { createScenarioTools, type ScenarioToolContext, type ScenarioTools } from './scenario'
export { createVaultLinkingTools, type VaultLinkingContext, type VaultLinkingTools } from './vault'
export { createFandomTools, type FandomToolContext, type FandomTools } from './fandom'
export { createRetrievalTools, type RetrievalToolContext, type RetrievalTools } from './retrieval'
export { createViewerTools, type ViewerToolContext, type ViewerTools } from './viewer'
export { createImageTools, type ImageToolContext, type ImageTools } from './image'
