<script lang="ts">
  import { X, Search, Loader2, Filter, Check, EyeOff, Eye, Blend, Globe } from 'lucide-svelte'
  import { discoveryService, type DiscoveryCard, type SearchResult } from '$lib/services/discovery'
  import DiscoveryCardComponent from './DiscoveryCard.svelte'
  import DiscoveryCardDetails from './DiscoveryCardDetails.svelte'
  import { characterVault } from '$lib/stores/characterVault.svelte'
  import { lorebookVault } from '$lib/stores/lorebookVault.svelte'
  import { scenarioVault } from '$lib/stores/scenarioVault.svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Badge } from '$lib/components/ui/badge'
  import * as Select from '$lib/components/ui/select'
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import * as Popover from '$lib/components/ui/popover'
  import * as Command from '$lib/components/ui/command'
  import { cn } from '$lib/utils/cn'
  import { SvelteSet } from 'svelte/reactivity'

  interface Props {
    isOpen: boolean
    mode: 'character' | 'lorebook' | 'scenario'
    onClose: () => void
  }

  let { isOpen, mode, onClose }: Props = $props()

  type NsfwMode = 'disable' | 'blur' | 'enable'
  const NSFW_MODE_STORAGE_KEY = 'aventura:discovery:nsfwMode'

  function loadNsfwMode(): NsfwMode {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(NSFW_MODE_STORAGE_KEY)
      if (stored === 'blur' || stored === 'enable') {
        return stored
      }
    }
    return 'disable'
  }

  let searchQuery = $state('')
  let activeProviderId = $state('all')
  let results = $state<DiscoveryCard[]>([])
  let isLoading = $state(false)
  let hasMore = $state(false)
  let currentPage = $state(1)
  let errorMessage = $state<string | null>(null)
  let nsfwMode = $state<NsfwMode>(loadNsfwMode())
  let hasInitialSearched = $state(false)
  let selectedCard = $state<DiscoveryCard | null>(null)

  let importedUrls = $derived.by(() => {
    const urls = new SvelteSet<string>()
    if (mode === 'character') {
      for (const c of characterVault.characters) {
        if (c.metadata?.sourceUrl) urls.add(String(c.metadata.sourceUrl))
      }
    } else if (mode === 'lorebook') {
      for (const lb of lorebookVault.lorebooks) {
        if (lb.metadata?.sourceUrl) urls.add(String(lb.metadata.sourceUrl))
      }
    } else if (mode === 'scenario') {
      for (const s of scenarioVault.scenarios) {
        if (s.metadata?.sourceUrl) urls.add(String(s.metadata.sourceUrl))
      }
    }
    return urls
  })

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NSFW_MODE_STORAGE_KEY, nsfwMode)
    }
  })

  let selectedTags = $state<string[]>([])
  let tagInput = $state('')
  let showTagDropdown = $state(false)
  let availableTags = $state<string[]>([])
  let _isLoadingTags = $state(false)

  let providers = $derived(discoveryService.getProviders(mode))

  let tagSuggestions = $derived(
    tagInput.trim()
      ? availableTags
          .filter(
            (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t),
          )
          .slice(0, 30)
      : [],
  )

  let popularTags = $derived(availableTags.slice(0, 20).filter((t) => !selectedTags.includes(t)))

  async function loadTags() {
    _isLoadingTags = true
    try {
      if (activeProviderId === 'all') {
        availableTags = await discoveryService.getAllTags(mode)
      } else {
        availableTags = await discoveryService.getTags(activeProviderId)
      }
      console.log(`[Discovery] Loaded ${availableTags.length} tags`)
    } catch (error) {
      console.error('[Discovery] Failed to load tags:', error)
      availableTags = []
    } finally {
      _isLoadingTags = false
    }
  }

  $effect(() => {
    if (isOpen) {
      loadTags()
      if (!hasInitialSearched) {
        hasInitialSearched = true
        handleSearch()
      }
    } else {
      hasInitialSearched = false
    }
  })

  $effect(() => {
    const _providerId = activeProviderId
    if (isOpen) {
      loadTags()
    }
  })

  $effect(() => {
    const _mode = mode
    results = []
    currentPage = 1
    hasMore = false
    errorMessage = null
    selectedTags = []
  })

  async function handleSearch() {
    isLoading = true
    errorMessage = null
    currentPage = 1

    try {
      let result: SearchResult
      const searchOptions = {
        query: searchQuery,
        page: 1,
        limit: 48,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      }

      if (activeProviderId === 'all') {
        result = await discoveryService.searchAll(searchOptions, mode)
      } else {
        result = await discoveryService.search(activeProviderId, searchOptions, mode)
      }

      results = result.cards
      hasMore = result.hasMore
      currentPage = result.nextPage || 1
    } catch (error) {
      console.error('[Discovery] Search error:', error)
      errorMessage = error instanceof Error ? error.message : 'Search failed'
      results = []
    } finally {
      isLoading = false
    }
  }

  async function loadMore() {
    if (!hasMore || isLoading) return

    isLoading = true

    try {
      let result: SearchResult

      if (activeProviderId === 'all') {
        result = await discoveryService.loadMoreAll(mode, 48)
      } else {
        const searchOptions = {
          query: searchQuery,
          page: currentPage,
          limit: 48,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        }
        result = await discoveryService.search(activeProviderId, searchOptions, mode)
        currentPage = result.nextPage || currentPage + 1
      }

      results = [...results, ...result.cards]
      hasMore = result.hasMore
    } catch (error) {
      console.error('[Discovery] Load more error:', error)
      errorMessage = error instanceof Error ? error.message : 'Failed to load more'
    } finally {
      isLoading = false
    }
  }

  async function handleImport(card: DiscoveryCard) {
    const sourceId = card.imageUrl || card.avatarUrl
    if (sourceId && importedUrls.has(sourceId)) return

    errorMessage = null

    try {
      if (mode === 'character') {
        await characterVault.importFromDiscovery(card)
      } else if (mode === 'lorebook') {
        await lorebookVault.importFromDiscovery(card)
      } else if (mode === 'scenario') {
        await scenarioVault.importFromDiscovery(card)
      }
      console.log('[Discovery] Started background import:', card.name)
    } catch (error) {
      console.error('[Discovery] Import error:', error)
      errorMessage = error instanceof Error ? error.message : 'Import failed'
    }
  }

  function toggleTag(tag: string) {
    if (selectedTags.includes(tag)) {
      selectedTags = selectedTags.filter((t) => t !== tag)
    } else {
      selectedTags = [...selectedTags, tag]
    }
  }

  function addCustomTag() {
    const tag = tagInput.trim()
    if (tag && !selectedTags.includes(tag)) {
      selectedTags = [...selectedTags, tag]
    }
    tagInput = ''
  }

  function removeTag(tag: string) {
    selectedTags = selectedTags.filter((t) => t !== tag)
  }

  function clearTags() {
    selectedTags = []
  }

  function handleViewDetails(card: DiscoveryCard) {
    selectedCard = card
  }
</script>

<ResponsiveModal.Root open={isOpen} onOpenChange={(v) => !v && onClose()}>
  <ResponsiveModal.Content
    class="flex h-[85vh] w-full max-w-none flex-col gap-0 overflow-hidden p-0 lg:w-[calc(100%-2rem)] lg:max-w-7xl"
  >
    {#if selectedCard}
      <DiscoveryCardDetails
        card={selectedCard}
        onBack={() => (selectedCard = null)}
        onImport={handleImport}
        isImported={selectedCard &&
          importedUrls.has(selectedCard.imageUrl || selectedCard.avatarUrl)}
        {nsfwMode}
      />
    {:else}
      <ResponsiveModal.Header class="shrink-0 border-b px-4 py-3 text-center sm:text-left">
        <ResponsiveModal.Title
          class="mt-2 flex items-center justify-center gap-2 sm:mt-0 sm:justify-start"
        >
          Browse {mode === 'character'
            ? 'Characters'
            : mode === 'lorebook'
              ? 'Lorebooks'
              : 'Scenarios'}
        </ResponsiveModal.Title>
        <ResponsiveModal.Description class="sr-only">
          Find and import new {mode}s from online sources.
        </ResponsiveModal.Description>
      </ResponsiveModal.Header>

      <div class="bg-muted/20 flex flex-col border-b">
        <div class="flex flex-col gap-4 p-4">
          <div class="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div
              class="scrollbar-hide flex w-full items-center justify-between gap-2 overflow-x-auto pb-1 sm:w-auto sm:flex-1 sm:justify-normal sm:overflow-visible sm:pb-0"
            >
              <div class="min-w-[140px] flex-shrink-0 sm:w-[180px]">
                <Select.Root type="single" bind:value={activeProviderId}>
                  <Select.Trigger class="h-9 w-full">
                    {#if activeProviderId === 'all'}
                      <div class="text-muted-foreground flex min-w-0 items-center gap-2">
                        <Globe class="h-4 w-4 shrink-0" />
                        <span class="text-foreground truncate">All Sources</span>
                      </div>
                    {:else}
                      {@const p = providers.find((p) => p.id === activeProviderId)}
                      <div class="flex min-w-0 items-center gap-2">
                        {#if p?.icon}
                          <img src={p.icon} alt="" class="h-4 w-4 shrink-0 rounded" />
                        {:else}
                          <Globe class="h-4 w-4 shrink-0" />
                        {/if}
                        <span class="truncate">{p?.name || 'Unknown'}</span>
                      </div>
                    {/if}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="all">
                      <Globe class="mr-2 h-4 w-4" />
                      All Sources
                    </Select.Item>
                    {#each providers as provider (provider.id)}
                      <Select.Item value={provider.id}>
                        {#if provider.icon}
                          <img src={provider.icon} alt="" class="mr-2 h-4 w-4 rounded" />
                        {:else}
                          <Globe class="mr-2 h-4 w-4" />
                        {/if}
                        {provider.name}
                      </Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>

              <div class="flex-shrink-0">
                <Popover.Root bind:open={showTagDropdown}>
                  <Popover.Trigger>
                    {#snippet child({ props })}
                      <Button
                        variant="outline"
                        size="sm"
                        {...props}
                        class={cn(
                          'h-9 px-3',
                          selectedTags.length > 0 && 'border-primary text-primary bg-primary/5',
                        )}
                      >
                        <Filter class="h-4 w-4" />
                        {#if selectedTags.length > 0}
                          <span class="ml-1.5 text-xs font-medium tabular-nums">
                            {selectedTags.length}
                          </span>
                        {/if}
                      </Button>
                    {/snippet}
                  </Popover.Trigger>
                  <Popover.Content class="w-[300px] p-0" align="start">
                    <Command.Root shouldFilter={false}>
                      <Command.Input
                        placeholder="Search tags..."
                        bind:value={tagInput}
                        onkeydown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (tagSuggestions.length > 0) {
                              toggleTag(tagSuggestions[0])
                              tagInput = ''
                            } else {
                              addCustomTag()
                            }
                          }
                        }}
                      />
                      <Command.List>
                        <Command.Empty>
                          {#if tagInput}
                            <button
                              class="w-full px-4 py-2 text-left text-sm"
                              onclick={addCustomTag}
                            >
                              Add "{tagInput}"
                            </button>
                          {:else}
                            No tags found.
                          {/if}
                        </Command.Empty>
                        {#if tagSuggestions.length > 0}
                          <Command.Group heading="Suggestions">
                            {#each tagSuggestions as tag, i (i)}
                              <Command.Item
                                value={tag}
                                onSelect={() => {
                                  toggleTag(tag)
                                  tagInput = ''
                                }}
                              >
                                <div
                                  class="mr-2 flex h-4 w-4 items-center justify-center opacity-0"
                                  class:opacity-100={selectedTags.includes(tag)}
                                >
                                  <Check class="h-4 w-4" />
                                </div>
                                {tag}
                              </Command.Item>
                            {/each}
                          </Command.Group>
                        {/if}

                        {#if popularTags.length > 0 && !tagInput}
                          <Command.Group heading="Popular">
                            {#each popularTags as tag, i (i)}
                              <Command.Item value={tag} onSelect={() => toggleTag(tag)}>
                                <div
                                  class="mr-2 flex h-4 w-4 items-center justify-center opacity-0"
                                  class:opacity-100={selectedTags.includes(tag)}
                                >
                                  <Check class="h-4 w-4" />
                                </div>
                                {tag}
                              </Command.Item>
                            {/each}
                          </Command.Group>
                        {/if}
                      </Command.List>
                    </Command.Root>
                  </Popover.Content>
                </Popover.Root>
              </div>

              <div class="bg-border mx-1 hidden h-6 w-px shrink-0 sm:block"></div>

              <div class="flex shrink-0 items-center gap-2">
                <span class="text-muted-foreground text-xs font-medium">NSFW:</span>
                <ToggleGroup.Root
                  type="single"
                  bind:value={nsfwMode}
                  class="bg-muted h-9 gap-0 rounded-lg border p-1"
                  variant="default"
                >
                  <ToggleGroup.Item
                    value="disable"
                    class="data-[state=on]:bg-background data-[state=on]:text-foreground text-muted-foreground hover:text-foreground flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-all hover:bg-transparent data-[state=on]:shadow-sm"
                    title="Hide NSFW"
                  >
                    <EyeOff class="h-3.5 w-3.5" />
                    <span class="hidden lg:inline">Hide</span>
                  </ToggleGroup.Item>
                  <ToggleGroup.Item
                    value="blur"
                    class="data-[state=on]:bg-background data-[state=on]:text-foreground text-muted-foreground hover:text-foreground flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-all hover:bg-transparent data-[state=on]:shadow-sm"
                    title="Blur NSFW"
                  >
                    <Blend class="h-3.5 w-3.5" />
                    <span class="hidden lg:inline">Blur</span>
                  </ToggleGroup.Item>
                  <ToggleGroup.Item
                    value="enable"
                    class="text-muted-foreground flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-all hover:bg-transparent hover:text-red-500 data-[state=on]:bg-red-500/10 data-[state=on]:text-red-600 data-[state=on]:shadow-sm"
                    title="Show NSFW"
                  >
                    <Eye class="h-3.5 w-3.5" />
                    <span class="hidden lg:inline">Show</span>
                  </ToggleGroup.Item>
                </ToggleGroup.Root>
              </div>
            </div>

            <div class="hidden w-[250px] shrink-0 items-center sm:flex lg:w-[300px]">
              <Input
                placeholder="Search..."
                bind:value={searchQuery}
                onkeydown={(e) => e.key === 'Enter' && handleSearch()}
                class="focus-visible:border-primary h-9 rounded-r-none border-r-0 focus-visible:z-10 focus-visible:ring-0"
              />
              <Button
                onclick={handleSearch}
                disabled={isLoading}
                size="icon"
                variant="outline"
                class="bg-muted/50 hover:bg-muted h-9 w-9 shrink-0 rounded-l-none border-l"
              >
                {#if isLoading}
                  <Loader2 class="h-4 w-4 animate-spin" />
                {:else}
                  <Search class="h-4 w-4" />
                {/if}
              </Button>
            </div>
          </div>

          <div class="flex gap-2 sm:hidden">
            <div class="flex flex-1 items-center">
              <Input
                placeholder="Search..."
                bind:value={searchQuery}
                onkeydown={(e) => e.key === 'Enter' && handleSearch()}
                class="focus-visible:border-primary h-9 rounded-r-none border-r-0 focus-visible:z-10 focus-visible:ring-0"
              />
              <Button
                onclick={handleSearch}
                disabled={isLoading}
                size="icon"
                variant="outline"
                class="bg-muted/50 hover:bg-muted h-9 w-9 shrink-0 rounded-l-none border-l"
              >
                {#if isLoading}
                  <Loader2 class="h-4 w-4 animate-spin" />
                {:else}
                  <Search class="h-4 w-4" />
                {/if}
              </Button>
            </div>
          </div>

          {#if selectedTags.length > 0}
            <div class="flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
              {#each selectedTags as tag, i (i)}
                <Badge variant="secondary" class="h-7 items-center gap-1.5 pr-1.5 pl-2 font-normal">
                  {tag}
                  <Button
                    variant="ghost"
                    size="icon"
                    class="hover:text-destructive h-4 w-4 p-0 hover:bg-transparent"
                    onclick={() => removeTag(tag)}
                  >
                    <X class="h-3 w-3" />
                  </Button>
                </Badge>
              {/each}
              <Button
                variant="ghost"
                size="sm"
                class="hover:text-destructive h-7 px-2 text-xs"
                onclick={clearTags}
              >
                Clear all
              </Button>
            </div>
          {/if}
        </div>
      </div>

      <div class="bg-muted/5 flex-1 overflow-y-auto p-4">
        {#if errorMessage}
          <div
            class="border-destructive/50 bg-destructive/10 text-destructive mb-4 rounded-lg border px-4 py-3 text-sm"
          >
            {errorMessage}
          </div>
        {/if}

        {#if results.length === 0 && !isLoading}
          <div class="text-muted-foreground flex h-full flex-col items-center justify-center p-8">
            <Search class="mb-4 h-12 w-12 opacity-20" />
            <p class="text-lg font-medium">No results found</p>
            <p class="text-sm opacity-70">Try adjusting your search terms or filters.</p>
          </div>
        {:else}
          <div
            class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          >
            {#each results as card (card.id)}
              <DiscoveryCardComponent
                {card}
                onImport={handleImport}
                onViewDetails={handleViewDetails}
                isImported={importedUrls.has(card.imageUrl || card.avatarUrl)}
                {nsfwMode}
              />
            {/each}
          </div>

          {#if hasMore}
            <div class="mt-8 flex justify-center pb-4">
              <Button
                variant="outline"
                onclick={loadMore}
                disabled={isLoading}
                class="min-w-[150px]"
              >
                {#if isLoading}
                  <Loader2 class="mr-2 h-4 w-4 animate-spin" />
                {/if}
                Load More
              </Button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
