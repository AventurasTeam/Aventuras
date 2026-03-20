<script lang="ts">
  import { story } from '$lib/stores/story/index.svelte'
  import { Lightbulb, ArrowRight, Loader2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-svelte'
  import type { Suggestion } from '$lib/services/ai/sdk/schemas/suggestions'
  import { swipe } from '$lib/utils/swipe'

  interface Props {
    suggestions: Suggestion[]
    loading: boolean
    onSelect: (text: string) => void
    onRefresh: () => void
  }

  let { suggestions, loading, onSelect, onRefresh }: Props = $props()

  // Collapsed state - always starts collapsed to avoid interrupting the flow
  let collapsed = $state(true)

  const typeColors: Record<string, string> = {
    action: 'text-blue-400',
    dialogue: 'text-green-400',
    revelation: 'text-yellow-400',
    twist: 'text-purple-400',
  }

  const typeLabels: Record<string, string> = {
    action: 'Action',
    dialogue: 'Dialogue',
    revelation: 'Revelation',
    twist: 'Twist',
  }

  // Swipe handlers for mobile
  function handleSwipeDown() {
    if (!collapsed) {
      collapsed = true
    }
  }

  function handleSwipeUp() {
    if (collapsed) {
      collapsed = false
    }
  }
</script>

{#if story.generationContext?.storyMode === 'creative-writing'}
  <div
    class="px-2 pt-0.5 pb-2 sm:py-2 {!collapsed ? '-mt-2' : ''}"
    use:swipe={{
      onSwipeDown: handleSwipeDown,
      onSwipeUp: handleSwipeUp,
      threshold: 40,
    }}
  >
    <!-- Header - always visible, clickable to expand/collapse. Swipe down to collapse, swipe up to expand -->
    <button
      class="group flex w-full items-center justify-between py-0 text-left"
      onclick={() => (collapsed = !collapsed)}
    >
      <div class="text-surface-300 flex items-center gap-2">
        <Lightbulb class="h-4 w-4" />
        <span class="text-sm font-medium">What happens next?</span>
        {#if collapsed && suggestions.length > 0}
          <span class="text-surface-500 text-xs">({suggestions.length} suggestions)</span>
        {/if}
      </div>
      <div class="flex items-center gap-1">
        {#if !collapsed}
          <!-- svelte-ignore node_invalid_placement_ssr -->
          <button
            class="btn-ghost text-surface-400 hover:text-surface-200 rounded p-1.5"
            onclick={(e) => {
              e.stopPropagation()
              onRefresh()
            }}
            disabled={loading}
            title="Generate new suggestions"
          >
            <RefreshCw class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
          </button>
        {/if}
        <span class="text-surface-500 group-hover:text-surface-300 transition-colors">
          {#if collapsed}
            <ChevronDown class="h-4 w-4" />
          {:else}
            <ChevronUp class="h-4 w-4" />
          {/if}
        </span>
      </div>
    </button>

    <!-- Content - collapsible -->
    {#if !collapsed}
      <div class="mt-0 pb-2">
        {#if loading}
          <div class="text-surface-400 flex items-center justify-center py-2">
            <Loader2 class="mr-2 h-5 w-5 animate-spin" />
            <span class="text-sm">Generating suggestions...</span>
          </div>
        {:else if suggestions.length === 0}
          <div class="text-surface-500 py-1 text-center text-sm">
            No suggestions available. Click refresh to generate some.
          </div>
        {:else}
          <div class="space-y-1.5 pt-0.5">
            {#each suggestions as suggestion (suggestion.text)}
              <button
                class="card hover:bg-surface-700/50 group w-full p-2.5 text-left transition-colors"
                onclick={() => {
                  onSelect(suggestion.text)
                  collapsed = true
                }}
              >
                <div class="flex items-start gap-3">
                  <ArrowRight
                    class="text-surface-500 group-hover:text-primary-400 mt-0.5 h-4 w-4 shrink-0 transition-colors"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-surface-200 group-hover:text-surface-100 text-sm">
                      {suggestion.text}
                    </p>
                    <span class="text-xs {typeColors[suggestion.type]} mt-1 inline-block">
                      {typeLabels[suggestion.type]}
                    </span>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}
