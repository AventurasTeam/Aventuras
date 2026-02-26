/**
 * Vault Pending Change Schemas
 *
 * Discriminated union schemas for all vault entity types (character, lorebook-entry, scenario)
 * used in the interactive vault assistant approval workflow.
 */

import { z } from 'zod'
import { visualDescriptorsSchema } from './classifier'
import { vaultLorebookEntrySchema } from './lorebook'

// ============================================================================
// Character Input Schema
// ============================================================================

export const vaultCharacterInputSchema = z.object({
  name: z.string().describe('Character name'),
  description: z.string().nullable().describe('Brief character description'),
  traits: z.array(z.string()).describe('Personality traits'),
  visualDescriptors: visualDescriptorsSchema.describe(
    'Visual appearance details for image generation',
  ),
  portrait: z.string().nullable().optional().describe('Portrait data URL (usually not set by AI)'),
  tags: z.array(z.string()).describe('Tags for organization'),
  favorite: z.boolean().optional().describe('Whether this character is favorited'),
})

export type VaultCharacterInput = z.infer<typeof vaultCharacterInputSchema>

// ============================================================================
// Scenario NPC Schema
// ============================================================================

export const vaultScenarioNpcSchema = z.object({
  name: z.string().describe('NPC name'),
  role: z.string().describe('Role in the scenario (e.g., antagonist, mentor, shopkeeper)'),
  description: z.string().describe('Brief description of the NPC'),
  relationship: z.string().describe('Relationship to the protagonist'),
  traits: z.array(z.string()).describe('Personality traits'),
})

export type VaultScenarioNpc = z.infer<typeof vaultScenarioNpcSchema>

// ============================================================================
// Scenario Input Schema
// ============================================================================

export const vaultScenarioInputSchema = z.object({
  name: z.string().describe('Scenario name'),
  description: z.string().nullable().describe('Brief scenario description'),
  settingSeed: z.string().describe('Setting seed text that describes the world and context'),
  npcs: z.array(vaultScenarioNpcSchema).describe('Non-player characters in the scenario'),
  primaryCharacterName: z.string().describe('Name of the primary character / protagonist'),
  firstMessage: z.string().nullable().optional().describe('Opening message for the scenario'),
  alternateGreetings: z.array(z.string()).optional().describe('Alternative opening messages'),
  tags: z.array(z.string()).describe('Tags for organization'),
  favorite: z.boolean().optional().describe('Whether this scenario is favorited'),
})

export type VaultScenarioInput = z.infer<typeof vaultScenarioInputSchema>

// ============================================================================
// Vault Pending Change — Discriminated Union
// ============================================================================

const vaultChangeStatusSchema = z.enum(['pending', 'approved', 'rejected'])

const baseChangeFields = {
  id: z.string().describe('Unique identifier for this pending change'),
  toolCallId: z.string().describe('ID of the tool call that created this change'),
  status: vaultChangeStatusSchema.describe('Approval status'),
}

// --- Character changes ---

const characterCreateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('character'),
  action: z.literal('create'),
  data: vaultCharacterInputSchema.describe('Character data to create'),
})

const characterUpdateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('character'),
  action: z.literal('update'),
  entityId: z.string().describe('ID of the character to update'),
  data: vaultCharacterInputSchema.partial().describe('Partial character updates'),
  previous: vaultCharacterInputSchema.optional().describe('Previous character state (for undo)'),
})

const characterDeleteSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('character'),
  action: z.literal('delete'),
  entityId: z.string().describe('ID of the character to delete'),
  previous: vaultCharacterInputSchema.optional().describe('Previous character state (for undo)'),
})

// --- Lorebook changes ---

export const vaultLorebookInputSchema = z.object({
  name: z.string().describe('Lorebook name'),
  description: z.string().nullable().describe('Brief lorebook description'),
  tags: z.array(z.string()).describe('Tags for organization'),
})

export type VaultLorebookInput = z.infer<typeof vaultLorebookInputSchema>

const lorebookCreateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook'),
  action: z.literal('create'),
  entityId: z.string().describe('ID of the lorebook to create'),
  data: vaultLorebookInputSchema.describe('Lorebook data to create'),
})

const lorebookUpdateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook'),
  action: z.literal('update'),
  entityId: z.string().describe('ID of the lorebook to update'),
  data: vaultLorebookInputSchema.partial().describe('Partial lorebook updates'),
  previous: vaultLorebookInputSchema.optional().describe('Previous lorebook state (for undo)'),
})

const lorebookDeleteSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook'),
  action: z.literal('delete'),
  entityId: z.string().describe('ID of the lorebook to delete'),
  previous: vaultLorebookInputSchema.optional().describe('Previous lorebook state (for undo)'),
})

// --- Lorebook entry changes ---

const lorebookEntryCreateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook-entry'),
  action: z.literal('create'),
  lorebookId: z.string().describe('ID of the lorebook to add the entry to'),
  data: vaultLorebookEntrySchema.describe('Entry data to create'),
})

const lorebookEntryUpdateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook-entry'),
  action: z.literal('update'),
  lorebookId: z.string().describe('ID of the lorebook containing the entry'),
  entryIndex: z.number().describe('Index of the entry to update'),
  data: vaultLorebookEntrySchema.partial().describe('Partial entry updates'),
  previous: vaultLorebookEntrySchema.optional().describe('Previous entry state (for undo)'),
})

const lorebookEntryDeleteSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook-entry'),
  action: z.literal('delete'),
  lorebookId: z.string().describe('ID of the lorebook containing the entry'),
  entryIndex: z.number().describe('Index of the entry to delete'),
  previous: vaultLorebookEntrySchema.optional().describe('Previous entry state (for undo)'),
})

const lorebookEntryMergeSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('lorebook-entry'),
  action: z.literal('merge'),
  lorebookId: z.string().describe('ID of the lorebook containing the entries'),
  entryIndices: z.array(z.number()).describe('Indices of entries to merge'),
  data: vaultLorebookEntrySchema.describe('Merged entry result'),
  previousEntries: z
    .array(vaultLorebookEntrySchema)
    .optional()
    .describe('Previous entries being merged (for undo)'),
})

// --- Scenario changes ---

const scenarioCreateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('scenario'),
  action: z.literal('create'),
  data: vaultScenarioInputSchema.describe('Scenario data to create'),
})

const scenarioUpdateSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('scenario'),
  action: z.literal('update'),
  entityId: z.string().describe('ID of the scenario to update'),
  data: vaultScenarioInputSchema.partial().describe('Partial scenario updates'),
  previous: vaultScenarioInputSchema.optional().describe('Previous scenario state (for undo)'),
})

const scenarioDeleteSchema = z.object({
  ...baseChangeFields,
  entityType: z.literal('scenario'),
  action: z.literal('delete'),
  entityId: z.string().describe('ID of the scenario to delete'),
  previous: vaultScenarioInputSchema.optional().describe('Previous scenario state (for undo)'),
})

// --- Discriminated union ---

export const vaultPendingChangeSchema = z.union([
  // Character
  characterCreateSchema,
  characterUpdateSchema,
  characterDeleteSchema,
  // Lorebook
  lorebookCreateSchema,
  lorebookUpdateSchema,
  lorebookDeleteSchema,
  // Lorebook entry
  lorebookEntryCreateSchema,
  lorebookEntryUpdateSchema,
  lorebookEntryDeleteSchema,
  lorebookEntryMergeSchema,
  // Scenario
  scenarioCreateSchema,
  scenarioUpdateSchema,
  scenarioDeleteSchema,
])

export type VaultPendingChange = z.infer<typeof vaultPendingChangeSchema>

// ============================================================================
// Change Result Schema (tool response shape)
// ============================================================================

export const vaultChangeResultSchema = z.object({
  success: z.boolean(),
  pendingChange: vaultPendingChangeSchema.optional(),
  message: z.string().optional(),
})

export type VaultChangeResult = z.infer<typeof vaultChangeResultSchema>
