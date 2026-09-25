<script lang="ts">
  import type { StoryEntry } from '$lib/types'
  import { slide } from 'svelte/transition'
  import { MessageSquare, Scroll, MilestoneIcon } from '@lucide/svelte'
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
      case 'narration':
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
  <div class="space-y-1 border-l-2 pt-2 pl-2" transition:slide={{ duration: 200 }}>
    <p class="text-muted-foreground border-border mr-2 border-b px-1 pb-1.5 text-xs">
      Select an entry to jump to it in the story.
    </p>
    <!-- Uncapped: the card advertises a range, so every entry in it has to be reachable. -->
    {#each entries as entry (entry.id)}
      {@const Icon = getEntryIcon(entry.type)}
      {@const number = entryNumber(entry)}
      <button
        type="button"
        class="hover:bg-surface-700/50 focus-visible:ring-ring flex w-full items-start gap-2 rounded-lg p-1 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
        title="Go to entry {number}"
        onclick={() => goToEntry(entry)}
      >
        <!-- Fixed width so the numbers line up down the list, whatever each chip says. -->
        <span class="flex w-[5.5rem] shrink-0 flex-col items-center gap-0.5">
          <Badge
            variant={entry.type === 'user_action' ? 'secondary' : 'outline'}
            class="flex h-5 w-full items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
          >
            <Icon class="h-3 w-3" />
            <span>{getEntryLabel(entry.type)}</span>
          </Badge>
          <span class="text-muted-foreground flex gap-1">
            <MilestoneIcon class="h-4 w-4" />
            {number}
          </span>
        </span>
        <span class="text-muted-foreground mt-0.5 leading-relaxed">
          {truncate(entry.content, 120)}
        </span>
      </button>
    {/each}
  </div>
{/if}
