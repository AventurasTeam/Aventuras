<script lang="ts">
  import type { StoryEntry } from '$lib/types'
  import { slide } from 'svelte/transition'
  import { MessageSquare, Scroll } from '@lucide/svelte'
  import { Badge } from '$lib/components/ui/badge'

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
</script>

{#if expanded && entries.length > 0}
  <div class="mt-2 space-y-1 border-l-2 pl-2" transition:slide={{ duration: 200 }}>
    {#each entries.slice(0, 10) as entry (entry.id)}
      {@const Icon = getEntryIcon(entry.type)}
      <div class="flex items-start gap-2 py-1 text-xs">
        <Badge
          variant={entry.type === 'user_action' ? 'secondary' : 'outline'}
          class="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
        >
          <Icon class="h-3 w-3" />
          <span>{getEntryLabel(entry.type)}</span>
        </Badge>
        <span class="text-muted-foreground mt-0.5 leading-relaxed">
          {truncate(entry.content, 120)}
        </span>
      </div>
    {/each}
    {#if entries.length > 10}
      <div class="text-muted-foreground py-1 text-xs">
        ... {entries.length - 10} more entries
      </div>
    {/if}
  </div>
{/if}
