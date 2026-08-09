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
  type LoreMergeResult,
} from './LoreManagementService'

export {
  findDuplicateGroups,
  formatDuplicateGroup,
  normalizeName,
  type DuplicateGroup,
} from './duplicates'

export {
  cleanAliases,
  cleanKeywords,
  describeDropped,
  type CleanedField,
  type DroppedTerm,
} from './entryFields'
