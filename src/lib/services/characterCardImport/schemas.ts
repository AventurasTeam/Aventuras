/**
 * Card Import Schemas
 *
 * Zod schemas for SillyTavern character card import operations.
 */

import { z } from 'zod'
import { visualDescriptorsSchema } from '$lib/services/ai/sdk/schemas/classifier'

/**
 * NPC extracted from character card.
 * Maps to the character-card-import template output.
 */
export const cardImportNpcSchema = z.object({
  name: z.string().describe("Character's actual name"),
  role: z
    .string()
    .describe("Character's role (ally, mentor, antagonist, love interest, guide, friend)"),
  description: z.string().describe('1-2 sentences: who they are and key appearance details'),
  personality: z.string().describe('Key personality traits as comma-separated list'),
  relationship: z.string().describe('Their relationship to the protagonist'),
})

/**
 * Result from character-card-import template.
 * Cleans SillyTavern cards and converts to Aventura scenario settings.
 */
export const cardImportResultSchema = z.object({
  primaryCharacterName: z
    .string()
    .describe('The ACTUAL name of the main character that {{char}} refers to'),
  settingSeed: z
    .string()
    .describe('The FULL cleaned text with {{char}} replaced, {{user}} kept as-is'),
  npcs: z.array(cardImportNpcSchema).describe('All significant characters from the card'),
})

/**
 * Result from vault-character-import template.
 * Extracts clean character data for the vault.
 */
export const vaultCharacterImportSchema = z.object({
  name: z.string().describe("The character's actual name"),
  description: z.string().describe('1-2 paragraphs describing who this character is'),
  traits: z.array(z.string()).describe('3-8 personality traits'),
  visualDescriptors: visualDescriptorsSchema.describe(
    'Physical appearance details for image generation',
  ),
})
