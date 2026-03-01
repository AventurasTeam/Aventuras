/**
 * Vault Linking Tools
 *
 * Cross-entity linking tools for creating lorebook entries from character data.
 * Used by InteractiveVaultService.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { VaultCharacter, VaultLorebook } from '$lib/types'
import type { VaultPendingChange } from '../schemas/vault'
import { entryTypeSchema, injectionModeSchema } from '../schemas/lorebook'

/**
 * Context for vault linking tools.
 */
export interface VaultLinkingContext {
  /** Getter for current vault characters */
  characters: () => VaultCharacter[]
  /** Getter for current vault lorebooks */
  lorebooks: () => VaultLorebook[]
  /** Callback to register a pending change */
  onPendingChange: (change: VaultPendingChange) => void
  /** Generate unique ID for pending changes */
  generateId: () => string
}

/**
 * Create vault linking tools for cross-entity operations.
 */
export function createVaultLinkingTools(context: VaultLinkingContext) {
  const { characters, lorebooks, onPendingChange, generateId } = context

  return {
    /**
     * Auto-populate a lorebook entry from character data.
     * Creates an entry with name, description, and keywords derived from character traits.
     */
    link_character_to_lorebook: tool({
      description:
        'Create a lorebook entry automatically from a character. Auto-populates entry name, description, and keywords from the character traits and visual descriptors.',
      inputSchema: z.object({
        characterId: z.string().describe('ID of the character to create an entry from'),
        lorebookId: z.string().describe('ID of the lorebook to add the entry to'),
      }),
      execute: async ({ characterId, lorebookId }: { characterId: string; lorebookId: string }) => {
        const character = characters().find((c) => c.id === characterId)
        if (!character) {
          return { success: false, error: `Character with ID "${characterId}" not found` }
        }

        const lorebook = lorebooks().find((lb) => lb.id === lorebookId)
        if (!lorebook) {
          return { success: false, error: `Lorebook with ID "${lorebookId}" not found` }
        }

        // Build description from character data
        const descParts: string[] = []
        if (character.description) {
          descParts.push(character.description)
        }
        if (character.traits.length > 0) {
          descParts.push(`Traits: ${character.traits.join(', ')}`)
        }
        const vd = character.visualDescriptors
        const visualParts = [vd.face, vd.hair, vd.eyes, vd.build, vd.clothing].filter(Boolean)
        if (visualParts.length > 0) {
          descParts.push(`Appearance: ${visualParts.join('. ')}`)
        }

        // Build keywords from name and traits
        const keywords = [character.name, ...character.traits.slice(0, 5)]

        const changeId = generateId()
        const pendingChange: VaultPendingChange = {
          id: changeId,
          toolCallId: changeId,
          entityType: 'lorebook-entry',
          action: 'create',
          lorebookId,
          data: {
            name: character.name,
            type: 'character',
            description: descParts.join('\n\n') || character.name,
            keywords,
            aliases: [],
            injectionMode: 'keyword',
            priority: 50,
          },
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending lorebook entry for character "${character.name}" in "${lorebook.name}". Awaiting approval.`,
        }
      },
    }),

    /**
     * Create a customized lorebook entry from character data.
     * Allows the AI to customize the generated entry fields before proposing.
     */
    create_lorebook_entry_from_character: tool({
      description:
        'Create a lorebook entry from a character with custom field values. Use this when you want to customize the entry beyond the auto-populated defaults.',
      inputSchema: z.object({
        characterId: z.string().describe('ID of the source character'),
        lorebookId: z.string().describe('ID of the lorebook to add the entry to'),
        name: z.string().optional().describe('Custom entry name (defaults to character name)'),
        type: entryTypeSchema.optional().describe('Entry type (defaults to character)'),
        description: z.string().optional().describe('Custom description'),
        keywords: z.array(z.string()).optional().describe('Custom keywords'),
        aliases: z.array(z.string()).optional().default([]).describe('Custom aliases'),
        injectionMode: injectionModeSchema.optional().default('keyword').describe('Injection mode'),
        priority: z.number().optional().default(50).describe('Priority (0-100)'),
      }),
      execute: async ({
        characterId,
        lorebookId,
        name,
        type,
        description,
        keywords,
        aliases,
        injectionMode,
        priority,
      }: {
        characterId: string
        lorebookId: string
        name?: string
        type?: z.infer<typeof entryTypeSchema>
        description?: string
        keywords?: string[]
        aliases?: string[]
        injectionMode?: z.infer<typeof injectionModeSchema>
        priority?: number
      }) => {
        const character = characters().find((c) => c.id === characterId)
        if (!character) {
          return { success: false, error: `Character with ID "${characterId}" not found` }
        }

        const lorebook = lorebooks().find((lb) => lb.id === lorebookId)
        if (!lorebook) {
          return { success: false, error: `Lorebook with ID "${lorebookId}" not found` }
        }

        // Use provided values or fall back to character data
        const entryName = name ?? character.name
        const entryDescription =
          description ?? character.description ?? `Character: ${character.name}`
        const entryKeywords = keywords ?? [character.name, ...character.traits.slice(0, 5)]

        const changeId = generateId()
        const pendingChange: VaultPendingChange = {
          id: changeId,
          toolCallId: changeId,
          entityType: 'lorebook-entry',
          action: 'create',
          lorebookId,
          data: {
            name: entryName,
            type: type ?? 'character',
            description: entryDescription,
            keywords: entryKeywords,
            aliases: aliases ?? [],
            injectionMode: injectionMode ?? 'keyword',
            priority: priority ?? 50,
          },
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending lorebook entry "${entryName}" from character "${character.name}" in "${lorebook.name}". Awaiting approval.`,
        }
      },
    }),
  }
}

export type VaultLinkingTools = ReturnType<typeof createVaultLinkingTools>
