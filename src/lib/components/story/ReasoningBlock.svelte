<script lang="ts">
  import { slide } from 'svelte/transition'
  import { parseMarkdown } from '$lib/utils/markdown'
  import { ui } from '$lib/stores/ui.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { Brain } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'

  let {
    content,
    isStreaming = false,
    isReasoningPhase = false,
    entryId,
    showToggleOnly = false,
  }: {
    content: string
    isStreaming?: boolean
    isReasoningPhase?: boolean
    entryId?: string
    showToggleOnly?: boolean
  } = $props()

  // Use persistent state from UI store shared between StoryEntry and StreamingEntry
  let isOpen = $derived.by(() => {
    if (isStreaming) {
      return ui.streamingReasoningExpanded
    }
    return entryId ? ui.isReasoningExpanded(entryId) : false
  })

  // Toggle function that updates the appropriate store (only when enabled)
  function toggleOpen() {
    if (!isToggleEnabled) return

    if (isStreaming) {
      ui.setStreamingReasoningExpanded(!isOpen)
    } else if (entryId) {
      ui.toggleReasoningExpanded(entryId, !isOpen)
    }
  }

  // Toggle is only enabled when showReasoning is on (regardless of streaming state)
  let isToggleEnabled = $derived(settings.uiSettings.showReasoning)

  // Content panel visibility respects the setting
  let isContentVisible = $derived(settings.uiSettings.showReasoning)

  let renderedContent = $derived(parseMarkdown(content))
</script>

{#if showToggleOnly}
  <!-- Toggle-only mode: just the icon button for header row -->
  <Button
    variant="text"
    size="icon"
    class={cn(
      'relative h-6 w-6',
      !isToggleEnabled && 'cursor-not-allowed opacity-50',
      isStreaming ? 'text-blue-400' : isOpen ? 'text-foreground' : 'text-muted-foreground',
    )}
    onclick={toggleOpen}
    disabled={!isToggleEnabled}
    title={isToggleEnabled
      ? isOpen
        ? 'Hide thinking'
        : 'Show thinking'
      : 'Reasoning display is disabled in settings'}
  >
    <Brain class={cn('h-3.5 w-3.5', isReasoningPhase && 'animate-pulse')} />
    {#if isStreaming}
      <span class="absolute top-0.5 right-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400"
      ></span>
    {/if}
  </Button>
{:else}
  <!-- Content panel mode: the expanded reasoning content -->
  {#if isContentVisible && isOpen}
    <div class="mb-2 py-2" transition:slide>
      <div class="text-muted-foreground prose-content text-xs leading-relaxed break-words italic">
        {@html renderedContent}
      </div>
    </div>
  {/if}
{/if}
