<script lang="ts">
  import type { DiscoveryCard } from '$lib/services/discovery'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import {
    Download,
    ArrowLeft,
    Eye,
    Download as DownloadIcon,
    AlertTriangle,
    ChevronsUpDown,
    Loader2,
  } from '@lucide/svelte'
  import * as Alert from '$lib/components/ui/alert'
  import { slide } from 'svelte/transition'
  import { discoveryService } from '$lib/services/discovery'

  interface Props {
    card: DiscoveryCard
    onBack: () => void
    onImport: (card: DiscoveryCard) => void
    isImported?: boolean
    nsfwMode?: 'disable' | 'blur' | 'enable'
  }

  let { card, onBack, onImport, isImported = false, nsfwMode = 'disable' }: Props = $props()

  let shouldBlur = $derived(nsfwMode === 'blur' && card.nsfw)
  let imageError = $state(false)
  let isRawDataOpen = $state(false)
  let extraDetails = $state<DiscoveryCard | null>(null)
  let detailedCard = $derived(extraDetails ?? card)
  let isLoadingDetails = $state(false)

  function handleImageError() {
    imageError = true
  }

  $effect(() => {
    // Reset detailed card when prop changes
    extraDetails = null

    // Fetch details if available
    const loadDetails = async () => {
      isLoadingDetails = true
      try {
        const fullCard = await discoveryService.getCardDetails(card)
        extraDetails = fullCard
      } catch (e) {
        console.error('Failed to load card details', e)
      } finally {
        isLoadingDetails = false
      }
    }

    loadDetails()
  })
</script>

<div class="bg-background flex h-full w-full flex-col">
  <!-- Header (Mobile: Back + Title) -->
  <div
    class="bg-background sticky top-0 z-10 -mt-2.5 flex shrink-0 items-center gap-2 border-b p-3 pt-1.5 sm:mt-0 sm:p-4 sm:pt-4"
  >
    <Button
      variant="ghost"
      size="icon"
      onclick={onBack}
      class="order-2 h-8 w-8 shrink-0 sm:order-1 sm:-ml-2"
    >
      <ArrowLeft class="h-5 w-5" />
      <span class="sr-only">Back</span>
    </Button>
    <h2 class="order-1 flex-1 truncate text-left text-lg font-semibold sm:order-2">
      {card.name}
    </h2>
    {#if isImported}
      <Badge
        variant="outline"
        class="order-3 hidden shrink-0 border-green-500/50 bg-green-500/10 text-green-500 sm:inline-flex"
      >
        Imported
      </Badge>
    {/if}
  </div>

  <!-- Content Area - Native scrolling for better mobile behavior -->
  <div class="flex-1 overflow-y-auto p-4 md:p-6">
    <div class="mx-auto flex max-w-5xl flex-col gap-6 md:flex-row">
      <!-- Image Section -->
      <div class="w-full shrink-0 space-y-4 md:w-1/3">
        <div
          class="bg-muted relative aspect-square w-full overflow-hidden rounded-lg border shadow-sm"
        >
          <div class="absolute inset-0 h-full w-full" class:blur-xl={shouldBlur}>
            {#if !imageError && (card.imageUrl || card.avatarUrl)}
              <img
                src={card.imageUrl || card.avatarUrl}
                alt={card.name}
                class="h-full w-full object-cover"
                onerror={handleImageError}
              />
            {:else}
              <div class="text-muted-foreground flex h-full w-full items-center justify-center">
                <span class="text-6xl">?</span>
              </div>
            {/if}
          </div>

          {#if card.nsfw}
            <Badge variant="destructive" class="absolute top-2 left-2 z-10 shadow-sm">NSFW</Badge>
          {/if}

          <Badge variant="secondary" class="absolute top-2 right-2 z-10 opacity-90 shadow-sm">
            {card.source}
          </Badge>
        </div>

        <!-- Mobile Import Button -->
        <div
          class="bg-background/95 supports-backdrop-filter:bg-background/60 sticky bottom-0 backdrop-blur md:hidden"
        >
          <Button
            size="lg"
            variant={isImported ? 'secondary' : 'default'}
            class="w-full gap-2 shadow-md"
            disabled={isImported}
            onclick={() => onImport(detailedCard)}
          >
            {#if isImported}
              Imported
            {:else}
              <Download class="h-5 w-5" />
              Import Card
            {/if}
          </Button>
        </div>
      </div>

      <!-- Info Section -->
      <div class="min-w-0 flex-1 space-y-6 pb-8">
        <!-- Metadata -->
        <div class="space-y-4">
          <div>
            <h1 class="hidden text-2xl font-bold md:block">{card.name}</h1>
            <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {#if card.creator}
                <span class="text-foreground font-medium">By {card.creator}</span>
              {/if}
              {#if card.stats}
                <div class="flex items-center gap-3">
                  {#if card.stats.downloads}
                    <span class="flex items-center gap-1" title="Downloads">
                      <DownloadIcon class="h-3.5 w-3.5" />
                      {card.stats.downloads}
                    </span>
                  {/if}
                  {#if card.stats.views}
                    <span class="flex items-center gap-1" title="Views">
                      <Eye class="h-3.5 w-3.5" />
                      {card.stats.views}
                    </span>
                  {/if}
                </div>
              {/if}
            </div>
          </div>

          <!-- Tags -->
          {#if card.tags.length > 0}
            <div class="flex flex-wrap gap-1.5">
              {#each card.tags as tag, i (i)}
                <Badge variant="secondary" class="px-2 py-0.5 text-xs font-normal">
                  {tag}
                </Badge>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <h3 class="text-foreground/80 text-sm font-semibold tracking-wider uppercase">
            Description
          </h3>
          <div
            class="bg-muted/50 text-muted-foreground rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap"
          >
            {card.description || 'No description provided.'}
          </div>
        </div>

        <!-- Raw Data Collapsible (Manual Implementation) -->
        <div class="space-y-2 rounded-lg border p-1">
          <button
            class="hover:bg-muted/50 flex w-full items-center justify-between rounded-md p-2 text-left transition-colors"
            onclick={() => (isRawDataOpen = !isRawDataOpen)}
          >
            <div class="flex items-center gap-2">
              <h3 class="text-foreground/80 pl-1 text-sm font-semibold tracking-wider uppercase">
                Original Source Data
              </h3>
              {#if isLoadingDetails}
                <Loader2 class="text-muted-foreground h-3 w-3 animate-spin" />
              {/if}
            </div>
            <div class="text-muted-foreground p-1">
              <ChevronsUpDown class="h-4 w-4" />
            </div>
          </button>

          {#if isRawDataOpen}
            <div transition:slide={{ duration: 200, axis: 'y' }} class="space-y-4 px-3 pt-1 pb-3">
              <Alert.Root>
                <AlertTriangle class="h-4 w-4" />
                <Alert.Title>Import Context Warning</Alert.Title>
                <Alert.Description>
                  This is the raw data associated with the card. During import, some fields might be
                  remapped or formatted to fit the local schema. This data serves as the source of
                  truth for the import process.
                </Alert.Description>
              </Alert.Root>

              <div class="bg-muted max-h-[300px] overflow-x-auto overflow-y-auto rounded-md p-4">
                {#if isLoadingDetails}
                  <div class="text-muted-foreground flex items-center justify-center gap-2 py-8">
                    <Loader2 class="h-4 w-4 animate-spin" />
                    <span>Fetching full details...</span>
                  </div>
                {:else}
                  <pre
                    class="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">{JSON.stringify(
                      detailedCard,
                      null,
                      2,
                    )}</pre>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Desktop Footer Actions -->
  <div class="bg-muted/10 hidden shrink-0 items-center justify-end gap-3 border-t p-4 md:flex">
    <Button variant="outline" onclick={onBack}>Back</Button>
    <Button
      variant={isImported ? 'secondary' : 'default'}
      class="min-w-[120px] gap-2"
      disabled={isImported}
      onclick={() => onImport(detailedCard)}
    >
      {#if isImported}
        Imported
      {:else}
        <Download class="h-4 w-4" />
        Import
      {/if}
    </Button>
  </div>
</div>
