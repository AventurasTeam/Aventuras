/**
 * Lorebook Zod Schemas
 *
 * Shared schemas for lorebook-related tool definitions and validation.
 */

import { z } from 'zod'

/**
 * Entry type classification for lorebook entries.
 */
export const entryTypeSchema = z.enum([
  'character',
  'location',
  'item',
  'faction',
  'concept',
  'event',
])

export type EntryTypeSchema = z.infer<typeof entryTypeSchema>

/**
 * Injection mode for lorebook entries.
 * Determines when/how entries are injected into context.
 */
export const injectionModeSchema = z.enum([
  'always', // Always inject
  'keyword', // Inject when keywords match
  'never', // Disabled - not included in AI context
])

export type InjectionModeSchema = z.infer<typeof injectionModeSchema>

/**
 * Vault lorebook entry structure.
 * Matches the VaultLorebookEntry type from types/index.ts
 */
export const vaultLorebookEntrySchema = z.object({
  name: z.string().describe('The name/title of the lorebook entry'),
  type: entryTypeSchema.describe('The category of this entry'),
  description: z.string().describe('Detailed description of the entry'),
  keywords: z.array(z.string()).describe('Keywords that trigger this entry'),
  aliases: z.array(z.string()).describe('Alternative names for this entry'),
  injectionMode: injectionModeSchema.describe('When to inject this entry into context'),
  priority: z.number().describe('Injection priority (higher = more important)'),
})

export type VaultLorebookEntrySchema = z.infer<typeof vaultLorebookEntrySchema>

/**
 * Pending change types for the approval workflow.
 */
export const pendingChangeTypeSchema = z.enum(['create', 'update', 'delete', 'merge'])

export type PendingChangeTypeSchema = z.infer<typeof pendingChangeTypeSchema>

/**
 * Pending change structure for the approval workflow.
 * Represents a proposed change to a lorebook entry.
 */
export const lorebookEntryPendingChangeSchema = z.object({
  id: z.string().describe('Unique identifier for this pending change'),
  type: pendingChangeTypeSchema.describe('Type of change being proposed'),
  toolCallId: z.string().describe('ID of the tool call that created this change'),
  lorebookId: z.string().optional().describe('ID of the lorebook this entry belongs to'),
  entry: vaultLorebookEntrySchema.optional().describe('New entry for create/merge operations'),
  index: z.number().optional().describe('Target entry index for update/delete operations'),
  indices: z.array(z.number()).optional().describe('Entry indices for merge operations'),
  updates: vaultLorebookEntrySchema
    .partial()
    .optional()
    .describe('Partial updates for update operations'),
  previous: vaultLorebookEntrySchema.optional().describe('Previous entry state (for undo)'),
  previousEntries: z
    .array(vaultLorebookEntrySchema)
    .optional()
    .describe('Previous entries for merge (for undo)'),
  status: z.enum(['pending', 'approved', 'rejected']).describe('Approval status'),
})

export type LorebookEntryPendingChangeSchema = z.infer<typeof lorebookEntryPendingChangeSchema>

/**
 * Pending change structure for vault-level lorebook operations.
 */
export const vaultLorebookPendingChangeSchema = z.object({
  id: z.string().describe('Unique identifier for this pending change'),
  lorebookId: z.string().describe('ID of the lorebook'),
  type: z.enum(['create', 'update', 'delete']).describe('Type of change'),
  toolCallId: z.string().describe('ID of the tool call'),
  name: z.string().optional().describe('Lorebook name'),
  description: z.string().nullable().optional().describe('Lorebook description'),
  tags: z.array(z.string()).optional().describe('Lorebook tags'),
  status: z.enum(['pending', 'approved', 'rejected']).describe('Approval status'),
})

export type VaultLorebookPendingChangeSchema = z.infer<typeof vaultLorebookPendingChangeSchema>

/**
 * Tool result schemas for lorebook operations.
 */
export const entryListResultSchema = z.object({
  entries: z.array(
    z.object({
      index: z.number(),
      name: z.string(),
      type: entryTypeSchema,
      description: z.string(),
      keywords: z.array(z.string()),
    }),
  ),
  total: z.number(),
})

export const entryReadResultSchema = z.object({
  found: z.boolean(),
  entry: vaultLorebookEntrySchema.optional(),
  index: z.number().optional(),
})

export const entryChangeResultSchema = z.object({
  success: z.boolean(),
  pendingChange: lorebookEntryPendingChangeSchema.optional(),
  error: z.string().optional(),
})

/**
 * Finish lore management result schema.
 */
export const finishLoreManagementSchema = z.object({
  summary: z.string().describe('Summary of all changes made during this session'),
  entriesCreated: z.number().describe('Number of entries created'),
  entriesUpdated: z.number().describe('Number of entries updated'),
  entriesDeleted: z.number().describe('Number of entries deleted'),
  entriesMerged: z.number().describe('Number of merge operations performed'),
})

export type FinishLoreManagementSchema = z.infer<typeof finishLoreManagementSchema>

/**
 * Classification result for a single entry.
 */
export const entryClassificationSchema = z.object({
  index: z.number().describe('Index of the entry being classified'),
  type: entryTypeSchema.describe('The classified type for this entry'),
})

/**
 * Result from lorebook-classifier template.
 * Array of entry classifications.
 */
export const lorebookClassificationResultSchema = z.array(entryClassificationSchema)

export type EntryClassification = z.infer<typeof entryClassificationSchema>
export type LorebookClassificationResult = z.infer<typeof lorebookClassificationResultSchema>
