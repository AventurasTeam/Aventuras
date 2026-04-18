<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story/index.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import {
    Send,
    Wand2,
    MessageSquare,
    Brain,
    Sparkles,
    RefreshCw,
    X,
    PenLine,
    Square,
  } from 'lucide-svelte'
  import Suggestions from './Suggestions.svelte'
  import GrammarCheck from './GrammarCheck.svelte'
  import { isTouchDevice } from '$lib/utils/swipe'
  import { ActionInputController, type ActionType } from '$lib/services/generation'

  // ============================================================================
  // UI State
  // ============================================================================

  let inputValue = $state('')
  let actionType = $state<ActionType>('do')
  let isRawActionChoice = $state(false)

  // ============================================================================
  // Controller
  // ============================================================================

  const controller = new ActionInputController()

  // ============================================================================
  // Derived State
  // ============================================================================

  const isCreativeWritingMode = $derived(story.mode === 'creative-writing')

  const sendKeyHint = $derived(
    isTouchDevice() ? 'Shift+Enter to send' : 'Enter to send, Shift+Enter for new line',
  )

  // Block generation when any service is missing a model or has an invalid profile
  const blockGeneration = $derived(settings.hasGenerationConfigIssues)

  // ============================================================================
  // Action Type Configuration
  // ============================================================================

  const actionIcons = {
    do: Wand2,
    say: MessageSquare,
    think: Brain,
    story: Sparkles,
    free: PenLine,
  }
  const actionLabels: Record<ActionType, string> = {
    do: 'Do',
    say: 'Say',
    think: 'Think',
    story: 'Story',
    free: 'Free',
  }
  const actionBorderColors: Record<ActionType, string> = {
    do: 'border-l-emerald-500',
    say: 'border-l-blue-500',
    think: 'border-l-purple-500',
    story: 'border-l-amber-500',
    free: 'border-l-surface-600',
  }
  const actionActiveStyles: Record<ActionType, string> = {
    do: 'bg-emerald-500/15 text-emerald-400',
    say: 'bg-blue-500/15 text-blue-400',
    think: 'bg-purple-500/15 text-purple-400',
    story: 'bg-amber-500/15 text-amber-400',
    free: 'bg-surface-600/30 text-surface-300',
  }
  const actionButtonStyles: Record<ActionType, string> = {
    do: 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10',
    say: 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10',
    think: 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10',
    story: 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10',
    free: 'text-surface-400 hover:text-surface-200 hover:bg-surface-500/10',
  }
  const actionTypes: ActionType[] = ['do', 'say', 'think', 'story', 'free']

  // POV-based prefixes/suffixes
  const protagonistName = $derived.by(
    () =>
      story.character.characters.find((c) => c.relationship === 'self')?.name ?? 'The protagonist',
  )
  const pov = $derived(story.settings.pov)

  const actionPrefixes = $derived.by(() => {
    switch (pov) {
      case 'third':
        return {
          do: `${protagonistName} `,
          say: `${protagonistName} says, "`,
          think: `${protagonistName} thinks, "`,
          story: '',
          free: '',
        }
      default:
        return {
          do: 'I ',
          say: 'I say, "',
          think: 'I think to myself, "',
          story: '',
          free: '',
        }
    }
  })
  const actionSuffixes = { do: '', say: '"', think: '"', story: '', free: '' }

  // ============================================================================
  // Effects
  // ============================================================================

  $effect(() => {
    ui.setRetryCallback(() => controller.handleRetry())
    return () => ui.setRetryCallback(null)
  })

  $effect(() => {
    ui.setRetryLastMessageCallback(() => controller.handleRetryLastMessage())
    return () => ui.setRetryLastMessageCallback(null)
  })

  $effect(() => {
    const pendingAction = ui.pendingActionChoice
    if (pendingAction && !ui.isGenerating) {
      inputValue = pendingAction
      isRawActionChoice = true
      ui.clearPendingActionChoice()
    }
  })

  // Auto-regenerate suggestions/actions after time-travel delete when no saved actions found
  $effect(() => {
    if (ui.suggestionsRegenerationNeeded && !ui.isGenerating && story.entry.rawEntries.length > 0) {
      ui.suggestionsRegenerationNeeded = false
      controller.regenerateActionsAfterDelete()
    }
  })

  // ============================================================================
  // Event Handlers (thin delegates to controller)
  // ============================================================================

  async function handleRetry() {
    if (ui.isGenerating) return
    await controller.handleRetry()
  }

  function handleSuggestionSelect(text: string) {
    inputValue = text
    document.querySelector('textarea')?.focus()
  }

  async function handleSubmit() {
    if (!inputValue.trim() || ui.isGenerating || !story.isLoaded) return

    ui.clearGenerationError()
    ui.resetScrollBreak()
    ui.clearSuggestions(story.id!)

    const rawInput = inputValue.trim()
    const wasRawActionChoice = isRawActionChoice

    isRawActionChoice = false
    inputValue = ''

    await controller.handleSubmit({
      inputValue: rawInput,
      actionType,
      isRawActionChoice: wasRawActionChoice,
      isCreativeWritingMode,
      actionPrefixes,
      actionSuffixes,
    })
  }

  async function handleStopGeneration() {
    if (!ui.isGenerating) return

    const result = await controller.handleStopGeneration()
    if (result.restoredActionType) actionType = result.restoredActionType
    if (result.restoredWasRawActionChoice !== undefined)
      isRawActionChoice = result.restoredWasRawActionChoice
    if (result.restoredRawInput !== undefined) inputValue = result.restoredRawInput
  }

  function dismissError() {
    ui.clearGenerationError()
  }

  function handleKeydown(event: KeyboardEvent) {
    const isMobile = isTouchDevice()
    const shouldSubmit = isMobile
      ? event.key === 'Enter' && event.shiftKey
      : event.key === 'Enter' && !event.shiftKey
    if (shouldSubmit) {
      event.preventDefault()
      handleSubmit()
    }
  }

  function autoResize(node: HTMLTextAreaElement, _value?: string) {
    function resize() {
      node.style.height = 'auto'
      node.style.height = `${node.scrollHeight}px`
    }
    resize()
    node.addEventListener('input', resize)
    return {
      update(_newValue?: string) {
        resize()
      },
      destroy() {
        node.removeEventListener('input', resize)
      },
    }
  }
</script>

<div class="ml-1 space-y-3">
  {#if ui.lastGenerationError && !ui.isGenerating}
    <div
      class="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
    >
      <div class="flex items-center gap-2 text-sm text-red-400">
        <span>Generation failed. Would you like to try again?</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          onclick={handleRetry}
          class="btn flex items-center gap-1.5 bg-red-500/20 text-sm text-red-400 hover:bg-red-500/30"
          ><RefreshCw class="h-4 w-4" />Retry</button
        >
        <button
          onclick={dismissError}
          class="text-surface-400 hover:bg-surface-700 hover:text-surface-200 rounded p-1.5"
          title="Dismiss"><X class="h-4 w-4" /></button
        >
      </div>
    </div>
  {/if}

  <GrammarCheck text={inputValue} onApplySuggestion={(newText) => (inputValue = newText)} />

  {#if isCreativeWritingMode}
    <div
      class="sm:border-border rounded-lg border-l-0 sm:border sm:border-l-4 sm:shadow-sm {ui.isGenerating
        ? 'sm:border-l-surface-600 bg-surface-400/5'
        : 'border-l-accent-500 bg-card'} relative transition-colors duration-200"
    >
      {#if settings.uiSettings.showWordCount}<div
          class="absolute -top-[2.05rem] -right-3 sm:hidden"
        >
          <div
            class="bg-surface-800 border-surface-500/30 text-surface-400 rounded-tl-md border border-b-0 px-2 py-0.5 text-sm"
          >
            {story.generationContext.wordCount} words
          </div>
        </div>{/if}
      {#if !settings.uiSettings.disableSuggestions}<div class="border-surface-700/30 sm:border-b">
          <Suggestions
            suggestions={ui.suggestions}
            loading={ui.suggestionsLoading}
            onSelect={handleSuggestionSelect}
            onRefresh={() => controller.refreshSuggestions()}
          />
        </div>{/if}
      <div class="mb-3 flex items-center gap-1 sm:mb-0 sm:items-end sm:p-1">
        <div class="relative min-w-0 flex-1">
          <textarea
            bind:value={inputValue}
            use:autoResize={inputValue}
            onkeydown={handleKeydown}
            placeholder="Describe what happens next in the story..."
            class="text-surface-200 placeholder-surface-500 max-h-40 min-h-6 w-full resize-none border-none bg-transparent px-2 text-base leading-relaxed focus:ring-0 focus:outline-none sm:min-h-6"
            rows="1"
          ></textarea>
        </div>
        {#if ui.isGenerating}
          {#if !ui.isRetryingLastMessage}<button
              onclick={handleStopGeneration}
              class="flex h-11 w-11 flex-shrink-0 -translate-y-0.5 animate-pulse items-center justify-center rounded-lg p-0 text-red-400 transition-all hover:text-red-300 active:scale-95 sm:translate-y-0"
              title="Stop generation"><Square class="h-6 w-6" /></button
            >
          {:else}<button
              disabled
              class="flex h-11 w-11 flex-shrink-0 cursor-not-allowed items-center justify-center rounded-lg p-0 text-red-400 opacity-50"
              title="Stop disabled during retry"><Square class="h-6 w-6" /></button
            >{/if}
        {:else}<button
            onclick={handleSubmit}
            disabled={!inputValue.trim() || blockGeneration}
            class="text-accent-400 hover:text-accent-300 hover:bg-accent-500/10 flex h-11 w-11 flex-shrink-0 -translate-y-0.5 items-center justify-center rounded-lg p-0 transition-all active:scale-95 disabled:opacity-50 sm:translate-y-0"
            title={blockGeneration
              ? 'AI configuration incomplete — check Settings'
              : `Send direction (${sendKeyHint})`}><Send class="h-6 w-6" /></button
          >{/if}
      </div>
    </div>
  {:else}
    <div
      class="sm:border-border rounded-lg border-l-0 sm:border sm:border-l-4 sm:shadow-sm {ui.isGenerating
        ? 'sm:border-l-surface-60'
        : `${actionBorderColors[actionType]}`} bg-card relative transition-colors duration-200"
    >
      {#if settings.uiSettings.showWordCount}<div
          class="absolute -top-[2.05rem] -right-3 sm:hidden"
        >
          <div
            class="bg-surface-800 border-surface-500/30 text-surface-400 rounded-tl-md border border-b-0 px-2 py-0.5 text-sm"
          >
            {story.generationContext.wordCount} words
          </div>
        </div>{/if}
      {#if !settings.uiSettings.disableActionPrefixes}
        <div
          class="border-surface-700/30 flex items-center gap-1 px-1 pt-0 pb-0 sm:border-b sm:px-2 sm:py-1"
        >
          {#each actionTypes as type (type)}{@const Icon = actionIcons[type]}<button
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[10px] font-medium transition-all duration-150 sm:flex-none sm:px-3 sm:py-1 sm:text-xs {actionType ===
              type
                ? actionActiveStyles[type]
                : `text-surface-500 hover:${actionButtonStyles[type]}`}"
              onclick={() => (actionType = type)}
              ><Icon class="h-3 w-3 sm:h-3.5 sm:w-3.5" /><span>{actionLabels[type]}</span></button
            >{/each}
        </div>
      {/if}
      <div class="mb-3 flex items-center gap-1 sm:mb-0 sm:items-end sm:p-1">
        <div class="relative min-w-0 flex-1 self-center">
          <textarea
            bind:value={inputValue}
            use:autoResize={inputValue}
            onkeydown={handleKeydown}
            placeholder={actionType === 'story'
              ? 'Describe what happens...'
              : actionType === 'say'
                ? 'What do you say?'
                : actionType === 'think'
                  ? 'What are you thinking?'
                  : actionType === 'free'
                    ? 'Write anything...'
                    : 'What do you do?'}
            class="text-surface-200 placeholder-surface-500 max-h-[160px] min-h-[24px] w-full resize-none border-none bg-transparent px-2 text-base leading-relaxed focus:ring-0 focus:outline-none sm:min-h-[24px]"
            rows="1"
          ></textarea>
        </div>
        {#if ui.isGenerating}
          {#if !ui.isRetryingLastMessage}<button
              onclick={handleStopGeneration}
              class="flex h-11 w-11 shrink-0 -translate-y-0.5 animate-pulse items-center justify-center rounded-lg p-0 text-red-400 transition-all hover:text-red-300 active:scale-95 sm:translate-y-0"
              title="Stop generation"><Square class="h-6 w-6" /></button
            >
          {:else}<button
              disabled
              class="flex h-11 w-11 shrink-0 cursor-not-allowed items-center justify-center rounded-lg p-0 text-red-400 opacity-50"
              title="Stop disabled during retry"><Square class="h-6 w-6" /></button
            >{/if}
        {:else}<button
            onclick={handleSubmit}
            disabled={!inputValue.trim() || blockGeneration}
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg p-0 transition-all active:scale-95 disabled:opacity-50 {actionButtonStyles[
              actionType
            ]} -translate-y-0.5 sm:translate-y-0"
            title={blockGeneration
              ? 'AI configuration incomplete — check Settings'
              : `Send (${sendKeyHint})`}><Send class="h-6 w-6" /></button
          >{/if}
      </div>
    </div>
  {/if}
</div>
