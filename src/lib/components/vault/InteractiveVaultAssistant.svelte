<script lang="ts">
  import {
    InteractiveVaultService,
    type ChatMessage,
    type ToolCallDisplay,
    type VaultState,
    type FocusedEntity,
  } from '$lib/services/ai/vault/InteractiveVaultService'
  import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
  import type { VaultConversation } from '$lib/types'
  import { database } from '$lib/services/database'

  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
  import { vaultEditor } from '$lib/stores/vaultEditorStore.svelte'
  import {
    ChevronLeft,
    Bot,
    Send,
    Loader2,
    User,
    Brain,
    ChevronDown,
    ChevronUp,
    Wrench,
    AlertCircle,
    CheckCheck,
    Trash2,
    Plus,
    History,
    BookOpen,
    Map,
    Check,
    X,
    ListChecks,
    ImageIcon,
    CornerDownLeft,
    CircleUser,
  } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import VaultDiffView from './VaultDiffView.svelte'
  import VaultEntityEditPanel from './VaultEntityEditPanel.svelte'
  import { fade, slide } from 'svelte/transition'
  import { onMount, onDestroy, tick } from 'svelte'
  import * as Sheet from '$lib/components/ui/sheet'
  import * as Dialog from '$lib/components/ui/dialog'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { parseMarkdown } from '$lib/utils/markdown'
  import { cn } from '$lib/utils/cn'
  import { isTouchDevice } from '$lib/utils/swipe'
  import { SvelteSet } from 'svelte/reactivity'
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'

  interface Props {
    onClose: () => void
    onEditEntity?: (change: VaultPendingChange) => void
    focusedEntity?: FocusedEntity | null
  }

  let { onClose, onEditEntity, focusedEntity = null }: Props = $props()

  // Mobile detection
  const isMobile = createIsMobile()

  // AbortController for cancelling ongoing requests
  let abortController: AbortController | null = null

  // Service instance
  let service: InteractiveVaultService | null = $state(null)

  // UI State
  let messages = $state<ChatMessage[]>([])
  let inputValue = $state('')
  let isGenerating = $state(false)
  let error = $state<string | null>(null)
  let messagesContainer: HTMLDivElement
  let expandedReasoning = $state<Set<string>>(new Set())

  // Progress state
  let activeToolCalls = $state<ToolCallDisplay[]>([])
  let isThinking = $state(false)

  // In-flight pending changes (shown in chat before step message arrives)
  let streamingChanges = $state<VaultPendingChange[]>([])

  // Conversation history selector
  let conversations = $state<VaultConversation[]>([])
  let conversationSelectorOpen = $state(false)
  const MAX_CONVERSATIONS = 10

  // Pending changes quick list
  let pendingListOpen = $state(false)
  const pendingOnly = $derived(vaultEditor.pendingChanges.filter((c) => c.status === 'pending'))

  let enlargedImageUrl = $state<string | null>(null)

  // Tracks the most recently viewed character via show_entity (fallback when no focusedEntity)
  let viewedEntity = $state<FocusedEntity | null>(null)
  const activeCharacterEntity = $derived<FocusedEntity | null>(
    focusedEntity?.entityType === 'character'
      ? focusedEntity
      : viewedEntity?.entityType === 'character'
        ? viewedEntity
        : null,
  )

  const entityIcons = {
    character: User,
    'lorebook-entry': BookOpen,
    scenario: Map,
    lorebook: BookOpen,
  }
  const entityStyles = {
    character: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-l-amber-500/60' },
    'lorebook-entry': {
      text: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-l-cyan-500/60',
    },
    scenario: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-l-violet-500/60' },
    lorebook: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-l-blue-500/60' },
  }
  const actionStyles = {
    create: { label: 'Create', text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
    update: { label: 'Update', text: 'text-blue-400', bg: 'bg-blue-500/15' },
    delete: { label: 'Delete', text: 'text-red-400', bg: 'bg-red-500/15' },
    merge: { label: 'Merge', text: 'text-purple-400', bg: 'bg-purple-500/15' },
  }

  function getChangeName(change: VaultPendingChange): string {
    if ('data' in change && change.data && 'name' in change.data) return change.data.name as string
    if ('previous' in change && change.previous && 'name' in change.previous)
      return change.previous.name as string
    return 'Unknown'
  }

  // Initialize service on mount
  onMount(() => {
    initializeService()
    loadConversationsList()

    // Auto-open focused entity if provided
    if (focusedEntity && !isMobile.current) {
      let entityData: any = null
      if (focusedEntity.entityType === 'character') {
        entityData = characterVault.getById(focusedEntity.entityId)
      } else if (focusedEntity.entityType === 'lorebook') {
        entityData = lorebookVault.getById(focusedEntity.entityId)
      } else if (focusedEntity.entityType === 'scenario') {
        entityData = scenarioVault.getById(focusedEntity.entityId)
      }

      if (entityData) {
        // Construct a dummy change to satisfy the viewer store requirement
        const dummyChange = {
          id: `view-${focusedEntity.entityId}`,
          toolCallId: 'init',
          entityType: focusedEntity.entityType,
          action: 'update',
          status: 'pending',
          entityId: focusedEntity.entityId,
          data: JSON.parse(JSON.stringify(entityData)),
        } as unknown as VaultPendingChange

        vaultEditor.openViewer(dummyChange, focusedEntity.entityId, focusedEntity.entityType)
      }
    }
  })

  // Clean up on unmount
  onDestroy(() => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    vaultEditor.reset()
  })

  function initializeService() {
    try {
      service = new InteractiveVaultService('interactiveVault')

      const allLorebooks = lorebookVault.items
      service.initialize(
        {
          characterCount: characterVault.items.length,
          lorebookCount: allLorebooks.length,
          totalEntryCount: allLorebooks.reduce((sum, lb) => sum + lb.entries.length, 0),
          scenarioCount: scenarioVault.items.length,
        },
        focusedEntity ?? undefined,
      )

      const greetingContent = focusedEntity
        ? `Hello! I can see you were editing the ${focusedEntity.entityType} **${focusedEntity.entityName}**. What would you like to work on?`
        : "Hello! I'm your Vault Assistant. I can help you manage characters, lorebooks, and scenarios in your vault.\n\nTry asking me to create a character, organize lorebook entries, or set up a new scenario."

      messages = [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: greetingContent,
          timestamp: Date.now(),
          isGreeting: true,
        },
      ]
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to initialize AI service'
    }
  }

  async function loadConversationsList() {
    try {
      conversations = await database.listVaultConversations()
    } catch {
      // Non-critical — conversation selector just won't show history
    }
  }

  async function handleNewConversation() {
    if (!service) return
    // Auto-save current conversation before starting new one
    if (messages.some((m) => !m.isGreeting)) {
      await service.saveConversation(messages, vaultEditor.pendingChanges).catch(() => {})
    }
    service.reset()
    vaultEditor.reset()
    initializeService()
    await loadConversationsList()
  }

  async function handleSwitchConversation(id: string) {
    if (!service) return
    // Auto-save current before switching
    if (messages.some((m) => !m.isGreeting)) {
      await service.saveConversation(messages, vaultEditor.pendingChanges).catch(() => {})
    }
    const loaded = await service.loadConversation(id)
    if (loaded) {
      vaultEditor.reset()
      // Restore full UI state from persisted data
      if (loaded.chatMessages.length > 0) {
        messages = loaded.chatMessages
      } else {
        // Fallback for conversations saved in the old format (messages-only)
        const reconstructed = service.getChatMessages()
        messages =
          reconstructed.length > 0
            ? reconstructed
            : [
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: 'Conversation loaded. Continue where you left off!',
                  timestamp: Date.now(),
                  isGreeting: true,
                },
              ]
      }
      // Restore pending changes (includes approved/rejected for history display)
      for (const change of loaded.pendingChanges) {
        vaultEditor.addPendingChange(change)
      }
      await tick()
      scrollToBottom()
    }
    await loadConversationsList()
  }

  async function handleDeleteConversation(id: string) {
    try {
      await database.deleteVaultConversation(id)
      if (service?.getConversationId() === id) {
        service.reset()
        vaultEditor.reset()
        initializeService()
      }
      await loadConversationsList()
    } catch {
      // Ignore
    }
  }

  function handleReferenceImage(imageId: string) {
    const ref = `[Image: ${imageId}]`
    inputValue = inputValue.trim() ? `${inputValue.trim()}\n${ref}` : ref
  }

  let editPanelRef = $state<ReturnType<typeof VaultEntityEditPanel> | null>(null)
  let editPanelMobileRef = $state<ReturnType<typeof VaultEntityEditPanel> | null>(null)

  function handleSetPortrait(imageId: string) {
    if (!activeCharacterEntity || !service) return
    const dataUrl = service.generatedImages.get(imageId)
    if (!dataUrl) return
    const panel = editPanelRef ?? editPanelMobileRef
    panel?.setPortrait(dataUrl)
  }

  async function handleSend() {
    if (!service || isGenerating) return

    const userMessage = inputValue.trim()
    inputValue = ''
    error = null

    if (userMessage) {
      // Add user message to UI
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      }
      messages = [...messages, userMsg]
    }
    await tick()
    scrollToBottom()

    isGenerating = true
    isThinking = true
    activeToolCalls = []

    abortController = new AbortController()

    try {
      const vaultState: VaultState = {
        characters: () => characterVault.items,
        lorebooks: () => lorebookVault.items,
        scenarios: () => scenarioVault.items,
        get activeLorebookId() {
          if (focusedEntity?.entityType === 'lorebook') return focusedEntity.entityId
          return vaultEditor.currentLorebookId ?? undefined
        },
        get activeEntries() {
          const id =
            focusedEntity?.entityType === 'lorebook'
              ? focusedEntity.entityId
              : vaultEditor.currentLorebookId
          if (!id) return undefined
          return lorebookVault.getById(id)?.entries
        },
        activeCharacterId:
          focusedEntity?.entityType === 'character' ? focusedEntity.entityId : undefined,
        activeScenarioId:
          focusedEntity?.entityType === 'scenario' ? focusedEntity.entityId : undefined,
      }

      for await (const event of service.sendMessageStreaming(
        vaultState,
        userMessage,
        abortController.signal,
      )) {
        switch (event.type) {
          case 'thinking':
            isThinking = true
            activeToolCalls = []
            break

          case 'tool_start':
            isThinking = false
            activeToolCalls = [
              ...activeToolCalls,
              {
                id: event.toolCallId,
                name: event.toolName,
                args: event.args,
                result: '...',
              },
            ]
            await tick()
            scrollToBottom()
            break

          case 'tool_end':
            activeToolCalls = activeToolCalls.map((tc) =>
              tc.id === event.toolCall.id ? event.toolCall : tc,
            )
            // Collect pending changes as they arrive (store handles dedup)
            if (event.toolCall.pendingChange) {
              const incoming = event.toolCall.pendingChange
              // Auto-approve lorebook creation (it's a prerequisite step)
              if (incoming.entityType === 'lorebook' && incoming.action === 'create' && service) {
                vaultEditor.addPendingChange(incoming)
                await handleApprove(incoming)
                // Open the newly created lorebook in the editor
                if (!isMobile.current) {
                  await tick()
                  vaultEditor.openEditor(incoming)
                }
              } else {
                vaultEditor.addPendingChange(incoming)
                // Auto-open entity editor on desktop (store handles same-lorebook skip)
                if (!isMobile.current) {
                  vaultEditor.openEditorSmart(incoming)
                }
              }
              // Track for immediate chat display
              streamingChanges = [...streamingChanges, incoming]
            }
            await tick()
            scrollToBottom()
            break

          case 'message': {
            // Clear streaming changes that are now attached to this message
            const msgChangeIds = new Set(event.message.pendingChanges?.map((c) => c.id) ?? [])
            streamingChanges = streamingChanges.filter((c) => !msgChangeIds.has(c.id))
            messages = [...messages, event.message]
            activeToolCalls = []
            isThinking = true
            await tick()
            scrollToBottom()
            break
          }

          case 'show_entity':
            // Open entity in view mode (no approval workflow)
            if (!isMobile.current) {
              vaultEditor.openViewer(event.change, event.entityId, event.entityType)
            }
            // Track which character is currently being viewed so the Set Portrait button appears
            if (event.entityType === 'character') {
              viewedEntity = {
                entityType: 'character',
                entityId: event.entityId,
                entityName:
                  ('data' in event.change && (event.change.data as { name?: string }).name) ||
                  event.entityId,
              }
            }
            break

          case 'done':
            // Save full UI state so user can continue exactly where they left off
            service
              .saveConversation(messages, vaultEditor.pendingChanges)
              .then(() => loadConversationsList())
              .catch(() => {})
            break

          case 'error':
            error = event.error
            const errorMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `Sorry, I encountered an error: ${event.error}`,
              timestamp: Date.now(),
            }
            messages = [...messages, errorMsg]
            break
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return
      }
      error = e instanceof Error ? e.message : 'Failed to get response'
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error}`,
        timestamp: Date.now(),
      }
      messages = [...messages, errorMsg]
    } finally {
      isGenerating = false
      isThinking = false
      activeToolCalls = []
      streamingChanges = []
      abortController = null
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const isTouch = isTouchDevice()
    const shouldSubmit = isTouch
      ? e.key === 'Enter' && e.shiftKey
      : e.key === 'Enter' && !e.shiftKey

    if (shouldSubmit) {
      e.preventDefault()
      handleSend()
    }
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
  }

  function toggleReasoning(messageId: string) {
    const newSet = new SvelteSet(expandedReasoning)
    if (newSet.has(messageId)) {
      newSet.delete(messageId)
    } else {
      newSet.add(messageId)
    }
    expandedReasoning = newSet
  }

  function formatToolCallName(name: string): string {
    return name
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  const IMAGE_TOOL_NAMES = new Set(['generate_standard_image', 'generate_portrait'])

  // --- Approval handlers (delegated to store) ---

  async function handleApprove(change?: VaultPendingChange) {
    if (!service) return
    const target = change ?? vaultEditor.activeChange
    if (!target) return
    try {
      await vaultEditor.approve(target, service)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to apply change'
    }
  }

  function handleReject(change: VaultPendingChange) {
    if (!service) return
    vaultEditor.reject(change, service)
  }

  function handleEdit(change: VaultPendingChange) {
    if (change.status !== 'pending') return
    vaultEditor.openEditor(change)
    onEditEntity?.(change)
  }

  async function handleApproveAll() {
    if (!service) return
    const err = await vaultEditor.approveAll(service)
    if (err) error = err
  }
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
  <ResponsiveModal.Content
    class={cn(
      'flex h-[90vh] w-full flex-col gap-0 overflow-hidden p-0',
      vaultEditor.editorOpen && !isMobile.current ? 'max-w-[90vw]' : 'max-w-2xl',
    )}
  >
    <div class="flex flex-col overflow-hidden" style="height: 100%">
      <!-- Top Bar -->
      <div
        class="border-surface-700 bg-surface-900 flex items-center justify-between border-b px-4 py-2.5"
      >
        <div class="flex items-center gap-2.5">
          <Button
            variant="ghost"
            size="icon"
            class="text-surface-400 hover:text-foreground hover:bg-foreground/5 h-8 w-8"
            onclick={onClose}
            title="Back to Vault"
          >
            <ChevronLeft class="h-4 w-4" />
          </Button>
          <div class="flex items-center gap-2">
            <div class="bg-accent-500/15 flex h-7 w-7 items-center justify-center rounded-lg">
              <Bot class="text-accent-400 h-4 w-4" />
            </div>
            <h2 class="text-surface-100 text-sm font-semibold tracking-tight">Vault Assistant</h2>
          </div>
        </div>
        {#if vaultEditor.pendingCount > 0}
          <div in:fade={{ duration: 150 }}>
            <Button
              variant="outline"
              size="sm"
              class="h-7 gap-1.5 border-emerald-500/30 bg-emerald-500/8 px-2.5 text-xs text-emerald-400 hover:bg-emerald-500/15"
              onclick={handleApproveAll}
              disabled={isGenerating}
            >
              <CheckCheck class="h-3.5 w-3.5" />
              Approve All
              <span
                class="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300"
              >
                {vaultEditor.pendingBreakdown}
              </span>
            </Button>
          </div>
        {/if}
      </div>

      <!-- Two-panel layout -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Entity Editor Panel (left, desktop only) -->
        {#if vaultEditor.editorOpen && vaultEditor.activeChange && !isMobile.current}
          <div
            class="border-surface-700 flex flex-1 flex-col overflow-hidden border-r"
            transition:fade={{ duration: 100 }}
          >
            <VaultEntityEditPanel
              bind:this={editPanelRef}
              change={vaultEditor.activeChange}
              onApprove={(specificChange) =>
                handleApprove(specificChange ?? vaultEditor.activeChange!)}
              onReject={(change) => handleReject(change)}
              onClose={() => vaultEditor.closeEditor()}
            />
          </div>
        {/if}

        <!-- Chat Panel (right, or full-width on mobile) -->
        <div
          class="flex flex-col overflow-hidden {vaultEditor.editorOpen && !isMobile.current
            ? 'w-full max-w-2xl shrink-0'
            : 'mx-auto w-full max-w-2xl'}"
        >
          <!-- Conversation selector -->
          <div class="relative {conversationSelectorOpen ? 'z-20' : 'z-10'}">
            <button
              class="border-surface-700 text-surface-400 hover:text-foreground hover:bg-foreground/5 flex w-full items-center gap-2 border-b px-3 py-1.5 text-xs transition-colors"
              onclick={() => (conversationSelectorOpen = !conversationSelectorOpen)}
            >
              <History class="h-3.5 w-3.5" />
              <span class="font-medium">
                {conversations.length > 0
                  ? `${conversations.length} conversation${conversations.length !== 1 ? 's' : ''}`
                  : 'No history'}
              </span>
              {#if conversationSelectorOpen}
                <ChevronUp class="ml-auto h-3 w-3" />
              {:else}
                <ChevronDown class="ml-auto h-3 w-3" />
              {/if}
            </button>
            {#if conversationSelectorOpen}
              <!-- Backdrop -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="fixed inset-0 z-10"
                onclick={() => (conversationSelectorOpen = false)}
                transition:fade={{ duration: 100 }}
              ></div>
              <!-- Floating panel -->
              <div
                class="border-surface-700 bg-surface-900 absolute right-2 left-2 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border shadow-xl shadow-black/30"
                transition:slide={{ duration: 150 }}
              >
                <div class="space-y-1 p-1.5">
                  <!-- New conversation button -->
                  <button
                    class="text-surface-300 hover:text-foreground hover:bg-foreground/5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors"
                    onclick={() => {
                      conversationSelectorOpen = false
                      handleNewConversation()
                    }}
                  >
                    <div
                      class="bg-accent-500/15 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                    >
                      <Plus class="text-accent-400 h-3.5 w-3.5" />
                    </div>
                    <span class="font-medium">New Conversation</span>
                  </button>

                  {#if conversations.length > 0}
                    <div class="border-surface-700 mx-2 border-t"></div>
                    {#each conversations as conv, i (conv.id)}
                      <div
                        class="group bg-surface-800 hover:bg-foreground/5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors"
                      >
                        <button
                          class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          onclick={() => {
                            conversationSelectorOpen = false
                            handleSwitchConversation(conv.id)
                          }}
                        >
                          <div
                            class="bg-surface-700 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                          >
                            <History class="text-surface-400 h-3.5 w-3.5" />
                          </div>
                          <div class="min-w-0 flex-1">
                            <div class="text-surface-200 truncate text-xs font-medium">
                              {conv.title || 'Untitled'}
                            </div>
                            <div class="text-surface-500 mt-0.5 text-[10px]">
                              {new Date(conv.updatedAt).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                              {#if i === conversations.length - 1 && conversations.length >= MAX_CONVERSATIONS}
                                <span class="text-surface-600 ml-1">· oldest</span>
                              {/if}
                            </div>
                          </div>
                        </button>
                        <button
                          class="text-surface-500 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400"
                          onclick={(e) => {
                            e.stopPropagation()
                            handleDeleteConversation(conv.id)
                          }}
                          title="Delete conversation"
                        >
                          <Trash2 class="h-3 w-3" />
                        </button>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Pending Changes Quick List (popover) -->
          {#if pendingOnly.length > 0}
            <div class="relative z-10">
              <button
                class="border-surface-700 text-surface-400 hover:text-foreground hover:bg-foreground/5 flex w-full items-center gap-2 border-b px-3 py-1.5 text-xs transition-colors"
                onclick={() => (pendingListOpen = !pendingListOpen)}
              >
                <ListChecks class="h-3.5 w-3.5" />
                <span class="font-medium">{pendingOnly.length} pending</span>
                {#if pendingListOpen}
                  <ChevronUp class="ml-auto h-3 w-3" />
                {:else}
                  <ChevronDown class="ml-auto h-3 w-3" />
                {/if}
              </button>
              {#if pendingListOpen}
                <!-- Backdrop -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="fixed inset-0 z-10"
                  onclick={() => (pendingListOpen = false)}
                  transition:fade={{ duration: 100 }}
                ></div>
                <!-- Floating panel -->
                <div
                  class="border-surface-700 bg-surface-900 absolute right-2 left-2 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border shadow-xl shadow-black/30"
                  transition:slide={{ duration: 150 }}
                >
                  <div class="space-y-1 p-1.5">
                    {#each pendingOnly as change (change.id)}
                      {@const Icon = entityIcons[change.entityType]}
                      {@const eStyle = entityStyles[change.entityType]}
                      {@const aStyle = actionStyles[change.action]}
                      <div
                        class="group flex items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 transition-colors {eStyle.border} {eStyle.bg} cursor-pointer hover:brightness-125"
                        role="button"
                        tabindex="0"
                        onclick={() => handleEdit(change)}
                        onkeydown={(e) => e.key === 'Enter' && handleEdit(change)}
                      >
                        <!-- Entity icon -->
                        <div
                          class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md {eStyle.bg}"
                        >
                          <Icon class="h-3.5 w-3.5 {eStyle.text}" />
                        </div>
                        <!-- Info -->
                        <div class="min-w-0 flex-1">
                          <div class="text-surface-200 truncate text-xs font-medium">
                            {getChangeName(change)}
                          </div>
                          <div class="mt-0.5 flex items-center gap-1.5">
                            <span
                              class="inline-flex items-center rounded px-1 py-px text-[10px] font-semibold uppercase {aStyle.text} {aStyle.bg}"
                            >
                              {aStyle.label}
                            </span>
                            <span class="text-surface-500 text-[10px]">
                              {change.entityType === 'lorebook-entry' ? 'entry' : change.entityType}
                            </span>
                          </div>
                        </div>
                        <!-- Actions -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div
                          class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                          onclick={(e) => e.stopPropagation()}
                        >
                          <button
                            class="flex h-6 w-6 items-center justify-center rounded-md text-red-400/70 transition-colors hover:bg-red-500/20 hover:text-red-400"
                            onclick={() => handleReject(change)}
                            title="Reject"
                          >
                            <X class="h-3.5 w-3.5" />
                          </button>
                          <button
                            class="flex h-6 w-6 items-center justify-center rounded-md text-emerald-400/70 transition-colors hover:bg-emerald-500/20 hover:text-emerald-400"
                            onclick={() => handleApprove(change)}
                            title="Approve"
                          >
                            <Check class="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Messages -->
          <div class="flex-1 space-y-3 overflow-y-auto px-4 py-3" bind:this={messagesContainer}>
            {#each messages as message (message.id)}
              <div in:fade={{ duration: 150 }}>
                <div
                  class={cn(
                    'flex w-full',
                    message.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    class={cn(
                      'max-w-[90%] md:max-w-[85%]',
                      message.role === 'user' ? 'order-2' : 'order-1',
                    )}
                  >
                    <!-- Message bubble -->
                    <div
                      class={cn(
                        'rounded-xl text-sm',
                        message.role === 'user'
                          ? 'bg-accent-600/90 px-3.5 py-2.5 text-white'
                          : 'bg-surface-800 border-surface-700 border px-3.5 py-2.5',
                      )}
                    >
                      <!-- Icon + content -->
                      <div class="flex items-start gap-2.5">
                        {#if message.role === 'assistant'}
                          <div
                            class="bg-accent-500/15 mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
                          >
                            <Bot class="text-accent-400 h-3 w-3" />
                          </div>
                        {:else}
                          <div
                            class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-white/10"
                          >
                            <User class="h-3 w-3 opacity-90" />
                          </div>
                        {/if}
                        <div class="min-w-0 flex-1">
                          <div class="chat-markdown prose-content break-words">
                            {@html parseMarkdown(message.content)}
                          </div>
                        </div>
                      </div>

                      <!-- Reasoning (collapsible) -->
                      {#if message.role === 'assistant' && message.reasoning}
                        <div class="border-surface-700 mt-2 border-t pt-2">
                          <button
                            class="text-surface-400 hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
                            onclick={() => toggleReasoning(message.id)}
                          >
                            <Brain class="h-3 w-3" />
                            <span>Reasoning</span>
                            {#if expandedReasoning.has(message.id)}
                              <ChevronUp class="h-3 w-3" />
                            {:else}
                              <ChevronDown class="h-3 w-3" />
                            {/if}
                          </button>
                          {#if expandedReasoning.has(message.id)}
                            <div
                              class="bg-surface-900 text-surface-400 mt-2 rounded-lg p-2.5 font-mono text-xs whitespace-pre-wrap"
                              in:slide
                            >
                              {message.reasoning}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>

                    <!-- Tool calls for this message -->
                    {#if message.toolCalls && message.toolCalls.length > 0}
                      <div class="mt-1.5 space-y-1">
                        {#each message.toolCalls as toolCall (toolCall.id)}
                          {#if !IMAGE_TOOL_NAMES.has(toolCall.name) || toolCall.imageUrl}
                            <div
                              class="border-surface-700 bg-surface-800 flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs"
                            >
                              {#if IMAGE_TOOL_NAMES.has(toolCall.name)}
                                <ImageIcon class="text-surface-500 h-3 w-3 flex-shrink-0" />
                              {:else}
                                <Wrench class="text-surface-500 h-3 w-3 flex-shrink-0" />
                              {/if}
                              <span class="text-surface-400 font-medium"
                                >{formatToolCallName(toolCall.name)}</span
                              >
                            </div>
                          {/if}
                          {#if toolCall.imageUrl}
                            <div class="group relative mt-1 inline-block">
                              <button
                                class="border-surface-700 block cursor-pointer overflow-hidden rounded-lg border transition-transform hover:scale-[1.02]"
                                onclick={() => (enlargedImageUrl = toolCall.imageUrl!)}
                                title="Click to enlarge"
                              >
                                <img
                                  src={toolCall.imageUrl}
                                  alt="AI generated result"
                                  class="h-auto max-h-52 w-auto max-w-full object-contain"
                                />
                              </button>
                              {#if toolCall.imageId}
                                <button
                                  class="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/90"
                                  onclick={(e) => {
                                    e.stopPropagation()
                                    handleReferenceImage(toolCall.imageId!)
                                  }}
                                  title="Add image reference to message"
                                >
                                  <CornerDownLeft class="h-2.5 w-2.5" />
                                  Use
                                </button>
                                {#if activeCharacterEntity}
                                  <button
                                    class="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/90"
                                    onclick={(e) => {
                                      e.stopPropagation()
                                      handleSetPortrait(toolCall.imageId!)
                                    }}
                                    title="Set as portrait for {activeCharacterEntity.entityName}"
                                  >
                                    <CircleUser class="h-2.5 w-2.5" />
                                    Set Portrait
                                  </button>
                                {/if}
                              {/if}
                            </div>
                          {/if}
                        {/each}
                      </div>
                    {/if}

                    <!-- Timestamp -->
                    <div
                      class={cn(
                        'text-surface-500 mt-1 px-1 text-[10px]',
                        message.role === 'user' ? 'text-right' : '',
                      )}
                    >
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>

                <!-- Inline diff cards for pending changes produced by this message -->
                {#if message.pendingChanges && message.pendingChanges.length > 0}
                  <div class="mt-3 space-y-2">
                    {#each message.pendingChanges as change (change.id)}
                      {@const liveChange = vaultEditor.getLiveChange(change.id) ?? change}
                      <VaultDiffView
                        change={liveChange}
                        onApprove={() => handleApprove(liveChange)}
                        onReject={() => handleReject(liveChange)}
                        onEdit={() => handleEdit(liveChange)}
                      />
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}

            <!-- Progress indicator -->
            {#if isGenerating}
              <div class="flex justify-start" in:fade>
                <div class="max-w-[90%] md:max-w-[85%]">
                  <div class="border-surface-700 bg-surface-800 rounded-xl border px-3.5 py-2.5">
                    <div class="flex items-start gap-2.5">
                      <div
                        class="bg-accent-500/15 mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md"
                      >
                        <Bot class="text-accent-400 h-3 w-3" />
                      </div>
                      <div class="min-w-0 flex-1">
                        {#if activeToolCalls.length > 0}
                          <div class="space-y-1">
                            {#each activeToolCalls as toolCall (toolCall.id)}
                              <div
                                class="border-surface-700 bg-surface-900 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                                in:fade
                              >
                                {#if toolCall.result === '...'}
                                  <Loader2
                                    class="text-accent-400 h-3 w-3 flex-shrink-0 animate-spin"
                                  />
                                {:else}
                                  <Wrench class="text-surface-500 h-3 w-3 flex-shrink-0" />
                                {/if}
                                <span class="text-surface-300 font-medium"
                                  >{formatToolCallName(toolCall.name)}</span
                                >
                              </div>
                            {/each}
                          </div>
                        {:else if isThinking}
                          <div class="text-surface-400 flex items-center gap-2 text-sm">
                            <Loader2 class="text-accent-400 h-3.5 w-3.5 animate-spin" />
                            <span>Thinking...</span>
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Streaming diff cards (shown before step message arrives) -->
              {#if streamingChanges.length > 0}
                <div class="mt-3 space-y-2">
                  {#each streamingChanges as change (change.id)}
                    {@const liveChange = vaultEditor.getLiveChange(change.id) ?? change}
                    <VaultDiffView
                      change={liveChange}
                      onApprove={() => handleApprove(liveChange)}
                      onReject={() => handleReject(liveChange)}
                      onEdit={() => handleEdit(liveChange)}
                    />
                  {/each}
                </div>
              {/if}
            {/if}
          </div>

          <!-- Error display -->
          {#if error}
            <div class="border-t border-red-500/20 bg-red-500/8 px-4 py-2" in:slide>
              <div class="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle class="h-3.5 w-3.5" />
                <span>{error}</span>
              </div>
            </div>
          {/if}

          <!-- Input area -->
          <div class="border-surface-700 bg-surface-900 border-t p-3">
            <div class="flex items-end gap-2">
              <Textarea
                bind:value={inputValue}
                onkeydown={handleKeyDown}
                placeholder="Ask me to create characters, organize lorebooks, set up scenarios..."
                rows={2}
                class="border-surface-700 bg-surface-800 placeholder:text-surface-500 min-h-[2.5rem] resize-none rounded-xl text-sm"
                disabled={isGenerating || !service}
              />
              <Button
                size="icon"
                class={cn(
                  'h-10 w-10 shrink-0 rounded-xl',
                  isGenerating ? 'opacity-70' : 'bg-accent-600 hover:bg-accent-500',
                )}
                onclick={handleSend}
                disabled={!inputValue.trim() || isGenerating || !service}
                title="Send message"
              >
                {#if isGenerating}
                  <Loader2 class="h-5 w-5 animate-spin" />
                {:else}
                  <Send class="h-5 w-5" />
                {/if}
              </Button>
            </div>
            <div class="text-surface-500 mt-1.5 hidden text-center text-[10px] md:block">
              {isTouchDevice()
                ? 'Shift+Enter to send, Enter for new line'
                : 'Enter to send, Shift+Enter for new line'}
            </div>
          </div>
        </div>
      </div>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>

<!-- Mobile entity editor — bottom sheet -->
{#if isMobile.current && vaultEditor.activeChange}
  <Sheet.Root
    open={vaultEditor.editorOpen}
    onOpenChange={(open) => {
      if (!open) vaultEditor.closeEditor()
    }}
  >
    <Sheet.Content side="bottom" class="flex h-[85dvh] flex-col p-0">
      {#if vaultEditor.activeChange}
        <VaultEntityEditPanel
          bind:this={editPanelMobileRef}
          change={vaultEditor.activeChange}
          onApprove={(specificChange) => handleApprove(specificChange ?? vaultEditor.activeChange!)}
          onReject={(change) => handleReject(change)}
          onClose={() => vaultEditor.closeEditor()}
        />
      {/if}
    </Sheet.Content>
  </Sheet.Root>
{/if}

<!-- Image enlargement dialog -->
<Dialog.Root
  open={!!enlargedImageUrl}
  onOpenChange={(open) => {
    if (!open) enlargedImageUrl = null
  }}
>
  <Dialog.Content
    class="max-h-[90vh] max-w-[90vw] overflow-hidden border-none bg-transparent p-0 shadow-none"
  >
    <Dialog.Title class="sr-only">Generated Image</Dialog.Title>
    <button class="flex items-center justify-center" onclick={() => (enlargedImageUrl = null)}>
      {#if enlargedImageUrl}
        <img
          src={enlargedImageUrl}
          alt="Enlarged view"
          class="max-h-[85vh] max-w-full rounded-lg object-contain"
        />
      {/if}
    </button>
  </Dialog.Content>
</Dialog.Root>
