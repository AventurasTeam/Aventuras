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
  finishOnlyOnLastStep,
  stopOnCompletedTerminalTool,
} from '../sdk/agents'
import type { PrepareStepFunction } from 'ai'
import { createLoreManagementTools } from '../sdk/tools'
import type { FinishLoreManagementSchema } from '../sdk/schemas/lorebook'
import { ContextBuilder } from '$lib/services/context'
import type { LoreManagementToolContext } from '../sdk/tools/lorebook'
import {
  findDuplicateGroups,
  formatDuplicateGroup,
  pairKeys,
  type DuplicateGroup,
} from '$lib/services/duplicates'
import { LoreSessionLedger, type LoreMergeResult } from './sessionChanges'
import { ChapterQueryBudget, MAX_CHAPTER_QUERIES_LORE } from '../sdk/tools/chapterQueries'
import { LORE_MANAGEMENT_DEFAULTS } from '../core/defaults'

const log = createLogger('LoreManagement')

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
   * Empty is normal — a run triggered right after a chapter has almost nothing after it.
   * Empty *and* no chapters means the agent has no story at all; see `hasStoryMaterial`.
   */
  recentStory: string
  existingEntries: Entry[]
  /** Available chapters for querying */
  chapters?: LoreManagementChapter[]
  /** Callback to query a chapter with a question */
  queryChapter?: (chapterNumber: number, question: string) => Promise<string>
  /**
   * Name pairs already declared distinct — by the user in the duplicates window, or by an
   * earlier run. Groups they cover are not put to the agent again.
   */
  keptSeparate?: ReadonlySet<string>
  /** Persist a `keep_separate` decision, so it outlives the session. */
  onKeepSeparate?: (names: string[]) => Promise<void>
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
    maxIterations: number = LORE_MANAGEMENT_DEFAULTS.maxIterations,
    requireDuplicateResolution: boolean = LORE_MANAGEMENT_DEFAULTS.requireDuplicateResolution,
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
    // A blacklisted entry is not the agent's business, and showing it is worse than
    // useless: it cannot act on one, but it can re-create it from scratch.
    const managed = [...context.existingEntries]
      .filter((e) => !e.loreManagementBlacklisted)
      // Oldest first, so a new entry appends instead of reshuffling every line under it:
      // that is what keeps the prompt cacheable and the indices stable within a session.
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

    log('Starting lore management session', {
      storyId: context.storyId,
      entryCount: managed.length,
      blacklisted: context.existingEntries.length - managed.length,
      maxIterations: this.maxIterations,
    })

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
     * Where an approved change lands. Owns the index -> entry mapping, which grows with
     * `vaultEntries` as the agent creates and merges.
     */
    const ledger = new LoreSessionLedger(managed, vaultEntries, context.storyId)
    const removedIndices = ledger.removedIndices

    // Groups the user (or an earlier run) already closed never reach the agent: re-arguing
    // a settled question costs a step and can only end the same way.
    const settled = context.keptSeparate ?? new Set<string>()
    const duplicateGroups = findDuplicateGroups(vaultEntries).filter((group) =>
      pairKeys(group.names).some((pair) => !settled.has(pair)),
    )
    const dismissedGroups = new Set<DuplicateGroup>()

    /**
     * The `keep_separate` writes, awaited before the session returns.
     *
     * The tool callback is synchronous — the agent needs its answer in the same step — so
     * the write cannot be awaited where it starts. Dropping the promise made a failure an
     * unhandled rejection and a reported dismissal that never reached the table.
     */
    const keepSeparateWrites: Promise<void>[] = []

    /**
     * A group is open until it has collapsed to one surviving member, or was dismissed.
     *
     * Deliberately not "a member was touched": updating an entry is what the agent does
     * anyway on its second task, so that test closed groups without consolidating
     * anything — and closing them is the whole point of the obligation.
     */
    const openDuplicateGroups = () =>
      duplicateGroups.filter(
        (group) =>
          !dismissedGroups.has(group) &&
          group.indices.filter((i) => !removedIndices.has(i)).length > 1,
      )

    // Create tool context with chapter querying
    const toolContext: LoreManagementToolContext = {
      entries: vaultEntries,
      onPendingChange: (change) => {
        // Auto-approve in autonomous mode
        change.status = 'approved'
        ledger.apply(change)
        log('Auto-approved change', { type: change.type, id: change.id })
      },
      generateId: () => `lm-${++changeIdCounter}`,
      removedIndices,
      preventDuplicateNames: true,
      chapters: plainChapters,
      // Fewer reads than the retrieval agent gets, and for a different reason — see
      // MAX_CHAPTER_QUERIES_LORE. No `alternative`: there is no grep here to point at.
      chapterQueries: new ChapterQueryBudget({
        max: MAX_CHAPTER_QUERIES_LORE,
        scope: 'session',
        ask: context.queryChapter,
      }),
      // Without the obligation there is nothing to refuse over, so the predicate is not
      // installed: the worklist and `keep_separate` stay, they just stop being a gate.
      pendingDuplicates: this.requireDuplicateResolution
        ? () => openDuplicateGroups().map(formatDuplicateGroup)
        : undefined,
      onKeepSeparate: (indices, reason) => {
        const named = new Set(indices)
        // Every index of a group must be named. Closing on a single shared index dismissed
        // neighbouring groups the agent had never looked at.
        const closing = duplicateGroups.filter(
          (group) => !dismissedGroups.has(group) && group.indices.every((i) => named.has(i)),
        )
        for (const group of closing) dismissedGroups.add(group)
        // Persisted, not just dismissed for this session: the next run would otherwise
        // ask the same question and get the same answer, at the same cost.
        for (const group of closing) {
          const write = context.onKeepSeparate?.(group.names)
          if (write) keepSeparateWrites.push(write)
        }
        log('Duplicate groups kept separate', { indices, reason, closed: closing.length })
        return closing.length
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

    // Left out entirely rather than printed empty: an empty heading is text the model
    // reads to learn nothing, and there is nothing after the last chapter more often than not.
    const recentStorySection = context.recentStory
      ? `# Story Since The Last Chapter\n${context.recentStory}\n`
      : ''

    const hasChapters = Boolean(context.chapters && context.chapters.length > 0)

    // The agent's only view of the chapter index — there is no list_chapters tool, so the
    // summaries never exist in two places for it to reconcile.
    //
    // Untruncated, at a deliberate cost: ~9k characters to ~47k on a 41-chapter story. The
    // summaries *are* this task's input, the block is first in the prompt so a prefix cache
    // reuses it between runs, and the only way to recover what a cut removed is
    // `query_chapter` — a whole chapter read by a second model. Cutting converts tokens
    // into LLM calls rather than saving them.
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
      // With neither chapters nor recent text the agent has only the entry list. It can
      // still consolidate; anything it "identifies as missing" would be invented, so the
      // prompt says so rather than leaving it to judgement.
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
        // A run that hits the ceiling has already written its changes, but its account of
        // them lives only in the message history — and that summary is the only thing the
        // user is shown. Spend the last step, which was going to happen anyway, on it.
        prepareStep: finishOnlyOnLastStep(
          'finish_lore_management',
          this.maxIterations,
        ) as PrepareStepFunction<typeof tools>,
        signal,
      },
      'lore-management',
    )

    // Run the agent
    const result = await agent.generate({ prompt: userPrompt })

    // Started inside the synchronous tool callback, settled here: a dismissal the session
    // reports must be one that reached the table.
    await Promise.all(keepSeparateWrites)

    const finishResults = extractToolResults<
      FinishLoreManagementSchema & { completed: boolean },
      typeof tools
    >(result.steps, 'finish_lore_management')
    // A refused call on the forced last step still ends the run, so its summary is the only
    // account there will be of a session that did write changes.
    const terminalResult = finishResults.findLast((r) => r.completed) ?? finishResults.at(-1)

    const { createdEntries, updatedEntries, deletedEntries, merges } = ledger.result()

    log('Lore management session completed', {
      steps: result.steps.length,
      created: createdEntries.length,
      updated: updatedEntries.length,
      deleted: deletedEntries.length,
      merged: merges.length,
      duplicateGroups: duplicateGroups.length,
      duplicatesLeftOpen: openDuplicateGroups().length,
      finishRefusals: finishResults.filter((r) => !r.completed).length,
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
