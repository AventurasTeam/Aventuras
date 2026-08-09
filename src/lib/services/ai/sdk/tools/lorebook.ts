/**
 * Lorebook CRUD Tools
 *
 * Tool definitions for lorebook entry management.
 * These tools are used by LoreManagementService and InteractiveVaultService.
 */

import { tool } from 'ai'
import * as z from 'zod'
import type { VaultLorebook, VaultLorebookEntry } from '$lib/types'
import {
  entryTypeSchema,
  injectionModeSchema,
  vaultLorebookEntrySchema,
  type LorebookEntryPendingChangeSchema,
  type VaultLorebookPendingChangeSchema,
} from '../schemas/lorebook'
import { entityNameMatches, foldName } from '$lib/utils/text'
import type { ChapterQueryBudget } from './chapterQueries'
import { cleanAliases, cleanKeywords, describeDropped } from '../../lorebook/entryFields'

export type { VaultLorebookPendingChangeSchema }

/**
 * Context provided to lorebook tools.
 * Tools are factory functions that capture this context.
 */
export interface LorebookEntryToolContext {
  /** Current entries in the lorebook */
  entries: VaultLorebookEntry[]
  /** The ID of the lorebook these entries belong to, if bound */
  activeLorebookId?: string
  /** Callback to register a pending change */
  onPendingChange: (change: LorebookEntryPendingChangeSchema) => void
  /** Generate unique ID for pending changes */
  generateId: () => string
  /**
   * Optional getter for arbitrary lorebook entries.
   * Required if tools are allowed to access lorebooks other than the bound 'entries'.
   */
  getLorebookEntries?: (lorebookId: string) => VaultLorebookEntry[] | undefined
  /**
   * Indices of `entries` removed earlier in this session.
   *
   * Splicing would shift every index the model already holds, so the slot stays and is
   * listed here — hidden from `list_entries`, refused by everything that takes an index.
   */
  removedIndices?: Set<number>
  /**
   * Refuse `create_entry` for a name that already exists.
   *
   * On for unattended callers, where nothing else catches a model re-creating the same
   * character every run; off for the vault, where a human reads the change first.
   */
  preventDuplicateNames?: boolean
}

/**
 * Ceiling on one `list_entries` result — the same allowance `search_entries` gives the
 * retrieval agent, for the same reason: a tool result lives in the prompt for the rest of
 * the run, so an unbounded listing is paid for on every step after it.
 */
const MAX_LIST_ENTRIES = 20

/**
 * Case- and punctuation-insensitive match on a name or any of its aliases.
 *
 * `foldName`, not the duplicate detector's `normalizeName`: this powers a hard refusal, so
 * it must not strip leading articles. `normalizeName` is lenient on purpose and would read
 * "De Luca" as "Luca", refusing a legitimate entry and pointing at an unrelated one.
 */
function matchesName(entry: VaultLorebookEntry, folded: string): boolean {
  return [entry.name, ...(entry.aliases ?? [])].some((n) => foldName(n) === folded)
}

/**
 * Create lorebook tools with the given context.
 * Each invocation creates fresh tools bound to the current entries.
 */
function createLorebookEntryTools(context: LorebookEntryToolContext) {
  const {
    entries,
    activeLorebookId,
    onPendingChange,
    generateId,
    getLorebookEntries,
    removedIndices,
    preventDuplicateNames,
  } = context

  /** Removed slots belong to the bound `entries` only; another lorebook's indices are its own. */
  function isRemoved(targetEntries: VaultLorebookEntry[], index: number): boolean {
    return targetEntries === entries && (removedIndices?.has(index) ?? false)
  }

  /** The one error text for a stale index, so the model reads the same sentence every time. */
  function removedError(index: number): string {
    return `Entry index ${index} was removed earlier in this session. Its slot is kept so the other indices stay valid, but there is nothing there to act on.`
  }

  function resolveTargetEntries(
    lorebookId: string | undefined,
  ):
    | { ok: true; targetEntries: VaultLorebookEntry[]; targetId: string | undefined }
    | { ok: false; error: string } {
    if (lorebookId && !getLorebookEntries) {
      return { ok: false, error: 'Global lorebook access not available in this context' }
    }
    const targetId = lorebookId ?? activeLorebookId
    if (getLorebookEntries && targetId) {
      const found = getLorebookEntries(targetId)
      if (!found) {
        return { ok: false, error: `Lorebook with ID "${targetId}" not found` }
      }
      return { ok: true, targetEntries: found, targetId }
    }
    return { ok: true, targetEntries: entries, targetId }
  }

  return {
    /**
     * List all lorebook entries with optional type filter.
     */
    list_entries: tool({
      description:
        'List lorebook entries with their indices, optionally narrowed by a search term or a type. Reflects the changes made so far in this session, so it is worth calling after merging or deleting — not before, when the list you were given is still accurate.',
      inputSchema: z.object({
        lorebookId: z.string().optional().describe('ID of the lorebook to list entries from'),
        query: z
          .string()
          .optional()
          .describe(
            'Term to match against entry names, aliases, keywords and descriptions. Omit to list everything.',
          ),
        type: entryTypeSchema
          .optional()
          .describe('Filter entries by type (character, location, item, faction, concept, event)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_ENTRIES)
          .optional()
          .describe(`Maximum entries to return (default ${MAX_LIST_ENTRIES})`),
      }),
      execute: async ({
        lorebookId,
        query,
        type,
        limit,
      }: {
        lorebookId?: string
        query?: string
        type?: z.infer<typeof entryTypeSchema>
        limit?: number
      }) => {
        const resolved = resolveTargetEntries(lorebookId)
        if (!resolved.ok) {
          return { entries: [], total: 0, error: resolved.error }
        }
        const targetEntries = resolved.targetEntries

        // Carry the index rather than recovering it with `indexOf` afterwards: that was
        // a scan per returned entry, and it answers by reference identity, which is not
        // what "which slot is this" means.
        let filtered = targetEntries
          .map((entry, index) => ({ entry, index }))
          .filter(({ index }) => !isRemoved(targetEntries, index))

        if (type) {
          filtered = filtered.filter(({ entry }) => entry.type === type)
        }

        // Same word-boundary matching the retrieval side searches with, over the same four
        // fields — so "is there already an entry about X" is answered the same way here as
        // there, and a short query cannot match inside a longer word.
        const term = query?.trim()
        if (term) {
          filtered = filtered.filter(
            ({ entry: e }) =>
              entityNameMatches(term, e.name) ||
              (e.aliases ?? []).some((alias) => entityNameMatches(term, alias)) ||
              e.keywords.some((keyword) => entityNameMatches(term, keyword)) ||
              entityNameMatches(term, e.description),
          )
        }

        const availableTotal = filtered.length
        const cap = limit ?? MAX_LIST_ENTRIES
        filtered = filtered.slice(0, cap)

        return {
          availableTotal,
          hasMore: availableTotal > filtered.length,
          entries: filtered.map(({ entry: e, index }) => ({
            index,
            name: e.name,
            type: e.type,
            description: e.description.slice(0, 200) + (e.description.length > 200 ? '...' : ''),
            keywords: e.keywords.slice(0, 5),
          })),
          returnedCount: filtered.length,
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
        const resolved = resolveTargetEntries(lorebookId)
        if (!resolved.ok) {
          return { found: false, error: resolved.error }
        }
        const targetEntries = resolved.targetEntries

        if (index < 0 || index >= targetEntries.length) {
          return {
            found: false,
            error: `Entry index ${index} out of range (0-${targetEntries.length - 1})`,
          }
        }
        if (isRemoved(targetEntries, index)) {
          return { found: false, error: removedError(index) }
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
        // Validate the target lorebook exists
        const targetId = lorebookId ?? activeLorebookId
        if (getLorebookEntries) {
          if (targetId && !getLorebookEntries(targetId)) {
            return {
              success: false,
              error: `Lorebook with ID "${targetId}" not found`,
            }
          }
        }

        if (preventDuplicateNames) {
          const folded = foldName(name)
          const existing = entries.findIndex(
            (e, i) => !isRemoved(entries, i) && matchesName(e, folded),
          )
          if (existing !== -1) {
            return {
              success: false,
              error: `"${entries[existing].name}" already exists at index ${existing}. Use update_entry on that index to add what you know; do not create a second entry for the same subject.`,
              existingIndex: existing,
            }
          }
        }

        const cleanedAliases = cleanAliases(name, aliases)
        const cleanedKeywords = cleanKeywords(name, cleanedAliases.value, keywords)

        const newEntry: VaultLorebookEntry = {
          name,
          type,
          description,
          keywords: cleanedKeywords.value,
          aliases: cleanedAliases.value,
          injectionMode: injectionMode ?? 'keyword',
          priority: priority ?? 50,
        }

        const changeId = generateId()
        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'create',
          toolCallId: changeId,
          lorebookId: targetId,
          entry: newEntry,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        const note = describeDropped(cleanedAliases.dropped, cleanedKeywords.dropped)
        return {
          success: true,
          pendingChange,
          message: `Created pending entry "${name}" (${type}). Awaiting approval.`,
          ...(note ? { note } : {}),
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
        description: z.string().optional().describe('New description (only send if changing)'),
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
        const resolved = resolveTargetEntries(lorebookId)
        if (!resolved.ok) {
          return { success: false, error: resolved.error }
        }
        const { targetEntries, targetId } = resolved

        if (index < 0 || index >= targetEntries.length) {
          return {
            success: false,
            error: `Entry index ${index} out of range (0-${targetEntries.length - 1})`,
          }
        }

        if (isRemoved(targetEntries, index)) {
          return { success: false, error: removedError(index) }
        }

        const previous = targetEntries[index]
        const changeId = generateId()

        // Filter out undefined and empty-string values to prevent
        // accidental overwrites (e.g. the AI sending description: "")
        const cleanUpdates = Object.fromEntries(
          Object.entries(updates).filter(([_, v]) => v !== undefined && v !== ''),
        ) as Partial<VaultLorebookEntry>

        // Both lists are compared against the name this entry will *have*, not the one it
        // had: a rename and a new alias can arrive in the same call, and checking against
        // the old name would keep an alias that is about to become the name itself.
        const finalName = cleanUpdates.name ?? previous.name
        const finalAliases = cleanUpdates.aliases
          ? cleanAliases(finalName, cleanUpdates.aliases)
          : { value: previous.aliases ?? [], dropped: [] }
        if (cleanUpdates.aliases) cleanUpdates.aliases = finalAliases.value

        const cleanedKeywords = cleanUpdates.keywords
          ? cleanKeywords(finalName, finalAliases.value, cleanUpdates.keywords)
          : { value: [], dropped: [] }
        if (cleanUpdates.keywords) cleanUpdates.keywords = cleanedKeywords.value

        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'update',
          toolCallId: changeId,
          lorebookId: targetId,
          index,
          updates: cleanUpdates,
          previous,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        const note = describeDropped(finalAliases.dropped, cleanedKeywords.dropped)
        return {
          success: true,
          pendingChange,
          message: `Created pending update for "${previous.name}". Awaiting approval.`,
          ...(note ? { note } : {}),
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
        const resolved = resolveTargetEntries(lorebookId)
        if (!resolved.ok) {
          return { success: false, error: resolved.error }
        }
        const { targetEntries, targetId } = resolved

        if (index < 0 || index >= targetEntries.length) {
          return {
            success: false,
            error: `Entry index ${index} out of range (0-${targetEntries.length - 1})`,
          }
        }

        if (isRemoved(targetEntries, index)) {
          return { success: false, error: removedError(index) }
        }

        const previous = targetEntries[index]
        const changeId = generateId()

        const pendingChange: LorebookEntryPendingChangeSchema = {
          id: changeId,
          type: 'delete',
          toolCallId: changeId,
          lorebookId: targetId,
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
        'Merge multiple lorebook entries into a single entry. Useful for consolidating duplicate or related entries. The change will be pending until approval.',
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
        const resolved = resolveTargetEntries(lorebookId)
        if (!resolved.ok) {
          return { success: false, error: resolved.error }
        }
        const { targetEntries, targetId } = resolved

        // Validate all indices
        for (const idx of indices) {
          if (idx < 0 || idx >= targetEntries.length) {
            return {
              success: false,
              error: `Entry index ${idx} out of range (0-${targetEntries.length - 1})`,
            }
          }
          if (isRemoved(targetEntries, idx)) {
            return { success: false, error: removedError(idx) }
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
          lorebookId: targetId,
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
}
export interface StoryToolContext {
  /** Available chapters for querying */
  chapters?: ChapterInfo[]
  /**
   * The run's whole-chapter read allowance: the budget, the repeat cache, and what a
   * failed read answers with. Built by the caller so the number is its decision.
   */
  chapterQueries?: ChapterQueryBudget
  /**
   * The duplicate groups the session has not dealt with yet, already formatted for reading.
   *
   * Called by `finish_lore_management`, which is the only place the answer can still change
   * anything: a run that consolidated nothing is the failure this whole path exists to stop.
   */
  pendingDuplicates?: () => string[]
  /**
   * Record that a duplicate group was judged to be genuinely distinct entries.
   *
   * Returns how many groups the call actually closed, so the tool can tell the model when
   * its indices matched none — otherwise a mistyped index reads as work done.
   */
  onKeepSeparate?: (indices: number[], reason: string) => number
}

/**
 * How many times finishing may be refused over unresolved duplicates.
 *
 * A nudge, not a gate: the agent may be right that the groups are distinct, and a loop
 * that will not let it stop burns the step ceiling and returns nothing.
 */
const MAX_FINISH_REJECTIONS = 2

/**
 * Story and session tools: chapter querying, duplicate dismissal, session completion.
 *
 * There is deliberately no `list_chapters`. The prompt carries every chapter summary
 * untruncated, and a tool restating them gave the agent two versions to reconcile: a
 * measured run spent two of five steps re-injecting 47,000 characters it already had.
 */
function createStoryTools(context: StoryToolContext) {
  const { chapters, chapterQueries, pendingDuplicates, onKeepSeparate } = context
  let finishRejections = 0

  return {
    /**
     * Resolve a duplicate group without changing anything.
     */
    keep_separate: tool({
      description:
        'Declare that a flagged duplicate group is actually distinct entries that should both stay. Use this instead of merging when two similar names are two different things. Nothing is written; it only records the decision so you are not asked about them again. Pass every index of the group.',
      inputSchema: z.object({
        indices: z
          .array(z.number())
          .min(2)
          .describe('Every index of the group to keep apart, exactly as it was listed'),
        reason: z.string().describe('Why these are not the same subject'),
      }),
      execute: async ({ indices, reason }: { indices: number[]; reason: string }) => {
        const closed = onKeepSeparate?.(indices, reason) ?? 0
        if (closed === 0) {
          return {
            acknowledged: false,
            indices,
            error:
              'No listed duplicate group is covered by those indices. Pass every index of one group, copied from the list.',
          }
        }
        return { acknowledged: true, indices, groupsClosed: closed }
      },
    }),

    /**
     * Ask a question about a specific chapter.
     */
    query_chapter: tool({
      description:
        'Ask a specific question about a chapter to understand story events for lore updates. Ask targeted questions like "What did [character] do?" or "What was revealed about [item]?" Each call hands a whole chapter to a second model, so spend them deliberately; the chapter summaries in your instructions are complete and cost nothing.',
      inputSchema: z.object({
        chapterNumber: z.number().describe('The chapter number to query'),
        question: z.string().describe('A specific question about the chapter content'),
      }),
      execute: async ({ chapterNumber, question }: { chapterNumber: number; question: string }) => {
        if (!chapters || chapters.length === 0) {
          return { answered: false, error: 'No chapters available' }
        }
        if (!chapterQueries) {
          return { answered: false, error: 'Chapter reading is not available in this session.' }
        }

        // Before the chapter lookup, so a spent budget reads the same whichever chapter was
        // asked for rather than being mistaken for "no such chapter". A question already in
        // the cache is served either way: replaying it costs nothing.
        if (chapterQueries.exhausted() && !chapterQueries.knows(chapterNumber, question)) {
          return { answered: false, chapterNumber, error: chapterQueries.exhaustedError() }
        }

        const chapter = chapters.find((ch) => ch.number === chapterNumber)
        if (!chapter) {
          return {
            answered: false,
            error: `Chapter ${chapterNumber} not found. Available: ${chapters.map((c) => c.number).join(', ')}`,
          }
        }

        const { answer, failed } = await chapterQueries.ask(chapterNumber, question)
        if (failed) {
          return { answered: false, chapterNumber, question, error: answer }
        }

        // The summary is deliberately not echoed back: every chapter summary is already in
        // the instructions, untruncated, so returning one here is the same text twice in
        // one prompt — and the reason there is no `list_chapters` either.
        return {
          answered: true,
          chapterNumber,
          chapterTitle: chapter.title || `Chapter ${chapter.number}`,
          question,
          answer,
        }
      },
    }),

    /**
     * Terminal tool to finish lore management session.
     * Signals completion of the agentic loop.
     */
    finish_lore_management: tool({
      description:
        'Call this when you have finished reviewing and updating the lorebook. Provide a summary of all changes made. If duplicate groups are still open, this returns completed: false and the session continues — resolve each one with merge_entries/delete_entry or keep_separate, then call this again.',
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
        // The one failure this loop can still fix from the inside: the work is named, the
        // tools are loaded, and the step that would end the run can be spent on it.
        const remaining = pendingDuplicates?.() ?? []
        if (remaining.length > 0 && finishRejections < MAX_FINISH_REJECTIONS) {
          finishRejections++
          return {
            completed: false,
            remainingDuplicates: remaining,
            message:
              'Not finished yet. These possible duplicates have not been dealt with. For each one: merge_entries if they are the same subject, keep_separate if they are not. Then call finish_lore_management again.',
          }
        }

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
/**
 * Drop parameters from a tool's input schema.
 *
 * `execute` keeps its fallbacks and simply never receives them. Removing them from the
 * schema rather than ignoring them afterwards is the point: the schema is what the model
 * is shown, and a parameter that exists is one it spends tokens on and can fill wrongly.
 */
function withoutFields<T extends { inputSchema: unknown }>(tool: T, ...fields: string[]): T {
  // `tool()` widens `inputSchema` to the SDK's `FlexibleSchema`, which loses the Zod
  // methods; these are all built here from `z.object`, so the narrowing is safe.
  const schema = tool.inputSchema as z.ZodObject<z.ZodRawShape>
  const mask = Object.fromEntries(fields.map((field) => [field, true as const]))
  return { ...tool, inputSchema: schema.omit(mask) } as T
}

/**
 * `lorebookId` names something that does not exist here.
 *
 * A story's lorebook is not an entity with an id — it is the branch-resolved `entries`
 * rows the service hands these tools. The id belongs to the Vault. Left in the schema a
 * measured run invented `"lorebook_1"` on every call: every tool that validates it failed
 * and only `create_entry` went through, so the agent could do nothing but grow the list.
 */
const LOREBOOK_ID = 'lorebookId'

export function createLoreManagementTools(context: LoreManagementToolContext) {
  const { create_entry, update_entry, ...entryTools } = createLorebookEntryTools(context)

  // `satisfies` is the guard: every entry tool has to be named here, so a tool added to the
  // factory later cannot quietly reach this agent with its `lorebookId` still attached.
  const entry = {
    list_entries: withoutFields(entryTools.list_entries, LOREBOOK_ID),
    read_entry: withoutFields(entryTools.read_entry, LOREBOOK_ID),
    delete_entry: withoutFields(entryTools.delete_entry, LOREBOOK_ID),
    merge_entries: withoutFields(entryTools.merge_entries, LOREBOOK_ID),
    // `always` is a budget decision past every retrieval threshold, and this agent runs
    // unattended and cannot see the budget. The vault assistant keeps it: a user reads it.
    create_entry: withoutFields(create_entry, LOREBOOK_ID, 'injectionMode'),
    update_entry: withoutFields(update_entry, LOREBOOK_ID, 'injectionMode'),
  } satisfies Record<keyof LorebookEntryTools, unknown>

  return {
    ...entry,
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
