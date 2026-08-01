<script lang="ts">
  import { Trash2, Clock, Pencil, Check, X } from 'lucide-svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Card from '$lib/components/ui/card'
  import TagBadge from '$lib/components/tags/TagBadge.svelte'
  import type { Story } from '$lib/types'

  interface Props {
    story: Story
    onOpen: (id: string) => void
    onDelete: (id: string, event: MouseEvent) => void
    onRename: (id: string, title: string) => void
  }

  let { story: s, onOpen, onDelete, onRename }: Props = $props()

  let editing = $state(false)
  let editValue = $state('')
  let inputEl: HTMLInputElement | null = $state(null)
  // Set by any path that ends editing without saving, so the blur that fires as the
  // input is torn down cannot resurrect the discarded value. The X button suppresses
  // its own blur via onmousedown, but Escape has no such lever, and whether removing a
  // focused element fires blur at all differs between engines (notably the Android
  // WebView). Guarding the commit is the only way that holds in both cases.
  let cancelled = false

  $effect(() => {
    if (editing && inputEl) {
      inputEl.focus()
      inputEl.select()
    }
  })

  function startEdit(e: MouseEvent) {
    e.stopPropagation()
    editValue = s.title
    cancelled = false
    editing = true
  }

  function commitEdit(e?: MouseEvent) {
    e?.stopPropagation()
    if (cancelled) return

    const trimmed = editValue.trim()
    editing = false
    if (trimmed && trimmed !== s.title) {
      onRename(s.id, trimmed)
    }
  }

  function cancelEdit(e?: MouseEvent) {
    e?.stopPropagation()
    cancelled = true
    editing = false
  }

  function handleInputKeydown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function getGenreColor(genre: string | null): string {
    switch (genre) {
      case 'Fantasy':
        return 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20'
      case 'Sci-Fi':
        return 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20'
      case 'Mystery':
        return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20'
      case 'Horror':
        return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20'
      case 'Slice of Life':
        return 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20'
      case 'Historical':
        return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20'
      default:
        return 'bg-secondary text-secondary-foreground border-border'
    }
  }
</script>

<div
  role="button"
  tabindex="0"
  onclick={() => !editing && onOpen(s.id)}
  onkeydown={(e) => e.key === 'Enter' && !editing && onOpen(s.id)}
  class="h-full"
>
  <Card.Root
    class="group hover:border-primary relative h-full cursor-pointer overflow-hidden transition-all hover:shadow-md"
  >
    <Card.Header>
      <div class="flex items-center justify-between gap-2">
        {#if editing}
          <div
            class="flex flex-1 items-center gap-1"
            onclick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <Input
              bind:ref={inputEl}
              bind:value={editValue}
              class="h-8 flex-1"
              enterkeyhint="done"
              onkeydown={handleInputKeydown}
              onblur={() => commitEdit()}
            />
            <Button
              icon={Check}
              variant="ghost"
              class="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 hover:bg-transparent"
              size="icon"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={commitEdit}
              title="Save title"
            />
            <Button
              icon={X}
              variant="ghost"
              class="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 hover:bg-transparent"
              size="icon"
              onmousedown={(e: MouseEvent) => e.preventDefault()}
              onclick={cancelEdit}
              title="Cancel"
            />
          </div>
        {:else}
          <Card.Title class="truncate text-lg leading-tight font-semibold">
            {s.title}
          </Card.Title>
          <div class="flex shrink-0 items-center">
            <Button
              icon={Pencil}
              variant="ghost"
              class="text-muted-foreground hover:text-foreground h-8 w-8 hover:bg-transparent"
              size="icon"
              onclick={startEdit}
              title="Rename story"
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
        {/if}
      </div>
      {#if s.genre}
        <div>
          <TagBadge name={s.genre} color={getGenreColor(s.genre)} />
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
