/**
 * Lore Management Service
 *
 * Autonomous agent that manages lorebook entries, updating and creating
 * entries based on story events using the Vercel AI SDK ToolLoopAgent.
 */

import type { Entry, VaultLorebookEntry } from '$lib/types'
import type { ServiceId } from '$lib/stores/settings.svelte'
import { BaseAIService } from '../BaseAIService'
import { createLogger } from '$lib/log'
import {
  createAgentFromPreset,
  extractToolResults,
  stopOnCompletedTerminalTool,
} from '../sdk/agents'
import { createLoreManagementTools } from '../sdk/tools'
import type {
  FinishLoreManagementSchema,
  LorebookEntryPendingChangeSchema,
} from '../sdk/schemas/lorebook'
import { ContextBuilder } from '$lib/services/context'
import type { LoreManagementToolContext } from '../sdk/tools/lorebook'
import { findDuplicateGroups, formatDuplicateGroup, type DuplicateGroup } from './duplicates'

const log = createLogger('LoreManagement')

/**
 * A consolidation: the entries that go away, and the single entry that replaces them.
 */
export interface LoreMergeResult {
  sources: Entry[]
  merged: Entry
}

/**
 * Result from a lore management session.
 */
export interface LoreManagementResult {
  updatedEntries: Entry[]
  createdEntries: Entry[]
  deletedEntries: Entry[]
  merges: LoreMergeResult[]
  reasoning?: string
}

/**
 * Chapter info for lore management.
 */
export interface LoreManagementChapter {
  number: number
  title: string | null
  summary: string
}

/**
 * Context for running lore management.
 */
export interface LoreManagementContext {
  storyId: string
  /**
   * Story text the chapters do not cover yet, already formatted and bounded by the caller.
   *
   * Empty is a meaningful value and not a rare one: a run triggered right after a chapter
   * was written has almost nothing after it. What matters is that empty *and* no chapters
   * means the agent has no story at all — see `hasStoryMaterial`.
   */
  recentStory: string
  existingEntries: Entry[]
  /** Available chapters for querying */
  chapters?: LoreManagementChapter[]
  /** Callback to query a chapter with a question */
  queryChapter?: (chapterNumber: number, question: string) => Promise<string>
}

/**
 * Convert Entry to VaultLorebookEntry format for tool compatibility.
 */
function entryToVaultEntry(entry: Entry): VaultLorebookEntry {
  return {
    name: entry.name,
    type: entry.type,
    description: entry.description,
    keywords: entry.injection.keywords,
    aliases: entry.aliases,
    injectionMode: entry.injection.mode,
    priority: entry.injection.priority,
  }
}

/**
 * Service that autonomously manages lorebook entries.
 * Uses ToolLoopAgent for multi-turn tool calling.
 */
export class LoreManagementService extends BaseAIService {
  private maxIterations: number
  private requireDuplicateResolution: boolean

  constructor(
    serviceId: ServiceId,
    maxIterations: number = 3,
    requireDuplicateResolution: boolean = false,
  ) {
    super(serviceId)
    this.maxIterations = maxIterations
    this.requireDuplicateResolution = requireDuplicateResolution
  }

  /**
   * Run a lore management session to update/create entries.
   *
   * @param context - The story context for lore management
   * @param signal - Optional abort signal for cancellation
   * @returns Result with updated and created entries
   */
  async runSession(
    context: LoreManagementContext,
    signal?: AbortSignal,
  ): Promise<LoreManagementResult> {
    // An entry the user blacklisted is not the agent's business, and showing it is worse
    // than useless: the agent cannot act on it, but it can re-create it from scratch.
    const managed = [...context.existingEntries]
      .filter((e) => !e.loreManagementBlacklisted)
      // A stable order is what makes the prompt cacheable across sessions and the indices
      // meaningful within one: oldest first, so a new entry appends rather than reshuffling
      // every line that follows it.
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

    log('Starting lore management session', {
      storyId: context.storyId,
      entryCount: managed.length,
      blacklisted: context.existingEntries.length - managed.length,
      maxIterations: this.maxIterations,
    })

    const createdEntries: Entry[] = []
    const updatedEntries: Entry[] = []
    const deletedEntries: Entry[] = []
    const merges: LoreMergeResult[] = []
    let changeIdCounter = 0

    // Convert entries to vault format for tools
    // Deep clone to avoid Svelte proxy issues with AI SDK structured cloning
    const vaultEntries: VaultLorebookEntry[] = JSON.parse(
      JSON.stringify(managed.map(entryToVaultEntry)),
    )
    const plainChapters = context.chapters
      ? JSON.parse(JSON.stringify(context.chapters))
      : undefined

    /**
     * Indices consumed by a delete or a merge.
     *
     * The array itself is never spliced: the model holds indices from the prompt and from
     * every `list_entries` it has already read, and shifting them mid-session makes the
     * next update land on the wrong entry.
     */
    const removedIndices = new Set<number>()
    /** Indices the session has acted on — what makes a duplicate group resolved. */
    const touchedIndices = new Set<number>()

    const duplicateGroups = findDuplicateGroups(vaultEntries)
    const dismissedGroups = new Set<DuplicateGroup>()

    /** A group is open until something happened to one of its members, or it was dismissed. */
    const openDuplicateGroups = () =>
      duplicateGroups.filter(
        (group) => !dismissedGroups.has(group) && !group.indices.some((i) => touchedIndices.has(i)),
      )

    /** Build the Entry a create/merge lands as. Ids are assigned by the caller. */
    const entryFromVault = (source: VaultLorebookEntry, base?: Entry): Entry => ({
      id: base?.id ?? `pending-${changeIdCounter}`,
      storyId: context.storyId,
      name: source.name,
      type: source.type,
      description: source.description,
      hiddenInfo: base?.hiddenInfo ?? null,
      aliases: source.aliases ?? base?.aliases ?? [],
      // A merge keeps the primary entry's tracked state: it is the same subject, and
      // rebuilding it from a default would forget every relationship and visit count.
      state: base && base.type === source.type ? base.state : createDefaultState(source.type),
      adventureState: base?.adventureState ?? null,
      creativeState: base?.creativeState ?? null,
      injection: {
        mode: source.injectionMode,
        keywords: source.keywords,
        priority: source.priority,
      },
      firstMentioned: base?.firstMentioned ?? null,
      lastMentioned: base?.lastMentioned ?? null,
      mentionCount: base?.mentionCount ?? 0,
      createdBy: 'ai',
      createdAt: base?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      loreManagementBlacklisted: false,
      branchId: base?.branchId ?? null,
    })

    /**
     * Apply an approved change as it is made, rather than replaying them at the end.
     *
     * Replaying meant the agent spent the whole session looking at the lorebook it started
     * with: an entry it had just created was invisible to `list_entries`, so it created it
     * again, and a delete left its index readable and updatable. Every change now lands in
     * `vaultEntries` immediately, which is the same array the tools read.
     */
    const applyChange = (change: LorebookEntryPendingChangeSchema) => {
      switch (change.type) {
        case 'create': {
          if (!change.entry) break
          createdEntries.push(entryFromVault(change.entry))
          vaultEntries.push(change.entry)
          break
        }

        case 'update': {
          if (change.index === undefined || !change.updates) break
          const original = managed[change.index]
          const current = vaultEntries[change.index]
          if (!original || !current) break
          const updates = change.updates
          const updated: Entry = {
            ...original,
            ...(updates.name && { name: updates.name }),
            ...(updates.description && { description: updates.description }),
            ...(updates.type && { type: updates.type }),
            ...(updates.aliases && { aliases: updates.aliases }),
            injection: {
              ...original.injection,
              ...(updates.injectionMode && { mode: updates.injectionMode }),
              ...(updates.keywords && { keywords: updates.keywords }),
              ...(updates.priority !== undefined && { priority: updates.priority }),
            },
            updatedAt: Date.now(),
          }
          // An entry updated twice in one session is one update, not two conflicting ones.
          const existing = updatedEntries.findIndex((e) => e.id === updated.id)
          if (existing === -1) updatedEntries.push(updated)
          else updatedEntries[existing] = updated

          Object.assign(current, {
            name: updated.name,
            type: updated.type,
            description: updated.description,
            aliases: updated.aliases,
            keywords: updated.injection.keywords,
            priority: updated.injection.priority,
          })
          touchedIndices.add(change.index)
          break
        }

        case 'delete': {
          if (change.index === undefined) break
          const original = managed[change.index]
          if (!original) break
          deletedEntries.push(original)
          removedIndices.add(change.index)
          touchedIndices.add(change.index)
          break
        }

        case 'merge': {
          if (!change.indices || !change.entry) break
          const sources = change.indices
            .map((i) => managed[i])
            .filter((entry): entry is Entry => Boolean(entry))
          if (sources.length < 2) break
          // The oldest member is the primary: it is the one whose tracked state has had the
          // longest to accumulate.
          const primary = sources.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b))
          merges.push({ sources, merged: entryFromVault(change.entry, primary) })
          for (const index of change.indices) {
            removedIndices.add(index)
            touchedIndices.add(index)
          }
          vaultEntries.push(change.entry)
          break
        }
      }
    }

    // Create tool context with chapter querying
    const toolContext: LoreManagementToolContext = {
      entries: vaultEntries,
      onPendingChange: (change) => {
        // Auto-approve in autonomous mode
        change.status = 'approved'
        applyChange(change)
        log('Auto-approved change', { type: change.type, id: change.id })
      },
      generateId: () => `lm-${++changeIdCounter}`,
      removedIndices,
      preventDuplicateNames: true,
      chapters: plainChapters,
      queryChapter: context.queryChapter,
      // Without the obligation the tool has nothing to refuse over, so the predicate is
      // simply not installed — the worklist is still in the prompt and `keep_separate` is
      // still callable, they just stop being a gate.
      pendingDuplicates: this.requireDuplicateResolution
        ? () => openDuplicateGroups().map(formatDuplicateGroup)
        : undefined,
      onKeepSeparate: (indices, reason) => {
        for (const group of duplicateGroups) {
          if (group.indices.some((i) => indices.includes(i))) dismissedGroups.add(group)
        }
        log('Duplicate group kept separate', { indices, reason })
      },
    }

    // Create tools
    const tools = createLoreManagementTools(toolContext)

    // Build entry summaries for user prompt (use 0-based indices to match tool expectations)
    const entrySummary =
      managed
        .map(
          (e, i) =>
            `[${i}] [${e.type}] ${e.name}: ${e.description?.slice(0, 100) || 'No description'}`,
        )
        .join('\n') || 'No entries yet.'

    const duplicateSummary = duplicateGroups.map(formatDuplicateGroup).join('\n')

    // Empty when there is nothing after the last chapter, which is the normal case for a
    // run triggered by chapter creation. An empty heading is text the model reads to learn
    // nothing, so it is left out entirely rather than printed empty.
    const recentStorySection = context.recentStory
      ? `# Story Since The Last Chapter\n${context.recentStory}\n`
      : ''

    const hasChapters = Boolean(context.chapters && context.chapters.length > 0)

    // The agent's only view of the chapter index — there is no list_chapters tool, so these
    // summaries never exist in two places for it to reconcile.
    //
    // Untruncated, and that is a deliberate cost. On a 41-chapter story the block goes from
    // ~9k characters at the old 200-char cut to ~47k (2.7k tokens to 14k); the median
    // summary is 1,223 characters, so the cut was showing 16% of one. Three things pay for
    // it: the summaries *are* this task's input — an agent deciding what to update from the
    // first sixth of each chapter is guessing; the block is first in the prompt, so it is
    // the part a prefix cache reuses between runs; and the only way to recover what
    // truncation removed is `query_chapter`, which reads a whole chapter with a second
    // model. Cutting here does not save the tokens, it converts them into LLM calls.
    const chapterSummary = hasChapters
      ? context
          .chapters!.map(
            (ch) => `- Chapter ${ch.number}${ch.title ? `: ${ch.title}` : ''}\n  ${ch.summary}`,
          )
          .join('\n')
      : 'No chapters have been written yet.'

    // Render prompts through unified pipeline
    const ctx = new ContextBuilder()
    ctx.add({
      entrySummary,
      duplicateSummary,
      recentStorySection,
      chapterSummary,
      hasChapters,
      // With neither chapters nor recent text the agent has the entry list and nothing
      // else. It can still consolidate and tidy what is there; anything it "identifies as
      // missing" would be invented, so the prompt says so instead of leaving it to
      // judgement.
      hasStoryMaterial: hasChapters || Boolean(context.recentStory),
      requireDuplicateResolution: this.requireDuplicateResolution,
    })
    const { system: systemPrompt, user: userPrompt } = await ctx.render('lore-management')

    // Create the agent
    const agent = createAgentFromPreset(
      {
        presetId: this.presetId,
        instructions: systemPrompt,
        tools,
        // The terminal tool refuses to finish while duplicate groups are open, so the loop
        // has to read its answer rather than its call.
        stopWhen: stopOnCompletedTerminalTool('finish_lore_management', this.maxIterations),
        signal,
      },
      'lore-management',
    )

    // Run the agent
    const result = await agent.generate({ prompt: userPrompt })

    // The last finish call is the one that was accepted; the earlier ones were refusals.
    const finishResults = extractToolResults<FinishLoreManagementSchema & { completed: boolean }>(
      result.steps as any,
      'finish_lore_management',
    )
    const terminalResult = finishResults.findLast((r) => r.completed)

    log('Lore management session completed', {
      steps: result.steps.length,
      created: createdEntries.length,
      updated: updatedEntries.length,
      deleted: deletedEntries.length,
      merged: merges.length,
      duplicateGroups: duplicateGroups.length,
      duplicatesLeftOpen: openDuplicateGroups().length,
      finishRefusals: finishResults.length - (terminalResult ? 1 : 0),
    })

    return {
      updatedEntries,
      createdEntries,
      deletedEntries,
      merges,
      reasoning: terminalResult?.summary,
    }
  }
}

/**
 * Create default state for an entry type.
 */
function createDefaultState(type: Entry['type']): Entry['state'] {
  switch (type) {
    case 'character':
      return {
        type: 'character',
        isPresent: false,
        lastSeenLocation: null,
        currentDisposition: null,
        relationship: { level: 0, status: 'neutral', history: [] },
        knownFacts: [],
        revealedSecrets: [],
      }
    case 'location':
      return {
        type: 'location',
        isCurrentLocation: false,
        visitCount: 0,
        changes: [],
        presentCharacters: [],
        presentItems: [],
      }
    case 'item':
      return {
        type: 'item',
        inInventory: false,
        currentLocation: null,
        condition: null,
        uses: [],
      }
    case 'faction':
      return {
        type: 'faction',
        playerStanding: 0,
        status: 'unknown',
        knownMembers: [],
      }
    case 'concept':
      return {
        type: 'concept',
        revealed: false,
        comprehensionLevel: 'unknown',
        relatedEntries: [],
      }
    case 'event':
      return {
        type: 'event',
        occurred: false,
        occurredAt: null,
        witnesses: [],
        consequences: [],
      }
  }
}
