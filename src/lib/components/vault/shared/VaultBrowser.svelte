<script lang="ts" generics="T">
  import { Search } from '@lucide/svelte'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'
  import type { Snippet } from 'svelte'

  interface Props {
    items: T[]
    isLoading?: boolean
    searchPlaceholder?: string

    // Empty State configuration

    emptyIcon: any
    emptyTitle: string
    emptyDescription?: string
    onNavigateToVault?: () => void

    // Logic
    filterItem: (item: T, query: string) => boolean
    sortItems?: (a: T, b: T) => number

    // Render
    renderItem: Snippet<[T]>
    key: (item: T) => string
  }

  let {
    items,
    isLoading = false,
    searchPlaceholder = 'Search...',
    emptyIcon,
    emptyTitle,
    emptyDescription = 'No items found in vault',
    onNavigateToVault,
    filterItem,
    sortItems,
    renderItem,
    key,
  }: Props = $props()

  let searchQuery = $state('')

  const filteredItems = $derived.by(() => {
    let result = items

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter((item) => filterItem(item, query))
    }

    if (sortItems) {
      return [...result].sort(sortItems)
    }

    return result
  })

  const hasItems = $derived(items.length > 0)
</script>

<div
  class="border-muted-foreground/20 bg-muted/10 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border"
>
  <!-- Search -->
  {#if hasItems || isLoading}
    <div class="border-muted-foreground/10 bg-background/50 relative shrink-0 border-b">
      <div class="text-muted-foreground absolute top-2.5 left-2.5">
        <Search class="h-4 w-4" />
      </div>
      <input
        type="text"
        bind:value={searchQuery}
        placeholder={searchPlaceholder}
        class="placeholder:text-muted-foreground w-full bg-transparent py-2.5 pr-4 pl-9 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isLoading}
      />
    </div>
  {/if}

  <!-- List -->
  <ScrollArea class="w-full flex-1">
    <div class="p-2">
      {#if isLoading}
        <div class="space-y-3 p-2">
          {#each Array(3) as _, i (i)}
            <div class="flex items-center space-x-4">
              <Skeleton class="h-10 w-10 rounded-full" />
              <div class="space-y-2">
                <Skeleton class="h-4 w-[150px]" />
                <Skeleton class="h-3 w-[100px]" />
              </div>
            </div>
          {/each}
        </div>
      {:else if filteredItems.length === 0}
        <div class="flex h-full flex-col items-center justify-center p-4 py-8">
          <EmptyState
            icon={emptyIcon}
            title={searchQuery ? 'No matches found' : emptyTitle}
            description={searchQuery ? 'Try adjusting your search query' : emptyDescription}
            actionLabel={!searchQuery && onNavigateToVault ? 'Go to Vault' : undefined}
            onAction={!searchQuery && onNavigateToVault ? onNavigateToVault : undefined}
            class="py-2"
            size="sm"
          />
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {#each filteredItems as item (key(item))}
            {@render renderItem(item)}
          {/each}
        </div>
      {/if}
    </div>
  </ScrollArea>
</div>
