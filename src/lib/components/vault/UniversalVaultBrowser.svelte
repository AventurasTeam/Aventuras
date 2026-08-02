<script lang="ts">
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import { scenarioVault } from '$lib/stores/scenarioVault.svelte'
  import type { VaultCharacter, VaultLorebook, VaultScenario } from '$lib/types'
  import { User, Archive, MapPin, Link } from '@lucide/svelte'
  import { normalizeImageDataUrl } from '$lib/utils/image'
  import { Badge } from '$lib/components/ui/badge'
  import * as Avatar from '$lib/components/ui/avatar'
  import VaultListItem from './shared/VaultListItem.svelte'
  import VaultBrowser from './shared/VaultBrowser.svelte'

  type VaultType = 'character' | 'lorebook' | 'scenario'

  type VaultItem = any // Union type is hard to work with in generic props

  interface Props {
    type: VaultType
    onSelect: (item: VaultItem) => void
    selectedId?: string | null
    disabledIds?: string[] // IDs that should be disabled/marked as added
    onNavigateToVault?: () => void
  }

  let { type, onSelect, selectedId = null, disabledIds = [], onNavigateToVault }: Props = $props()

  // Store Selection

  const store = $derived(
    type === 'character' ? characterVault : type === 'lorebook' ? lorebookVault : scenarioVault,
  ) as any

  const items = $derived(
    type === 'character'
      ? characterVault.characters
      : type === 'lorebook'
        ? lorebookVault.lorebooks
        : scenarioVault.scenarios,
  )

  // Configuration based on type
  const config = $derived(
    {
      character: {
        icon: User,
        emptyTitle: 'No characters in vault',
        emptyDesc: 'Create or import characters in the vault to use them here.',
        searchPlaceholder: 'Search characters...',
      },
      lorebook: {
        icon: Archive,
        emptyTitle: 'No lorebooks in vault',
        emptyDesc: 'Create or import lorebooks in the vault to use them here.',
        searchPlaceholder: 'Search lorebooks...',
      },
      scenario: {
        icon: MapPin,
        emptyTitle: 'No scenarios in vault',
        emptyDesc: 'Create or import scenarios in the vault to use them here.',
        searchPlaceholder: 'Search scenarios...',
      },
    }[type],
  )

  $effect(() => {
    if (!store.isLoaded) {
      store.load()
    }
  })

  function handleSelect(item: VaultItem) {
    onSelect(item)
  }

  function isSelected(id: string): boolean {
    return selectedId === id
  }

  function isDisabled(id: string): boolean {
    return disabledIds.includes(id)
  }

  function filterItem(item: VaultItem, query: string): boolean {
    const commonMatch =
      item.name.toLowerCase().includes(query) ||
      (item.description?.toLowerCase().includes(query) ?? false) ||
      item.tags.some((t: string) => t.toLowerCase().includes(query))

    if (type === 'character') {
      return (
        commonMatch || (item as VaultCharacter).traits.some((t) => t.toLowerCase().includes(query))
      )
    }

    return commonMatch
  }

  function sortItems(a: VaultItem, b: VaultItem): number {
    if (a.favorite && !b.favorite) return -1
    if (!a.favorite && b.favorite) return 1
    return b.updatedAt - a.updatedAt
  }
</script>

<VaultBrowser
  {items}
  isLoading={!store.isLoaded}
  searchPlaceholder={config.searchPlaceholder}
  emptyIcon={config.icon}
  emptyTitle={config.emptyTitle}
  emptyDescription={config.emptyDesc}
  {onNavigateToVault}
  {filterItem}
  {sortItems}
  key={(item) => item.id}
>
  {#snippet renderItem(item: VaultItem)}
    {#if type === 'character'}
      {@const char = item as VaultCharacter}
      <VaultListItem
        title={char.name}
        subtitle=""
        selected={isSelected(char.id)}
        disabled={isDisabled(char.id)}
        onclick={() => handleSelect(char)}
      >
        {#snippet icon()}
          <Avatar.Root class="h-10 w-10 border shadow-sm">
            <Avatar.Image
              src={normalizeImageDataUrl(char.portrait) ?? ''}
              alt={char.name}
              class="object-cover"
            />
            <Avatar.Fallback class="bg-muted text-muted-foreground">
              <User class="h-5 w-5" />
            </Avatar.Fallback>
          </Avatar.Root>
        {/snippet}

        {#snippet badges()}
          {#if char.metadata?.linkedLorebookId}
            {@const lbName = lorebookVault.getById(char.metadata.linkedLorebookId as string)?.name}
            <span class="text-muted-foreground flex max-w-40 items-center gap-1 text-[10px]">
              <Link class="h-3 w-3 shrink-0" />
              <span class="truncate">{lbName ?? 'Lorebook'}</span>
            </span>
          {/if}
        {/snippet}

        {#snippet end()}
          {#if isSelected(char.id)}
            <Badge variant="default" class="h-5 px-1.5 text-[10px]">Selected</Badge>
          {:else if isDisabled(char.id)}
            <div class="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">Added</div>
          {/if}
        {/snippet}
      </VaultListItem>
    {:else if type === 'lorebook'}
      {@const book = item as VaultLorebook}
      <VaultListItem
        title={book.name}
        subtitle={`${book.entries.length} entries`}
        selected={isSelected(book.id)}
        disabled={isDisabled(book.id)}
        onclick={() => handleSelect(book)}
      >
        {#snippet icon()}
          <Archive class="text-accent-400 h-5 w-5" />
        {/snippet}
        {#snippet badges()}
          {#if (book.metadata as Record<string, unknown>)?.linkedFromName}
            <span class="text-muted-foreground flex items-center gap-1 text-[10px]">
              <Link class="h-3 w-3" />
              {(book.metadata as Record<string, unknown>).linkedFromName}
            </span>
          {/if}
        {/snippet}
        {#snippet end()}
          {#if isSelected(book.id)}
            <Badge variant="default" class="h-5 px-1.5 text-[10px]">Selected</Badge>
          {:else if isDisabled(book.id)}
            <div class="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">Added</div>
          {/if}
        {/snippet}
      </VaultListItem>
    {:else if type === 'scenario'}
      {@const scen = item as VaultScenario}
      <VaultListItem
        title={scen.name}
        subtitle={`${scen.npcs.length} NPCs`}
        selected={isSelected(scen.id)}
        disabled={isDisabled(scen.id)}
        onclick={() => handleSelect(scen)}
      >
        {#snippet icon()}
          <MapPin class="h-5 w-5 text-green-400" />
        {/snippet}
        {#snippet badges()}
          {#if scen.metadata?.linkedLorebookId}
            {@const lbName = lorebookVault.getById(scen.metadata.linkedLorebookId)?.name}
            <span class="text-muted-foreground flex max-w-40 items-center gap-1 text-[10px]">
              <Link class="h-3 w-3 shrink-0" />
              <span class="truncate">{lbName ?? 'Lorebook'}</span>
            </span>
          {/if}
        {/snippet}
        {#snippet end()}
          {#if isSelected(scen.id)}
            <div class="rounded bg-green-500/20 px-1.5 py-0.5 text-xs text-green-400">Selected</div>
          {:else if isDisabled(scen.id)}
            <div class="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">Added</div>
          {/if}
        {/snippet}
      </VaultListItem>
    {/if}
  {/snippet}
</VaultBrowser>
