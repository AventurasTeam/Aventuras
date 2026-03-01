/**
 * Interactive Vault Service
 *
 * Provides an interactive chat interface for managing all vault entity types
 * (characters, lorebooks, scenarios) with cross-entity workflows.
 * Uses the Vercel AI SDK streamText with tools for real-time responses.
 */

import type { VaultCharacter, VaultLorebook, VaultLorebookEntry, VaultScenario } from '$lib/types'
import type { ModelMessage, TextPart, ToolSet } from 'ai'
import { settings } from '$lib/stores/settings.svelte'
import { BaseAIService } from '../BaseAIService'
import { characterVault } from '$lib/stores/characterVault.svelte'
import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
import { createLogger } from '../core/config'
import { FandomService } from '../../fandom'
import { resolveAgentConfig, stopWhenDone } from '../sdk/agents'
import {
  createCharacterTools,
  createScenarioTools,
  createInteractiveVaultLorebookTools,
  createVaultLinkingTools,
  createFandomTools,
  createViewerTools,
  createImageTools,
  type CharacterToolContext,
  type ScenarioToolContext,
  type FandomToolContext,
  type VaultLorebookToolContext,
  type LorebookEntryToolContext,
  type ViewerToolContext,
  type ImageToolContext,
} from '../sdk/tools'
import type { VaultPendingChange } from '../sdk/schemas/vault'
import { streamText } from 'ai'
import { database } from '$lib/services/database'

const log = createLogger('InteractiveVault')

// ============================================================================
// Types
// ============================================================================

/** Live vault state provided to each message */
export interface VaultState {
  characters: () => VaultCharacter[]
  lorebooks: () => VaultLorebook[]
  scenarios: () => VaultScenario[]
  /** Current lorebook entries for entry-level tools (optional, scoped to active lorebook) */
  activeLorebookId?: string
  activeEntries?: VaultLorebookEntry[]
  /** ID of the character the user is actively editing (for focused assistant context) */
  activeCharacterId?: string
  /** ID of the scenario the user is actively editing (for focused assistant context) */
  activeScenarioId?: string
}

/** Entity context passed when the assistant is opened from an edit interface */
export interface FocusedEntity {
  entityType: 'character' | 'lorebook' | 'scenario'
  entityId: string
  entityName: string
}

/** Summary data for initializing the system prompt */
export interface VaultSummary {
  characterCount: number
  lorebookCount: number
  totalEntryCount: number
  scenarioCount: number
}

/** Stream events for progress updates */
export type StreamEvent =
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_end'; toolCall: ToolCallDisplay }
  | { type: 'thinking' }
  | { type: 'message'; message: ChatMessage }
  | { type: 'done'; result: SendMessageResult }
  | { type: 'error'; error: string }
  | {
      type: 'show_entity'
      change: VaultPendingChange
      entityId: string
      entityType: string
    }

/** Tool call info for display in chat */
export interface ToolCallDisplay {
  id: string
  name: string
  args: Record<string, unknown>
  result: string
  pendingChange?: VaultPendingChange
  /** Data URL of a generated image, if this tool call produced one */
  imageUrl?: string
  /** Stable ID of the generated image — use to reference it in follow-up messages */
  imageId?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  pendingChanges?: VaultPendingChange[]
  toolCalls?: ToolCallDisplay[]
  reasoning?: string
  isGreeting?: boolean
}

export interface SendMessageResult {
  response: string
  pendingChanges: VaultPendingChange[]
  toolCalls: ToolCallDisplay[]
  reasoning?: string
}

// ============================================================================
// Service
// ============================================================================

/**
 * Service that provides interactive vault management via chat.
 * Composes all vault tool sets and handles streaming AI conversation.
 */
export class InteractiveVaultService extends BaseAIService {
  private initialized: boolean = false
  private fandomService: FandomService
  private conversationHistory: ModelMessage[] = []
  private systemPrompt: string = ''
  private conversationId: string | null = null

  /** Session-level map of generated images: imageId → base64 data URL */
  readonly generatedImages: Map<string, string> = new Map()

  /**
   * Session-level map of already-generated portraits: characterId → imageId.
   * Prevents the model from generating multiple portraits for the same character
   * when it calls tools in parallel or split across conversation turns.
   */
  readonly generatedPortraitIds: Map<string, string> = new Map()

  constructor(serviceId: string) {
    super(serviceId)
    this.fandomService = new FandomService()
  }

  /**
   * Get the preset configuration.
   */
  private get preset() {
    return settings.getPresetConfig(this.presetId)
  }

  /**
   * Initialize the conversation with vault summary data.
   * Optionally pass a focusedEntity to inject context about which entity the user was editing.
   */
  async initialize(vaultSummary: VaultSummary, focusedEntity?: FocusedEntity): Promise<void> {
    this.conversationHistory = []

    const template = await database.getPackTemplate('default-pack', 'interactive-lorebook')

    let content = template?.content ?? ''
    content = content
      .replace(/\{\{\s*characterCount\s*\}\}/g, String(vaultSummary.characterCount))
      .replace(/\{\{\s*lorebookCount\s*\}\}/g, String(vaultSummary.lorebookCount))
      .replace(/\{\{\s*totalEntryCount\s*\}\}/g, String(vaultSummary.totalEntryCount))
      .replace(/\{\{\s*scenarioCount\s*\}\}/g, String(vaultSummary.scenarioCount))
    this.systemPrompt = content

    if (focusedEntity) {
      this.systemPrompt += `\n\n## Active Context\nThe user opened this assistant from the ${focusedEntity.entityType} editor for "${focusedEntity.entityName}" (ID: \`${focusedEntity.entityId}\`). When the user refers to "this character", "this lorebook", "this scenario", or uses pronouns referencing an entity without naming it, assume they mean this one.`
    }

    this.initialized = true
    log('Initialized conversation', { ...vaultSummary, model: this.preset.model })
  }

  /**
   * Check if the service has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Send a user message and stream AI responses.
   * Composes all vault tool sets for the AI to use.
   */
  async *sendMessageStreaming(
    vaultState: VaultState,
    userMessage?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    if (!this.initialized) {
      yield { type: 'error', error: 'Service not initialized. Call initialize() first.' }
      return
    }

    // Track state for this message
    const pendingChanges: VaultPendingChange[] = []
    const linkedChangeIds = new Set<string>() // Prevent re-linking old changes to new tool calls
    const toolCalls: ToolCallDisplay[] = []
    let responseContent = ''
    let reasoning: string | undefined
    let changeIdCounter = 0

    const generateId = () => `iv-${++changeIdCounter}-${Date.now()}`
    const onPendingChange = (change: VaultPendingChange) => {
      pendingChanges.push(change)
    }

    // Event queues for deferred stream events (from tool callbacks)
    const deferredEvents: StreamEvent[] = []

    // --- Compose all tool sets ---

    // Character tools
    const characterContext: CharacterToolContext = {
      characters: vaultState.characters,
      onPendingChange,
      generateId,
    }
    const characterTools = createCharacterTools(characterContext)

    // Scenario tools
    const scenarioContext: ScenarioToolContext = {
      scenarios: vaultState.scenarios,
      onPendingChange,
      generateId,
    }
    const scenarioTools = createScenarioTools(scenarioContext)

    const vaultLorebookContext: VaultLorebookToolContext = {
      lorebooks: vaultState.lorebooks,
      onPendingChange: (change) => {
        const vaultChange: VaultPendingChange = (() => {
          switch (change.type) {
            case 'create':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook' as const,
                action: 'create' as const,
                status: change.status,
                entityId: change.lorebookId,
                data: {
                  name: change.name!,
                  description: change.description ?? null,
                  tags: change.tags ?? [],
                },
              }
            case 'update':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook' as const,
                action: 'update' as const,
                status: change.status,
                entityId: change.lorebookId,
                data: {
                  name: change.name,
                  description: change.description ?? undefined,
                  tags: change.tags,
                },
              }
            case 'delete':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook' as const,
                action: 'delete' as const,
                status: change.status,
                entityId: change.lorebookId,
              }
          }
        })()
        pendingChanges.push(vaultChange)
      },
      generateId,
    }

    const lorebookEntryContext: LorebookEntryToolContext = {
      entries: vaultState.activeEntries ?? [], // Default to empty if no active lorebook, relying on getLorebookEntries for global access
      getLorebookEntries: (id: string) => {
        const lb = vaultState.lorebooks().find((b) => b.id === id)
        return lb ? lb.entries : undefined
      },
      onPendingChange: (change) => {
        // Wrap legacy PendingChangeSchema into VaultPendingChange
        // Use the ID from the change if present (global edit), otherwise fallback to active context
        const lorebookId = change.lorebookId ?? vaultState.activeLorebookId ?? 'unknown'

        // Validation: If no ID found either way, we have a problem
        if (lorebookId === 'unknown') {
          log('Warning: No lorebook ID resolved for pending change', { change })
        }

        const vaultChange: VaultPendingChange = (() => {
          switch (change.type) {
            case 'create':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook-entry' as const,
                action: 'create' as const,
                lorebookId,
                data: change.entry!,
                status: change.status,
              }
            case 'update':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook-entry' as const,
                action: 'update' as const,
                lorebookId,
                entryIndex: change.index!,
                data: change.updates!,
                previous: change.previous,
                status: change.status,
              }
            case 'delete':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook-entry' as const,
                action: 'delete' as const,
                lorebookId,
                entryIndex: change.index!,
                previous: change.previous,
                status: change.status,
              }
            case 'merge':
              return {
                id: change.id,
                toolCallId: change.toolCallId,
                entityType: 'lorebook-entry' as const,
                action: 'merge' as const,
                lorebookId,
                entryIndices: change.indices!,
                data: change.entry!,
                previousEntries: change.previousEntries,
                status: change.status,
              }
          }
        })()
        pendingChanges.push(vaultChange)
      },
      generateId,
    }

    const lorebookTools = createInteractiveVaultLorebookTools(
      vaultLorebookContext,
      lorebookEntryContext,
    )

    // Vault linking tools
    const vaultLinkingTools = createVaultLinkingTools({
      characters: vaultState.characters,
      lorebooks: vaultState.lorebooks,
      onPendingChange,
      generateId,
    })

    // Fandom tools
    const fandomContext: FandomToolContext = {
      fandomService: this.fandomService,
    }
    const fandomTools = createFandomTools(fandomContext)

    // Viewer tools
    const viewerContext: ViewerToolContext = {
      characters: vaultState.characters,
      scenarios: vaultState.scenarios,
      lorebooks: vaultState.lorebooks,
      onShowEntity: (change, entityId, entityType) => {
        deferredEvents.push({ type: 'show_entity', change, entityId, entityType })
      },
      generateId,
    }
    const viewerTools = createViewerTools(viewerContext)

    // Image tools
    // generatedPortraitIds is scoped to the service instance: if the model calls generate_portrait
    // for the same character again, the tool returns the already-generated imageId immediately.
    const imageContext: ImageToolContext = {
      characters: vaultState.characters,
      generatedImages: this.generatedImages,
      generatedPortraitIds: this.generatedPortraitIds,
      onPendingChange,
      generateId,
    }
    const imageTools = createImageTools(imageContext)

    // Combine all tools
    const tools: Record<string, unknown> = {
      ...characterTools,
      ...scenarioTools,
      ...lorebookTools,
      ...vaultLinkingTools,
      ...fandomTools,
      ...viewerTools,
      ...imageTools,
    }

    // Add user message to conversation history
    if (userMessage) {
      this.conversationHistory.push({
        role: 'user',
        content: userMessage,
      })
    }

    // Resolve agent config
    const { model, providerOptions, preset } = resolveAgentConfig(
      this.presetId,
      'interactive-vault',
    )

    try {
      const result = streamText({
        model,
        system: this.systemPrompt,
        messages: this.conversationHistory,
        tools: tools as ToolSet,
        temperature: preset.temperature,
        maxOutputTokens: preset.maxTokens,
        providerOptions,
        abortSignal: signal,
        stopWhen: stopWhenDone(50),
      })

      // Track tool calls for the current step.
      // Use an array (not a Map) so duplicate toolCallIds from providers like Ollama
      // don't overwrite each other — results are matched FIFO per id.
      const currentToolCalls: Array<{
        id: string
        name: string
        args: Record<string, unknown>
        claimed: boolean
      }> = []

      // Track per-step content
      let stepContent = ''
      let stepToolCalls: ToolCallDisplay[] = []
      let stepReasoning: string | undefined

      // Process the stream
      for await (const event of result.fullStream) {
        switch (event.type) {
          case 'start-step':
            stepContent = ''
            stepToolCalls = []
            stepReasoning = undefined
            currentToolCalls.length = 0
            break

          case 'finish-step':
            if (stepContent || stepToolCalls.length > 0) {
              responseContent += (responseContent && stepContent ? '\n\n' : '') + stepContent
              toolCalls.push(...stepToolCalls)
              if (stepReasoning) {
                reasoning = (reasoning ? reasoning + '\n\n' : '') + stepReasoning
              }

              const stepMessage: ChatMessage = {
                id: `msg-step-${Date.now()}`,
                role: 'assistant',
                content: stepContent,
                timestamp: Date.now(),
                pendingChanges: pendingChanges.filter((pc) =>
                  stepToolCalls.some((tc) => tc.pendingChange?.id === pc.id),
                ),
                toolCalls: stepToolCalls.length > 0 ? [...stepToolCalls] : undefined,
                reasoning: stepReasoning,
              }
              yield { type: 'message', message: stepMessage }
            }
            break

          case 'reasoning-start':
          case 'reasoning-delta':
            if (event.type === 'reasoning-delta') {
              stepReasoning = (stepReasoning || '') + event.text
            }
            yield { type: 'thinking' }
            break

          case 'text-delta':
            stepContent += event.text
            break

          case 'tool-call':
            currentToolCalls.push({
              id: event.toolCallId,
              name: event.toolName,
              args: event.input as Record<string, unknown>,
              claimed: false,
            })
            yield {
              type: 'tool_start',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.input as Record<string, unknown>,
            }
            break

          case 'tool-result': {
            const toolInfo = currentToolCalls.find(
              (tc) => tc.id === event.toolCallId && !tc.claimed,
            )
            if (toolInfo) toolInfo.claimed = true
            const toolResult = 'result' in event ? event.result : event.output
            if (toolInfo) {
              const toolCallDisplay: ToolCallDisplay = {
                id: event.toolCallId,
                name: toolInfo.name,
                args: toolInfo.args,
                result: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
              }

              // Check if this tool call created a pending change
              const latestChange = pendingChanges[pendingChanges.length - 1]
              if (
                latestChange &&
                latestChange.toolCallId.startsWith('iv-') &&
                !linkedChangeIds.has(latestChange.id)
              ) {
                toolCallDisplay.pendingChange = latestChange
                linkedChangeIds.add(latestChange.id)
              }

              // Attach generated image URL directly to the tool call display
              const imageIdStr =
                toolResult && typeof toolResult === 'object' && 'imageId' in toolResult
                  ? String((toolResult as any).imageId)
                  : undefined

              if (imageIdStr) {
                const dataUrl = this.generatedImages.get(imageIdStr)
                if (dataUrl) {
                  toolCallDisplay.imageUrl = dataUrl
                  toolCallDisplay.imageId = imageIdStr
                }
              }

              stepToolCalls.push(toolCallDisplay)
              yield { type: 'tool_end', toolCall: toolCallDisplay }

              // Flush any deferred events from tool callbacks (e.g. show_entity)
              while (deferredEvents.length > 0) {
                yield deferredEvents.shift()!
              }
            }
            break
          }

          case 'error':
            yield { type: 'error', error: String(event.error) }
            return
        }
      }

      // Add assistant response to conversation history
      const responseMessages = await result.response
      this.conversationHistory.push(...responseMessages.messages)

      yield {
        type: 'done',
        result: {
          response: responseContent,
          pendingChanges,
          toolCalls,
          reasoning,
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      log('Error in sendMessageStreaming', { error: errorMessage })
      yield { type: 'error', error: errorMessage }
    }
  }

  /**
   * Handle approval or rejection of a pending change.
   * Adds a system note to conversation history.
   */
  handleApproval(change: VaultPendingChange, approved: boolean): void {
    // Mutate the change status
    change.status = approved ? 'approved' : 'rejected'
    log('Handled approval', { changeId: change.id, approved })

    // Extract a display name from the change
    const displayName = this.getChangeDisplayName(change)

    const note = approved
      ? `[System: User approved the ${change.action} operation for ${change.entityType} "${displayName}"]`
      : `[System: User rejected the ${change.action} operation for ${change.entityType} "${displayName}"]`

    this.conversationHistory.push({
      role: 'user',
      content: note,
    })
  }

  /**
   * Apply a pending change to the vault.
   * Routes by entityType to the appropriate vault store.
   */
  async applyChange(change: VaultPendingChange): Promise<void> {
    switch (change.entityType) {
      case 'character':
        await this.applyCharacterChange(change)
        break
      case 'lorebook':
        await this.applyLorebookChange(change)
        break
      case 'lorebook-entry':
        await this.applyLorebookEntryChange(change)
        break
      case 'scenario':
        await this.applyScenarioChange(change)
        break
    }
  }

  /**
   * Apply a lorebook change to the lorebook vault store.
   */
  private async applyLorebookChange(
    change: Extract<VaultPendingChange, { entityType: 'lorebook' }>,
  ): Promise<void> {
    switch (change.action) {
      case 'create':
        await lorebookVault.add({
          id: change.entityId,
          name: change.data.name,
          description: change.data.description,
          entries: [],
          tags: change.data.tags,
          favorite: false,
          source: 'manual',
          originalFilename: null,
          originalStoryId: null,
          metadata: null,
        })
        break
      case 'update':
        await lorebookVault.update(change.entityId, change.data)
        break
      case 'delete':
        await lorebookVault.delete(change.entityId)
        break
    }
  }

  /**
   * Apply a character change to the character vault store.
   */
  private async applyCharacterChange(
    change: Extract<VaultPendingChange, { entityType: 'character' }>,
  ): Promise<void> {
    switch (change.action) {
      case 'create':
        await characterVault.add({
          name: change.data.name,
          description: change.data.description,
          traits: change.data.traits,
          visualDescriptors: change.data.visualDescriptors,
          portrait: change.data.portrait ?? null,
          tags: change.data.tags,
          favorite: change.data.favorite ?? false,
          source: 'manual',
          originalStoryId: null,
          metadata: null,
        })
        break
      case 'update':
        await characterVault.update(change.entityId, change.data)
        break
      case 'delete':
        await characterVault.delete(change.entityId)
        break
    }
  }

  /**
   * Apply a lorebook entry change to the lorebook vault store.
   * Modifies the entries array and calls lorebookVault.update().
   */
  private async applyLorebookEntryChange(
    change: Extract<VaultPendingChange, { entityType: 'lorebook-entry' }>,
  ): Promise<void> {
    const lorebook = lorebookVault.getById(change.lorebookId)
    if (!lorebook) {
      log('Lorebook not found for entry change', { lorebookId: change.lorebookId })
      return
    }

    const entries = [...lorebook.entries]

    switch (change.action) {
      case 'create':
        entries.push(change.data)
        break
      case 'update':
        if (change.entryIndex >= 0 && change.entryIndex < entries.length) {
          entries[change.entryIndex] = { ...entries[change.entryIndex], ...change.data }
        }
        break
      case 'delete':
        if (change.entryIndex >= 0 && change.entryIndex < entries.length) {
          entries.splice(change.entryIndex, 1)
        }
        break
      case 'merge':
        if (change.entryIndices) {
          // Remove source entries in reverse order to preserve indices
          const sortedIndices = [...change.entryIndices].sort((a, b) => b - a)
          for (const index of sortedIndices) {
            if (index >= 0 && index < entries.length) {
              entries.splice(index, 1)
            }
          }
          // Add merged entry
          entries.push(change.data)
        }
        break
    }

    await lorebookVault.update(change.lorebookId, { entries })
  }

  /**
   * Apply a scenario change to the scenario vault store.
   */
  private async applyScenarioChange(
    change: Extract<VaultPendingChange, { entityType: 'scenario' }>,
  ): Promise<void> {
    switch (change.action) {
      case 'create':
        await scenarioVault.add({
          name: change.data.name,
          description: change.data.description,
          settingSeed: change.data.settingSeed,
          npcs: change.data.npcs,
          primaryCharacterName: change.data.primaryCharacterName,
          firstMessage: change.data.firstMessage ?? null,
          alternateGreetings: change.data.alternateGreetings ?? [],
          tags: change.data.tags,
          favorite: change.data.favorite ?? false,
          source: 'manual',
          originalFilename: null,
          metadata: null,
        })
        break
      case 'update':
        await scenarioVault.update(change.entityId, change.data)
        break
      case 'delete':
        await scenarioVault.delete(change.entityId)
        break
    }
  }

  /**
   * Extract a display name from a pending change for system notes.
   */
  private getChangeDisplayName(change: VaultPendingChange): string {
    if ('data' in change && change.data && 'name' in change.data) {
      return change.data.name ?? 'unknown'
    }
    if ('previous' in change && change.previous && 'name' in change.previous) {
      return change.previous.name ?? 'unknown'
    }
    return 'unknown'
  }

  /**
   * Save the current conversation to the database, including the full UI state.
   * Creates a new conversation if none exists, otherwise updates the existing one.
   *
   * @param chatMessages - UI-level ChatMessage[] (with diff cards, images, reasoning)
   * @param pendingChanges - Full VaultPendingChange[] list (includes approved/rejected for history)
   */
  async saveConversation(
    chatMessages: ChatMessage[],
    pendingChanges: VaultPendingChange[],
  ): Promise<string> {
    const messagesJson = JSON.stringify(this.conversationHistory)
    const chatMessagesJson = JSON.stringify(chatMessages)
    const pendingChangesJson = JSON.stringify(pendingChanges)

    if (this.conversationId) {
      await database.saveVaultConversation(this.conversationId, {
        messages: messagesJson,
        chatMessages: chatMessagesJson,
        pendingChanges: pendingChangesJson,
      })
      log('Saved conversation', { id: this.conversationId })
      return this.conversationId
    }

    // Create new conversation with auto-generated title
    const id = `vc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const title = this.generateTitle()
    const now = new Date().toISOString()

    await database.createVaultConversation({
      id,
      title,
      createdAt: now,
      updatedAt: now,
      messages: messagesJson,
      chatMessages: chatMessagesJson,
      pendingChanges: pendingChangesJson,
    })

    this.conversationId = id
    log('Created conversation', { id, title })
    return id
  }

  /**
   * Load a conversation from the database and restore its full state.
   * Returns the UI-level chat messages and pending changes for the component to restore,
   * or null if the conversation was not found or could not be parsed.
   */
  async loadConversation(
    conversationId: string,
  ): Promise<{ chatMessages: ChatMessage[]; pendingChanges: VaultPendingChange[] } | null> {
    const conversation = await database.loadVaultConversation(conversationId)
    if (!conversation) {
      log('Conversation not found', { conversationId })
      return null
    }

    try {
      this.conversationHistory = JSON.parse(conversation.messages) as ModelMessage[]
      this.conversationId = conversationId

      const chatMessages = JSON.parse(conversation.chatMessages) as ChatMessage[]
      const pendingChanges = JSON.parse(conversation.pendingChanges) as VaultPendingChange[]

      // Restore generated images from chat messages so set_portrait still works
      // for images generated in a previous session
      this.generatedImages.clear()
      for (const msg of chatMessages) {
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            if (tc.imageId && tc.imageUrl) {
              this.generatedImages.set(tc.imageId, tc.imageUrl)
            }
          }
        }
      }

      log('Loaded conversation', {
        id: conversationId,
        messageCount: this.conversationHistory.length,
        chatMessageCount: chatMessages.length,
        pendingChangeCount: pendingChanges.length,
      })
      return { chatMessages, pendingChanges }
    } catch (error) {
      log('Failed to parse conversation data', { conversationId, error })
      return null
    }
  }

  /**
   * Get the current conversation ID.
   */
  getConversationId(): string | null {
    return this.conversationId
  }

  /**
   * Auto-generate a conversation title from the first user message.
   * Truncates to ~50 characters at a word boundary.
   */
  private generateTitle(): string {
    const firstUserMessage = this.conversationHistory.find((m) => m.role === 'user')
    if (!firstUserMessage) return 'New Conversation'

    const content =
      typeof firstUserMessage.content === 'string'
        ? firstUserMessage.content
        : firstUserMessage.content
            .filter((p): p is TextPart => p.type === 'text')
            .map((p) => p.text)
            .join(' ')

    if (!content) return 'New Conversation'

    // Strip system notes
    const cleaned = content.replace(/^\[System:.*\]$/g, '').trim()
    if (!cleaned) return 'New Conversation'

    if (cleaned.length <= 50) return cleaned

    // Truncate at word boundary
    const truncated = cleaned.slice(0, 50)
    const lastSpace = truncated.lastIndexOf(' ')
    return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...'
  }

  /**
   * Reset the conversation.
   */
  reset(): void {
    this.conversationHistory = []
    this.systemPrompt = ''
    this.initialized = false
    this.conversationId = null
    this.generatedImages.clear()
  }

  /**
   * Get the current conversation history for persistence.
   */
  getConversationHistory(): ModelMessage[] {
    return [...this.conversationHistory]
  }

  /**
   * Restore conversation history from persistence.
   */
  setConversationHistory(history: ModelMessage[]): void {
    this.conversationHistory = [...history]
  }

  /**
   * Convert stored ModelMessage history into displayable ChatMessages.
   * Skips tool/system messages and internal approval notes.
   */
  getChatMessages(): ChatMessage[] {
    const result: ChatMessage[] = []
    // Use a base timestamp and increment so messages appear in order
    const baseTime = Date.now() - this.conversationHistory.length * 1000

    this.conversationHistory.forEach((msg, i) => {
      if (msg.role === 'tool' || msg.role === 'system') return

      const content =
        typeof msg.content === 'string'
          ? msg.content
          : (msg.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text' && p.text)
              .map((p) => p.text!)
              .join('\n')

      // Skip internal system approval notes injected by handleApproval
      if (content.startsWith('[System:')) return

      // Skip assistant steps that had no text (tool-only steps)
      if (msg.role === 'assistant' && !content.trim()) return

      result.push({
        id: `loaded-${i}-${Math.random().toString(36).slice(2, 7)}`,
        role: msg.role as 'user' | 'assistant',
        content,
        timestamp: baseTime + i * 1000,
      })
    })

    return result
  }
}
