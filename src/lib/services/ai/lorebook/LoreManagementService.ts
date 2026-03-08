/**
 * Lore Management Service
 *
 * Autonomous agent that manages lorebook entries, updating and creating
 * entries based on story events using the Vercel AI SDK ToolLoopAgent.
 */

import type { Entry, VaultLorebookEntry } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { createLogger } from '../core/config'
import { createAgentFromPreset, extractTerminalToolResult, stopOnTerminalTool } from '../sdk/agents'
import { createLoreManagementTools } from '../sdk/tools'
import type {
  FinishLoreManagementSchema,
  LorebookEntryPendingChangeSchema,
} from '../sdk/schemas/lorebook'
import { ContextBuilder } from '$lib/services/context'
import type { LoreManagementToolContext } from '../sdk/tools/lorebook'

const log = createLogger('LoreManagement')

/**
 * Result from a lore management session.
 */
export interface LoreManagementResult {
  updatedEntries: Entry[]
  createdEntries: Entry[]
  reasoning?: string
}

/**
 * Chapter info for lore management.
 */
export interface LoreManagementChapter {
  number: number
  title: string | null
  summary: string
  keywords?: string[]
  characters?: string[]
}

/**
 * Context for running lore management.
 */
export interface LoreManagementContext {
  storyId: string
  narrativeResponse: string
  userAction: string
  existingEntries: Entry[]
  /** Available chapters for querying */
  chapters?: LoreManagementChapter[]
  /** Callback to query a chapter with a question */
  queryChapter?: (chapterNumber: number, question: string) => Promise<string>
}

/**
 * Settings for lore management behavior.
 */
export interface LoreManagementSettings {
  enabled: boolean
  maxIterations: number
}

export function getDefaultLoreManagementSettings(): LoreManagementSettings {
  return {
    enabled: true,
    maxIterations: 3,
  }
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

  constructor(serviceId: string, maxIterations: number = 3) {
    super(serviceId)
    this.maxIterations = maxIterations
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
    log('Starting lore management session', {
      storyId: context.storyId,
      entryCount: context.existingEntries.length,
      maxIterations: this.maxIterations,
    })

    // Track pending changes - in autonomous mode, we auto-approve everything
    const pendingChanges: LorebookEntryPendingChangeSchema[] = []
    const createdEntries: Entry[] = []
    const updatedEntries: Entry[] = []
    let changeIdCounter = 0

    // Convert entries to vault format for tools
    // Deep clone to avoid Svelte proxy issues with AI SDK structured cloning
    const vaultEntries = JSON.parse(JSON.stringify(context.existingEntries.map(entryToVaultEntry)))
    const plainChapters = context.chapters
      ? JSON.parse(JSON.stringify(context.chapters))
      : undefined

    // Create tool context with chapter querying
    const toolContext: LoreManagementToolContext = {
      entries: vaultEntries,
      onPendingChange: (change) => {
        // Auto-approve in autonomous mode
        change.status = 'approved'
        pendingChanges.push(change)
        log('Auto-approved change', { type: change.type, id: change.id })
      },
      generateId: () => `lm-${++changeIdCounter}`,
      chapters: plainChapters,
      queryChapter: context.queryChapter,
    }

    // Create tools
    const tools = createLoreManagementTools(toolContext)

    // Build entry summaries for user prompt (use 0-based indices to match tool expectations)
    const entrySummary =
      context.existingEntries
        .map(
          (e, i) =>
            `[${i}] [${e.type}] ${e.name}: ${e.description?.slice(0, 100) || 'No description'}`,
        )
        .join('\n') || 'No entries yet.'

    // Build recent story section
    const recentStorySection = `# Recent Story Content
User action: ${context.userAction}

Narrative:
${context.narrativeResponse}

`

    // Build chapter summary from chapters array
    const chapterSummary =
      context.chapters && context.chapters.length > 0
        ? context.chapters
            .map(
              (ch) =>
                `Chapter ${ch.number}${ch.title ? `: ${ch.title}` : ''} - ${ch.summary.slice(0, 200)}...`,
            )
            .join('\n')
        : 'No chapters available. Use list_chapters and query_chapter tools to explore story history.'

    // Render prompts through unified pipeline
    const ctx = new ContextBuilder()
    ctx.add({ entrySummary, recentStorySection, chapterSummary })
    const { system: systemPrompt, user: userPrompt } = await ctx.render('lore-management')

    // Create the agent
    const agent = createAgentFromPreset(
      {
        presetId: this.presetId,
        instructions: systemPrompt,
        tools,
        stopWhen: stopOnTerminalTool('finish_lore_management', this.maxIterations),
        signal,
      },
      'lore-management',
    )

    // Run the agent
    const result = await agent.generate({ prompt: userPrompt })

    // Extract the terminal result

    const terminalResult = extractTerminalToolResult<
      FinishLoreManagementSchema & { completed: boolean }
    >(result.steps as any, 'finish_lore_management')

    log('Lore management session completed', {
      steps: result.steps.length,
      pendingChanges: pendingChanges.length,
      terminalResult,
    })

    // Process approved changes to build result
    // Note: In this autonomous mode, changes are captured but not actually
    // applied to the database here - that's handled by the caller
    for (const change of pendingChanges) {
      if (change.status !== 'approved') continue

      switch (change.type) {
        case 'create':
          if (change.entry) {
            // Create a minimal Entry from the VaultLorebookEntry
            const newEntry: Entry = {
              id: `pending-${change.id}`,
              storyId: context.storyId,
              name: change.entry.name,
              type: change.entry.type,
              description: change.entry.description,
              hiddenInfo: null,
              aliases: [],
              state: createDefaultState(change.entry.type),
              adventureState: null,
              creativeState: null,
              injection: {
                mode: change.entry.injectionMode,
                keywords: change.entry.keywords,
                priority: change.entry.priority,
              },
              firstMentioned: null,
              lastMentioned: null,
              mentionCount: 0,
              createdBy: 'ai',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              loreManagementBlacklisted: false,
              branchId: null,
            }
            createdEntries.push(newEntry)
          }
          break

        case 'update':
          if (change.index !== undefined && change.updates) {
            const original = context.existingEntries[change.index]
            if (original) {
              const updated: Entry = {
                ...original,
                ...(change.updates.name && { name: change.updates.name }),
                ...(change.updates.description && { description: change.updates.description }),
                ...(change.updates.type && { type: change.updates.type }),
                injection: {
                  ...original.injection,
                  ...(change.updates.injectionMode && { mode: change.updates.injectionMode }),
                  ...(change.updates.keywords && { keywords: change.updates.keywords }),
                  ...(change.updates.priority !== undefined && {
                    priority: change.updates.priority,
                  }),
                },
                updatedAt: Date.now(),
              }
              updatedEntries.push(updated)
            }
          }
          break

        // Delete and merge operations would need different handling
        // depending on how the caller wants to process them
      }
    }

    return {
      updatedEntries,
      createdEntries,
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
