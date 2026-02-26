/**
 * Character CRUD Tools
 *
 * Tool definitions for vault character management.
 * Used by InteractiveVaultService.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { VaultCharacter } from '$lib/types'
import type { VaultPendingChange } from '../schemas/vault'
import { vaultCharacterInputSchema, visualDescriptorsSchema } from '../schemas'

/**
 * Context provided to character tools.
 */
export interface CharacterToolContext {
  /** Getter for current vault characters (live, not snapshot) */
  characters: () => VaultCharacter[]
  /** Callback to register a pending change */
  onPendingChange: (change: VaultPendingChange) => void
  /** Generate unique ID for pending changes */
  generateId: () => string
}

/**
 * Create character CRUD tools with the given context.
 */
export function createCharacterTools(context: CharacterToolContext) {
  const { characters, onPendingChange, generateId } = context

  return {
    /**
     * List all vault characters with optional filters.
     */
    list_characters: tool({
      description:
        'List all vault characters. Optionally filter by name search, tags, or favorites. Returns character summaries.',
      inputSchema: z.object({
        nameSearch: z
          .string()
          .optional()
          .describe('Filter characters whose name contains this text (case-insensitive)'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Filter characters that have all of these tags'),
        favoritesOnly: z.boolean().optional().describe('Only return favorited characters'),
      }),
      execute: async ({
        nameSearch,
        tags,
        favoritesOnly,
      }: {
        nameSearch?: string
        tags?: string[]
        favoritesOnly?: boolean
      }) => {
        let filtered = characters()

        if (nameSearch) {
          const search = nameSearch.toLowerCase()
          filtered = filtered.filter((c) => c.name.toLowerCase().includes(search))
        }

        if (tags && tags.length > 0) {
          filtered = filtered.filter((c) => tags.every((t) => c.tags.includes(t)))
        }

        if (favoritesOnly) {
          filtered = filtered.filter((c) => c.favorite)
        }

        return {
          characters: filtered.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description?.slice(0, 200) ?? null,
            traits: c.traits.slice(0, 5),
            tags: c.tags,
            favorite: c.favorite,
          })),
          total: filtered.length,
        }
      },
    }),

    /**
     * Read full details of a specific character by ID.
     */
    read_character: tool({
      description:
        'Read the full details of a vault character by ID. Use list_characters first to find character IDs.',
      inputSchema: z.object({
        characterId: z.string().describe('The ID of the character to read'),
      }),
      execute: async ({ characterId }: { characterId: string }) => {
        const character = characters().find((c) => c.id === characterId)

        if (!character) {
          return { found: false, error: `Character with ID "${characterId}" not found` }
        }

        return {
          found: true,
          character: {
            id: character.id,
            name: character.name,
            description: character.description,
            traits: character.traits,
            visualDescriptors: character.visualDescriptors,
            tags: character.tags,
            favorite: character.favorite,
            source: character.source,
          },
        }
      },
    }),

    /**
     * Create a new vault character.
     * Returns a pending change for approval workflow.
     */
    create_character: tool({
      description:
        'Propose a new vault character to be created. The change will be pending until approved.',
      inputSchema: z.object({
        name: z.string().describe('Character name'),
        description: z.string().nullable().describe('Brief character description'),
        traits: z.array(z.string()).describe('Personality traits'),
        visualDescriptors: visualDescriptorsSchema.describe('Visual appearance details'),
        tags: z.array(z.string()).optional().default([]).describe('Tags for organization'),
        favorite: z.boolean().optional().default(false).describe('Whether to favorite'),
      }),
      execute: async ({
        name,
        description,
        traits,
        visualDescriptors,
        tags,
        favorite,
      }: {
        name: string
        description: string | null
        traits: string[]
        visualDescriptors: z.infer<typeof visualDescriptorsSchema>
        tags?: string[]
        favorite?: boolean
      }) => {
        const changeId = generateId()
        const pendingChange: VaultPendingChange = {
          id: changeId,
          toolCallId: changeId,
          entityType: 'character',
          action: 'create',
          data: {
            name,
            description,
            traits,
            visualDescriptors,
            tags: tags ?? [],
            favorite: favorite ?? false,
          },
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending character "${name}". Awaiting approval.`,
        }
      },
    }),

    /**
     * Update an existing vault character.
     * Returns a pending change for approval workflow.
     */
    update_character: tool({
      description:
        'Propose an update to an existing vault character by ID. Only include fields you want to change. For tags and traits, prefer addTags/removeTags and addTraits/removeTraits for incremental changes. The change will be pending until approved.',
      inputSchema: z.object({
        characterId: z.string().describe('ID of the character to update'),
        name: z.string().optional().describe('New name'),
        description: z.string().nullable().optional().describe('New description'),
        replaceTraits: z
          .array(z.string())
          .optional()
          .describe('Complete replacement of all traits. Prefer addTraits/removeTraits instead'),
        addTraits: z.array(z.string()).optional().describe('Traits to add to the existing list'),
        removeTraits: z
          .array(z.string())
          .optional()
          .describe('Traits to remove from the existing list'),
        visualDescriptors: visualDescriptorsSchema
          .optional()
          .describe('New visual descriptors (FULLY replaces existing)'),
        replaceTags: z
          .array(z.string())
          .optional()
          .describe('Complete replacement of all tags. Prefer addTags/removeTags instead'),
        addTags: z.array(z.string()).optional().describe('Tags to add to the existing list'),
        removeTags: z
          .array(z.string())
          .optional()
          .describe('Tags to remove from the existing list'),
        favorite: z.boolean().optional().describe('New favorite status'),
      }),
      execute: async ({
        characterId,
        addTags,
        removeTags,
        addTraits,
        removeTraits,
        ...updates
      }: {
        characterId: string
        name?: string
        description?: string | null
        replaceTraits?: string[]
        addTraits?: string[]
        removeTraits?: string[]
        visualDescriptors?: z.infer<typeof visualDescriptorsSchema>
        replaceTags?: string[]
        addTags?: string[]
        removeTags?: string[]
        favorite?: boolean
      }) => {
        const character = characters().find((c) => c.id === characterId)

        if (!character) {
          return { success: false, error: `Character with ID "${characterId}" not found` }
        }

        // Resolve tags: explicit replacement wins, otherwise apply incremental ops
        let resolvedTags = character.tags
        if (updates.replaceTags !== undefined) {
          resolvedTags = updates.replaceTags
        } else {
          if (addTags?.length) {
            resolvedTags = [...new Set([...resolvedTags, ...addTags])]
          }
          if (removeTags?.length) {
            resolvedTags = resolvedTags.filter((t) => !removeTags.includes(t))
          }
        }

        // Resolve traits: same logic
        let resolvedTraits = character.traits
        if (updates.replaceTraits !== undefined) {
          resolvedTraits = updates.replaceTraits
        } else {
          if (addTraits?.length) {
            resolvedTraits = [...new Set([...resolvedTraits, ...addTraits])]
          }
          if (removeTraits?.length) {
            resolvedTraits = resolvedTraits.filter((t) => !removeTraits.includes(t))
          }
        }

        const previous = {
          name: character.name,
          description: character.description,
          traits: character.traits,
          visualDescriptors: character.visualDescriptors,
          tags: character.tags,
          favorite: character.favorite,
        }

        // Build full data: start from previous, apply scalar updates, then resolved arrays
        // Strip tool-only keys that aren't real schema fields
        const { replaceTags: _rt, replaceTraits: _rtr, ...scalarUpdates } = updates
        const cleanUpdates = Object.fromEntries(
          Object.entries(scalarUpdates).filter(([_, v]) => v !== undefined),
        ) as Partial<z.infer<typeof vaultCharacterInputSchema>>

        const changeId = generateId()
        const pendingChange: VaultPendingChange = {
          id: changeId,
          toolCallId: changeId,
          entityType: 'character',
          action: 'update',
          entityId: characterId,
          data: { ...previous, ...cleanUpdates, tags: resolvedTags, traits: resolvedTraits },
          previous,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending update for "${character.name}". Awaiting approval.`,
        }
      },
    }),

    /**
     * Delete a vault character.
     * Returns a pending change for approval workflow.
     */
    delete_character: tool({
      description:
        'Propose to delete a vault character by ID. The change will be pending until approved.',
      inputSchema: z.object({
        characterId: z.string().describe('ID of the character to delete'),
        reason: z.string().optional().describe('Reason for deletion'),
      }),
      execute: async ({ characterId, reason }: { characterId: string; reason?: string }) => {
        const character = characters().find((c) => c.id === characterId)

        if (!character) {
          return { success: false, error: `Character with ID "${characterId}" not found` }
        }

        const changeId = generateId()
        const pendingChange: VaultPendingChange = {
          id: changeId,
          toolCallId: changeId,
          entityType: 'character',
          action: 'delete',
          entityId: characterId,
          previous: {
            name: character.name,
            description: character.description,
            traits: character.traits,
            visualDescriptors: character.visualDescriptors,
            tags: character.tags,
            favorite: character.favorite,
          },
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending deletion for "${character.name}"${reason ? ` (${reason})` : ''}. Awaiting approval.`,
        }
      },
    }),
  }
}

export type CharacterTools = ReturnType<typeof createCharacterTools>
