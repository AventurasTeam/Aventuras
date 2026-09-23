<script lang="ts">
  import { Trash2, Clock, Pencil } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import TagBadge from '$lib/components/tags/TagBadge.svelte'
  import type { Story } from '$lib/types'
  import { resolveGenreColor } from './genreColors'

  interface Props {
    story: Story
    onOpen: (id: string) => void
    onDelete: (id: string, event: MouseEvent) => void
    onEdit: (story: Story) => void
  }

  let { story: s, onOpen, onDelete, onEdit }: Props = $props()

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
</script>

<!--
  Enter opens the story only when the card itself has focus: Enter on the edit or delete button
  bubbles here too, and must not open the story behind the dialog it opened.
-->
<div
  role="button"
  tabindex="0"
  onclick={() => onOpen(s.id)}
  onkeydown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(s.id)}
  class="h-full"
>
  <Card.Root
    class="group hover:border-primary relative h-full cursor-pointer overflow-hidden transition-all hover:shadow-md"
  >
    <Card.Header>
      <div class="flex items-center justify-between gap-2">
        <Card.Title class="truncate text-lg leading-tight font-semibold">
          {s.title}
        </Card.Title>
        <div class="flex shrink-0 items-center">
          <Button
            icon={Pencil}
            variant="ghost"
            class="text-muted-foreground hover:text-foreground h-8 w-8 hover:bg-transparent"
            size="icon"
            onclick={(e) => {
              e.stopPropagation()
              onEdit(s)
            }}
            title="Edit story"
          />
          <Button
            icon={Trash2}
            variant="ghost"
            class="text-muted-foreground hover:text-foreground h-8 w-8 hover:bg-transparent"
            size="icon"
            onclick={(e) => onDelete(s.id, e)}
            title="Delete story"
          />
        </div>
      </div>
      {#if s.genre}
        <div>
          <TagBadge name={s.genre} color={resolveGenreColor(s.genre, s.settings?.genreColor)} />
        </div>
      {/if}
    </Card.Header>
    <Card.Content>
      {#if s.description}
        <p class="text-muted-foreground line-clamp-3 text-sm">
          {s.description}
        </p>
      {:else}
        <p class="text-muted-foreground text-sm italic">No description</p>
      {/if}
    </Card.Content>
    <Card.Footer class="text-muted-foreground mt-auto pt-0 text-xs">
      <div class="flex items-center gap-1">
        <Clock class="h-3 w-3" />
        <span>Updated {formatDate(s.updatedAt)}</span>
      </div>
    </Card.Footer>
  </Card.Root>
</div>
