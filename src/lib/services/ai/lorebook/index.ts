/**
 * AI Lorebook Module
 *
 * AI-powered lorebook management services:
 * - LoreManagement: Autonomous agent for lorebook maintenance and updates
 */

export {
  LoreManagementService,
  type LoreManagementResult,
  type LoreManagementContext,
} from './LoreManagementService'

export { LoreSessionLedger, type LoreMergeResult, type LoreSessionChanges } from './sessionChanges'

export {
  cleanAliases,
  cleanKeywords,
  describeDropped,
  type CleanedField,
  type DroppedTerm,
} from './entryFields'
