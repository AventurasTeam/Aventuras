/**
 * Lorebook CRUD Tools
 *
 * Tool definitions for lorebook entry management.
 * These tools are used by LoreManagementService and InteractiveVaultService.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { VaultLorebook, VaultLorebookEntry } from '$lib/types'
import {
  entryTypeSchema,
  injectionModeSchema,
  vaultLorebookEntrySchema,
  type LorebookEntryPendingChangeSchema,
  type VaultLorebookPendingChangeSchema,
} from '../schemas/lorebook'

export type { VaultLorebookPendingChangeSchema }

/**
 * Context provided to lorebook tools.
 * Tools are factory functions that capture this context.
 */
export interface LorebookEntryToolContext {
  /** Current entries in the lorebook */
  entries: VaultLorebookEntry[]
  /** Callback to register a pending change */
  onPendingChange: (change: LorebookEntryPendingChangeSchema) => void
  /** Generate unique ID for pending changes */
  generateId: () => string
  /**
   * Optional getter for arbitrary lorebook entries.
   * Required if tools are allowed to access lorebooks other than the bound 'entries'.
   */
  getLorebookEntries?: (lorebookId: string) => VaultLorebookEntry[] | undefined
}

/**
 * Create lorebook tools with the given context.
 * Each invocation creates fresh tools bound to the current entries.
 */
function createLorebookEntryTools(context: LorebookEntryToolContext) {
  const { entries, onPendingChange, generateId, getLorebookEntries } = context

  return {
    /**
     * List all lorebook entries with optional type filter.
     */
    list_entries: tool({
      description:
        'List all lorebook entries. Optionally filter by type. Returns entry summaries with indices for further operations.',
      inputSchema: z.object({
        lorebookId: z.string().optional().describe('ID of the lorebook to list entries from'),
        type: entryTypeSchema
          .optional()
          .describe('Filter entries by type (character, location, item, faction, concept, event)'),
      }),
      execute: async ({
        lorebookId,
        type,
      }: {
        lorebookId?: string
        type?: z.infer<typeof entryTypeSchema>
      }) => {
        let targetEntries = entries

        if (lorebookId) {
          if (!getLorebookEntries) {
            return {
              entries: [],
              total: 0,
              error: 'Global lorebook access not available in this context',
            }
          }
          const found = getLorebookEntries(lorebookId)
          if (!found) {
            return {
              entries: [],
              total: 0,
              error: `Lorebook with ID "${lorebookId}" not found`,
            }
          }
          targetEntries = found
        }

        let filtered = targetEntries

        if (type) {
          filtered = filtered.filter((e) => e.type === type)
        }

        return {
          entries: filtered.map((e) => {
            // Find original index in full entries array
            const originalIndex = entries.indexOf(e)
            return {
              index: originalIndex,
              name: e.name,
              type: e.type,
              description: e.description.slice(0, 200) + (e.description.length > 200 ? '...' : ''),
              keywords: e.keywords.slice(0, 5),
            }
          }),
          total: filtered.length,
        }
      },
    }),

    /**
     * Read full details of a specific entry by index.
     */
    read_entry: tool({
      description:
        'Read the full details of a lorebook entry by its index. Use list_entries first to find entry indices.',
      inputSchema: z.object({
        lorebookId: z.string().optional().describe('ID of the lorebook to read from'),
        index: z.number().describe('The index of the entry to read (from list_entries)'),
      }),
      execute: async ({ lorebookId, index }: { lorebookId?: string; index: number }) => {
        let targetEntries = entries

        if (lorebookId) {
          if (!getLorebookEntries) {
            return {
              found: false,
              error: 'Global lorebook access not available in this context',
            }
          }
          const found = getLorebookEntries(lorebookId)
          if (!found) {
            return {
              found: false,
              error: `Lorebook with ID "${lorebookId}" not found`,
            }
          }
          targetEntries = found
        }

        if (index < 0 || index >= targetEntries.length) {
          return {
            found: false,
            error: `Entry index ${index} out of range (0-${entries.length - 1})`,
          }
        }

        return {
          found: true,
          index,
          entry: targetEntries[index],
        }
      },
    }),

    /**
     * Create a new lorebook entry.
     * Returns a pending change for approval workflow.
     */
    create_entry: tool({
      description: 'Create a new lorebook entry. The change will be pending until approved.',
      inputSchema: z.object({
        lorebookId: z
          .string()
          .optional()
          .describe('ID of the target lorebook (required if not in a specific lorebook context)'),
        name: z.string().describe('Name of the entry'),
        type: entryTypeSchema.describe('Type of entry'),
        description: z.string().describe('Full description of the entry'),
        keywords: z.array(z.string()).describe('Keywords that will trigger this entry'),
        aliases: z
          .array(z.string())
          .optional()
          .default([])
          .describe('Alternative names for this entry'),
        injectionMode: injectionModeSchema
          .optional()
          .default('keyword')
          .describe('When to inject (default: keyword)'),
        priority: z
          .number()
          .optional()
          .default(50)
          .describe('Injection priority 0-100 (default: 50)'),
      }),
      execute: async ({
        lorebookId,
        name,
        type,
        description,
        keywords,
        aliases,
        injectionMode,
        priority,
      }: {
        lorebookId?: string
        name: string
        type: z.infer<typeof entryTypeSchema>
        description: string
        keywords: string[]
        aliases?: string[]
        injectionMode?: z.infer<typeof injectionModeSchema>
        priority?: number
      }) => {
        // Validation: require lorebookId if not bound?
        // Actually, if we are in InteractiveMode, we might not have 'entries' bound at all
        // but we can't easily check that without checking entries.length which might be 0 anyway.
        // Best effort: if lorebookId is provided, use it.

        if (lorebookId && getLorebookEntries) {
          if (!getLorebookEntries(lorebookId)) {
            return {
              success: false,
              error: `Lorebook with ID "${lorebookId}" not found`,
            }
          }
        }
        const newEntry: VaultLorebookEntry = {
          name,
          type,
          description,
          keywords,
          aliases: aliases ?? [],
          injectionMode: injectionMode ?? 'keyword',
          priority: priority ?? 50,
        }

        const changeId = generateId()
        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'create',
          toolCallId: changeId,
          lorebookId,
          entry: newEntry,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending entry "${name}" (${type}). Awaiting approval.`,
        }
      },
    }),

    /**
     * Update an existing lorebook entry.
     * Returns a pending change for approval workflow.
     */
    update_entry: tool({
      description:
        'Update an existing lorebook entry by index. Only include fields you want to change. The change will be pending until approved.',
      inputSchema: z.object({
        lorebookId: z.string().optional().describe('ID of the lorebook containing the entry'),
        index: z.number().describe('Index of the entry to update'),
        name: z.string().optional().describe('New name'),
        type: entryTypeSchema.optional().describe('New type'),
        description: z.string().optional().describe('New description'),
        keywords: z.array(z.string()).optional().describe('New keywords (replaces existing)'),
        aliases: z.array(z.string()).optional().describe('New aliases (replaces existing)'),
        injectionMode: injectionModeSchema.optional().describe('New injection mode'),
        priority: z.number().optional().describe('New priority'),
      }),
      execute: async ({
        lorebookId,
        index,
        ...updates
      }: {
        lorebookId?: string
        index: number
        name?: string
        type?: z.infer<typeof entryTypeSchema>
        description?: string
        keywords?: string[]
        aliases?: string[]
        injectionMode?: z.infer<typeof injectionModeSchema>
        priority?: number
      }) => {
        let targetEntries = entries

        if (lorebookId) {
          if (!getLorebookEntries) {
            return {
              success: false,
              error: 'Global lorebook access not available in this context',
            }
          }
          const found = getLorebookEntries(lorebookId)
          if (!found) {
            return {
              success: false,
              error: `Lorebook with ID "${lorebookId}" not found`,
            }
          }
          targetEntries = found
        }

        if (index < 0 || index >= targetEntries.length) {
          return {
            success: false,
            error: `Entry index ${index} out of range (0-${entries.length - 1})`,
          }
        }

        const previous = targetEntries[index]
        const changeId = generateId()

        // Filter out undefined values
        const cleanUpdates = Object.fromEntries(
          Object.entries(updates).filter(([_, v]) => v !== undefined),
        ) as Partial<VaultLorebookEntry>

        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'update',
          toolCallId: changeId,
          lorebookId,
          index,
          updates: cleanUpdates,
          previous,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending update for "${previous.name}". Awaiting approval.`,
        }
      },
    }),

    /**
     * Delete a lorebook entry.
     * Returns a pending change for approval workflow.
     */
    delete_entry: tool({
      description: 'Delete a lorebook entry by index. The change will be pending until approved.',
      inputSchema: z.object({
        lorebookId: z.string().optional().describe('ID of the lorebook containing the entry'),
        index: z.number().describe('Index of the entry to delete'),
        reason: z.string().optional().describe('Reason for deletion'),
      }),
      execute: async ({
        lorebookId,
        index,
        reason,
      }: {
        lorebookId?: string
        index: number
        reason?: string
      }) => {
        let targetEntries = entries

        if (lorebookId) {
          if (!getLorebookEntries) {
            return {
              success: false,
              error: 'Global lorebook access not available in this context',
            }
          }
          const found = getLorebookEntries(lorebookId)
          if (!found) {
            return {
              success: false,
              error: `Lorebook with ID "${lorebookId}" not found`,
            }
          }
          targetEntries = found
        }

        if (index < 0 || index >= targetEntries.length) {
          return {
            success: false,
            error: `Entry index ${index} out of range (0-${entries.length - 1})`,
          }
        }

        const previous = targetEntries[index]
        const changeId = generateId()

        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'delete',
          toolCallId: changeId,
          lorebookId,
          index,
          previous,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending deletion for "${previous.name}"${reason ? ` (${reason})` : ''}. Awaiting approval.`,
        }
      },
    }),

    /**
     * Merge multiple entries into one.
     * Returns a pending change for approval workflow.
     */
    merge_entries: tool({
      description:
        'Merge multiple lorebook entries into a single entry. Useful for consolidating duplicate or related entries. The change will be pending until approved.',
      inputSchema: z.object({
        lorebookId: z.string().optional().describe('ID of the lorebook containing the entries'),
        indices: z.array(z.number()).min(2).describe('Indices of entries to merge (at least 2)'),
        mergedEntry: vaultLorebookEntrySchema.describe('The resulting merged entry'),
      }),
      execute: async ({
        lorebookId,
        indices,
        mergedEntry,
      }: {
        lorebookId?: string
        indices: number[]
        mergedEntry: VaultLorebookEntry
      }) => {
        let targetEntries = entries

        if (lorebookId) {
          if (!getLorebookEntries) {
            return {
              success: false,
              error: 'Global lorebook access not available in this context',
            }
          }
          const found = getLorebookEntries(lorebookId)
          if (!found) {
            return {
              success: false,
              error: `Lorebook with ID "${lorebookId}" not found`,
            }
          }
          targetEntries = found
        }

        // Validate all indices
        for (const idx of indices) {
          if (idx < 0 || idx >= targetEntries.length) {
            return {
              success: false,
              error: `Entry index ${idx} out of range (0-${targetEntries.length - 1})`,
            }
          }
        }

        // Check for duplicates
        const uniqueIndices = [...new Set(indices)]
        if (uniqueIndices.length !== indices.length) {
          return {
            success: false,
            error: 'Duplicate indices provided',
          }
        }

        const previousEntries = indices.map((i) => targetEntries[i])
        const changeId = generateId()

        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'merge',
          toolCallId: changeId,
          indices: uniqueIndices,
          lorebookId,
          entry: mergedEntry,
          previousEntries,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        const names = previousEntries.map((e) => e.name).join(', ')
        return {
          success: true,
          pendingChange,
          message: `Created pending merge of [${names}] into "${mergedEntry.name}". Awaiting approval.`,
        }
      },
    }),
  }
}
export type LorebookEntryTools = ReturnType<typeof createLorebookEntryTools>

/**
 * Chapter info for lore management context.
 */
export interface ChapterInfo {
  number: number
  title: string | null
  summary: string
  keywords?: string[]
  characters?: string[]
}
export interface StoryToolContext {
  /** Available chapters for querying */
  chapters?: ChapterInfo[]
  /** Callback to query a chapter with a question */
  queryChapter?: (chapterNumber: number, question: string) => Promise<string>
}

/**
 * Story and Session Tools
 *
 * Includes chapter querying and session completion tools.
 */
function createStoryTools(context: StoryToolContext) {
  const { chapters, queryChapter } = context

  return {
    /**
     * List available chapters for querying.
     */
    list_chapters: tool({
      description:
        'List all available chapters with their summaries. Use this to understand the story timeline before making lore updates.',
      inputSchema: z.object({
        limit: z.number().optional().default(20).describe('Maximum chapters to return'),
      }),
      execute: async ({ limit }: { limit?: number }) => {
        if (!chapters || chapters.length === 0) {
          return { chapters: [], total: 0, message: 'No chapters available' }
        }
        const limitedChapters = chapters.slice(0, limit ?? 20)
        return {
          chapters: limitedChapters.map((ch) => ({
            number: ch.number,
            title: ch.title,
            summary: ch.summary.slice(0, 500) + (ch.summary.length > 500 ? '...' : ''),
            keywords: ch.keywords,
            characters: ch.characters,
          })),
          total: chapters.length,
        }
      },
    }),

    /**
     * Ask a question about a specific chapter.
     */
    query_chapter: tool({
      description:
        'Ask a specific question about a chapter to understand story events for lore updates. Ask targeted questions like "What did [character] do?" or "What was revealed about [item]?"',
      inputSchema: z.object({
        chapterNumber: z.number().describe('The chapter number to query'),
        question: z.string().describe('A specific question about the chapter content'),
      }),
      execute: async ({ chapterNumber, question }: { chapterNumber: number; question: string }) => {
        if (!chapters || chapters.length === 0) {
          return { found: false, error: 'No chapters available' }
        }

        const chapter = chapters.find((ch) => ch.number === chapterNumber)
        if (!chapter) {
          return { found: false, error: `Chapter ${chapterNumber} not found` }
        }

        let answer: string | undefined
        if (queryChapter) {
          try {
            answer = await queryChapter(chapterNumber, question)
          } catch {
            // Query failed, return summary only
          }
        }

        return {
          found: true,
          chapter: {
            number: chapter.number,
            title: chapter.title,
            summary: chapter.summary,
          },
          question,
          answer: answer ?? 'Unable to answer - using summary only',
        }
      },
    }),

    /**
     * Terminal tool to finish lore management session.
     * Signals completion of the agentic loop.
     */
    finish_lore_management: tool({
      description:
        'Call this when you have finished reviewing and updating the lorebook. Provide a summary of all changes made.',
      inputSchema: z.object({
        summary: z.string().describe('Summary of all changes made during this session'),
        entriesCreated: z.number().describe('Number of entries created'),
        entriesUpdated: z.number().describe('Number of entries updated'),
        entriesDeleted: z.number().describe('Number of entries deleted'),
        entriesMerged: z.number().describe('Number of merge operations performed'),
      }),
      execute: async (args: {
        summary: string
        entriesCreated: number
        entriesUpdated: number
        entriesDeleted: number
        entriesMerged: number
      }) => {
        // This tool's execution is a signal to stop the agent loop
        return {
          completed: true,
          ...args,
        }
      },
    }),
  }
}
export type StoryTools = ReturnType<typeof createStoryTools>

export type LoreManagementToolContext = LorebookEntryToolContext & StoryToolContext
/**
 * Specialized lorebook tools for Lore Management Service.
 * Includes all entry management and chapter querying tools.
 * Excludes browsing tools (managing the entire vault).
 */
export function createLoreManagementTools(context: LoreManagementToolContext) {
  return {
    ...createLorebookEntryTools(context),
    ...createStoryTools(context),
  }
}
export type LoreManagementTools = ReturnType<typeof createLoreManagementTools>

/**
 * Context for vault-level lorebook browsing tools.
 * Provides access to all lorebooks in the vault (not entries within one).
 */
export interface VaultLorebookToolContext {
  /** Getter for all vault lorebooks (live, not snapshot) */
  lorebooks: () => VaultLorebook[]
  /** Callback to register a pending change for vault-level operations */
  onPendingChange?: (change: VaultLorebookPendingChangeSchema) => void
  /** Generate unique ID for pending changes */
  generateId?: () => string
}

/**
 * Create vault-level lorebook browsing tools.
 * These complement the existing entry-level tools by providing
 * cross-lorebook visibility.
 */
function createVaultLorebookTools(context: VaultLorebookToolContext) {
  const { lorebooks, onPendingChange, generateId } = context

  return {
    /**
     * Create a new empty lorebook in the vault.
     */
    create_lorebook: tool({
      description: 'Create a new empty lorebook in the vault.',
      inputSchema: z.object({
        name: z.string().describe('Name of the lorebook'),
        description: z.string().optional().describe('Brief description of the lorebook'),
        tags: z.array(z.string()).optional().default([]).describe('Tags for organization'),
      }),
      execute: async ({ name, description, tags }) => {
        if (!onPendingChange || !generateId) {
          return { success: false, error: 'Context does not support lorebook creation' }
        }

        const changeId = generateId()
        const lorebookId = crypto.randomUUID()
        const pendingChange: VaultLorebookPendingChangeSchema = {
          id: changeId,
          lorebookId,
          toolCallId: changeId,
          type: 'create',
          status: 'pending',
          name,
          description: description ?? null,
          tags: tags ?? [],
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          pendingChange,
          message: `Created pending lorebook "${name}". ID: "${lorebookId}".`,
        }
      },
    }),

    /**
     * List all vault lorebooks with summaries.
     */
    list_lorebooks: tool({
      description:
        'List all lorebooks in the vault with summaries including name, entry count, type breakdown, and tags.',
      inputSchema: z.object({}),
      execute: async () => {
        const all = lorebooks()
        return {
          lorebooks: all.map((lb) => {
            const entryBreakdown: Record<string, number> = {}
            for (const entry of lb.entries) {
              entryBreakdown[entry.type] = (entryBreakdown[entry.type] ?? 0) + 1
            }

            return {
              id: lb.id,
              name: lb.name,
              description: lb.description?.slice(0, 200) ?? null,
              entryCount: lb.entries.length,
              entryBreakdown,
              tags: lb.tags,
              favorite: lb.favorite,
            }
          }),
          total: all.length,
        }
      },
    }),

    /**
     * Read a lorebook's metadata and entry list without full descriptions.
     */
    read_lorebook_summary: tool({
      description:
        "Read a lorebook's metadata and entry list. Returns entry names, types, and keywords without full descriptions. Use read_entry for full details.",
      inputSchema: z.object({
        lorebookId: z.string().describe('The ID of the lorebook to read'),
      }),
      execute: async ({ lorebookId }: { lorebookId: string }) => {
        const lorebook = lorebooks().find((lb) => lb.id === lorebookId)

        if (!lorebook) {
          return { found: false, error: `Lorebook with ID "${lorebookId}" not found` }
        }

        return {
          found: true,
          lorebook: {
            id: lorebook.id,
            name: lorebook.name,
            description: lorebook.description,
            tags: lorebook.tags,
            favorite: lorebook.favorite,
            source: lorebook.source,
            entryCount: lorebook.entries.length,
            entries: lorebook.entries.map((e, index) => ({
              index,
              name: e.name,
              type: e.type,
              keywords: e.keywords,
              injectionMode: e.injectionMode,
            })),
          },
        }
      },
    }),
  }
}
export type VaultLorebookTools = ReturnType<typeof createVaultLorebookTools>

/**
 * Specialized lorebook tools for Interactive Vault Assistant.
 * Includes browsing (list/summary) and entry management (list/read/create/update/delete/merge).
 * Excludes creation of new lorebooks (browsing context), chapter querying, and terminal tools.
 */
export function createInteractiveVaultLorebookTools(
  vaultContext: VaultLorebookToolContext,
  entryContext?: LorebookEntryToolContext,
) {
  const vaultTools = createVaultLorebookTools(vaultContext)

  if (!entryContext) {
    return vaultTools
  }

  const entryTools = createLorebookEntryTools(entryContext)

  return {
    ...vaultTools,
    ...entryTools,
  }
}
export type InteractiveVaultLorebookTools = ReturnType<typeof createInteractiveVaultLorebookTools>
