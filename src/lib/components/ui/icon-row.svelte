<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import { Trash2, X, Check } from '@lucide/svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    onDelete?: () => void
    class?: string
    children?: Snippet
    confirmMessage?: string
    size?: 'default' | 'sm' | 'lg' | 'icon'
    showDelete?: boolean
  }

  let {
    onDelete,
    class: className,
    children,
    confirmMessage = 'Delete?',
    size = 'icon',
    showDelete = true,
  }: Props = $props()

  let confirming = $state(false)
</script>

<div class="flex shrink-0 items-center gap-1 {className}">
  {#if confirming}
    <span class="text-muted-foreground text-xs font-medium">
      {confirmMessage}
    </span>
    <Button
      variant="text"
      {size}
      class="text-muted-foreground hover:text-foreground h-6 w-5 hover:bg-transparent"
      onclick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        confirming = false
      }}
      title="Cancel"
    >
      <X class="h-3.5 w-3.5" />
    </Button>
    <Button
      variant="text"
      {size}
      class="text-destructive h-6 w-5 hover:bg-transparent"
      onclick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        confirming = false
        onDelete?.()
      }}
      title="Confirm Delete"
    >
      <Check class="h-3.5 w-3.5" />
    </Button>
  {:else}
    {#if children}
      {@render children()}
    {/if}
    {#if onDelete && showDelete}
      <Button
        variant="text"
        {size}
        class="text-muted-foreground hover:text-destructive h-6 w-6"
        onclick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          confirming = true
        }}
        title="Delete"
      >
        <Trash2 class="h-3.5 w-3.5" />
      </Button>
    {/if}
  {/if}
</div>
