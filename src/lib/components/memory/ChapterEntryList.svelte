<script lang="ts">
  import type { StoryEntry } from '$lib/types'
  import { slide } from 'svelte/transition'
  import { MessageSquare, Scroll } from '@lucide/svelte'
  import { Badge } from '$lib/components/ui/badge'
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { entryNumber, jumpToEntry } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'

  interface Props {
    entries: StoryEntry[]
    expanded: boolean
  }

  let { entries, expanded }: Props = $props()

  function truncate(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength).trim() + '...'
  }

  function getEntryIcon(type: StoryEntry['type']) {
    switch (type) {
      case 'user_action':
        return MessageSquare
      case 'narration':
        return Scroll
      default:
        return Scroll
    }
  }

  function getEntryLabel(type: StoryEntry['type']): string {
    switch (type) {
      case 'user_action':
        return 'ACTION'
      // `retry` is narration in older saves; nothing creates one now.
      case 'narration':
      case 'retry':
        return 'NARRATIVE'
      default:
        return 'ENTRY'
    }
  }

  function goToEntry(entry: StoryEntry) {
    jumpToEntry({
      entries: story.entries,
      entryId: entry.id,
      ui,
      confirmation: `Jumped to entry ${entryNumber(entry)}`,
      canHover: supportsHover(),
    })
  }
</script>

{#if expanded && entries.length > 0}
  <div class="mt-2 space-y-1 border-l-2 pl-2" transition:slide={{ duration: 200 }}>
    <!-- Uncapped: the card advertises a range, so every entry in it has to be reachable. -->
    {#each entries as entry (entry.id)}
      {@const Icon = getEntryIcon(entry.type)}
      {@const number = entryNumber(entry)}
      <div class="flex items-start gap-2 py-1 text-xs">
        <!-- Fixed width so the numbers line up down the list, whatever each chip says. -->
        <div class="flex w-[5.5rem] shrink-0 flex-col items-center gap-0.5">
          <Badge
            variant={entry.type === 'user_action' ? 'secondary' : 'outline'}
            class="flex h-5 w-full items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
          >
            <Icon class="h-3 w-3" />
            <span>{getEntryLabel(entry.type)}</span>
          </Badge>
          <button
            type="button"
            class="text-muted-foreground focus-visible:ring-ring hover:text-primary rounded px-1 tabular-nums underline-offset-2 transition-opacity hover:underline focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Go to entry {number}"
            title="Go to entry {number}"
            onclick={() => goToEntry(entry)}
          >
            Entry {number}
          </button>
        </div>
        <span class="text-muted-foreground mt-0.5 leading-relaxed">
          {truncate(entry.content, 120)}
        </span>
      </div>
    {/each}
  </div>
{/if}
