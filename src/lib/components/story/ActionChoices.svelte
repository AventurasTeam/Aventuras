<script lang="ts">
  import { story } from '$lib/stores/story/index.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Sword, MessageCircle, Search, MapPin, Loader2 } from 'lucide-svelte'
  import type { ActionChoice } from '$lib/services/ai/sdk/schemas/actionchoices'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'

  // Icon mapping for choice types
  const typeIcons = {
    action: Sword,
    dialogue: MessageCircle,
    examine: Search,
    move: MapPin,
  }

  // Style classes for choice types
  const typeStyles = {
    action: 'border-l-red-500/50 hover:border-l-red-400',
    dialogue: 'border-l-blue-500/50 hover:border-l-blue-400',
    examine: 'border-l-yellow-500/50 hover:border-l-yellow-400',
    move: 'border-l-green-500/50 hover:border-l-green-400',
  }

  function handleChoiceClick(choice: ActionChoice) {
    // Set the pending action choice - ActionInput will pick this up and submit
    ui.setPendingActionChoice(choice.text, story.currentStory?.id)
  }

  // Key bindings for quick selection (1-4)
  function handleKeydown(event: KeyboardEvent) {
    if (ui.actionChoices.length === 0) return

    const target = (event.target ?? document.activeElement) as HTMLElement | null
    if (
      target &&
      (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
    ) {
      return
    }

    const keyNum = parseInt(event.key)
    if (keyNum >= 1 && keyNum <= ui.actionChoices.length) {
      event.preventDefault()
      handleChoiceClick(ui.actionChoices[keyNum - 1])
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if ui.actionChoicesLoading}
  <div class="text-muted-foreground flex items-center justify-center gap-2 py-4">
    <Loader2 class="h-4 w-4 animate-spin" />
    <span class="text-sm">Generating options...</span>
  </div>
{:else if ui.actionChoices.length > 0}
  <div
    class="border-border border-l-muted-foreground/20 mt-3 space-y-2 rounded-lg border border-l-4 p-3 shadow-sm sm:mt-4 sm:p-4 {story.currentBgImage
      ? 'bg-card/60 backdrop-blur-md'
      : 'bg-card'}"
  >
    <div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs tracking-wide uppercase">
      <span>What do you do?</span>
      <span class="text-muted-foreground/60 hidden sm:inline"
        >(Press 1-{ui.actionChoices.length} to quick select)</span
      >
    </div>

    {#each ui.actionChoices as choice, index (index)}
      {@const Icon = typeIcons[choice.type]}
      <Button
        variant="secondary"
        class={cn(
          'group relative flex h-auto min-h-13 w-full justify-start space-x-1 overflow-hidden px-3 py-3 transition-all duration-150 sm:px-4',
          'border-border/40 rounded-l-none border border-l-4',
          'bg-secondary/30 hover:bg-secondary/60',
          typeStyles[choice.type],
        )}
        onclick={() => handleChoiceClick(choice)}
      >
        <span
          class="bg-background/50 text-muted-foreground group-hover:bg-background group-hover:text-foreground flex h-6 w-6 shrink-0
                     items-center justify-center rounded font-mono text-sm"
        >
          {index + 1}
        </span>
        <Icon class="text-muted-foreground group-hover:text-foreground h-4 w-4 shrink-0" />
        <span
          class="text-foreground text-left text-sm wrap-break-word whitespace-normal sm:text-base"
        >
          {choice.text}
        </span>
      </Button>
    {/each}
  </div>
{/if}
