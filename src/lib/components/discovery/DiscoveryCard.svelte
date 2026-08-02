<script lang="ts">
  import type { DiscoveryCard } from '$lib/services/discovery'
  import { Download, Check, Eye } from '@lucide/svelte'
  import { Card, CardContent } from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'

  type NsfwMode = 'disable' | 'blur' | 'enable'

  interface Props {
    card: DiscoveryCard
    onImport: (card: DiscoveryCard) => void
    onViewDetails?: (card: DiscoveryCard) => void
    isImported?: boolean
    nsfwMode?: NsfwMode
  }

  let { card, onImport, onViewDetails, isImported = false, nsfwMode = 'disable' }: Props = $props()

  // Hide card entirely if NSFW is disabled and card is NSFW
  let isHidden = $derived(nsfwMode === 'disable' && card.nsfw)
  let shouldBlur = $derived(nsfwMode === 'blur' && card.nsfw)

  let imageError = $state(false)

  function handleImageError() {
    imageError = true
  }

  function handleImportClick(e: MouseEvent) {
    e.stopPropagation()
    if (!isImported) {
      onImport(card)
    }
  }

  function handleCardClick() {
    onViewDetails?.(card)
  }
</script>

{#if !isHidden}
  <Card
    class="group hover:border-primary/50 flex h-full cursor-pointer flex-col overflow-hidden transition-all hover:shadow-lg active:scale-[0.98] active:transition-none"
    onclick={handleCardClick}
  >
    <!-- Image -->
    <div class="bg-muted relative aspect-square w-full overflow-hidden">
      <div class="absolute inset-0 h-full w-full" class:blur-lg={shouldBlur}>
        {#if !imageError && (card.imageUrl || card.avatarUrl)}
          <img
            src={card.imageUrl || card.avatarUrl}
            alt={card.name}
            class="h-full w-full object-cover transition-transform group-hover:scale-105"
            onerror={handleImageError}
            loading="lazy"
          />
        {:else}
          <div class="text-muted-foreground flex h-full w-full items-center justify-center">
            <span class="text-4xl">?</span>
          </div>
        {/if}
      </div>

      <!-- NSFW Badge -->
      {#if card.nsfw}
        <Badge variant="destructive" class="absolute top-2 left-2 z-20">NSFW</Badge>
      {/if}

      <!-- Source Badge -->
      <Badge variant="secondary" class="absolute top-2 right-2 z-20 opacity-90">
        {card.source}
      </Badge>

      <!-- Imported Badge (Visible always if imported) -->
      {#if isImported}
        <div
          class="bg-background/60 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]"
        >
          <Badge
            variant="outline"
            class="gap-1.5 border-green-500/50 bg-green-500/10 text-green-500"
          >
            <Check class="h-3.5 w-3.5" />
            Imported
          </Badge>
        </div>
      {/if}

      <!-- Hover Actions (Only visible when NOT imported) -->
      {#if !isImported}
        <div
          class="absolute inset-0 hidden items-center justify-center gap-2 bg-black/60 p-4 opacity-0 transition-opacity group-hover:opacity-100 sm:flex"
        >
          <Button
            size="icon"
            variant="secondary"
            onclick={(e) => {
              e.stopPropagation()
              handleCardClick()
            }}
            class="h-9 w-9 shrink-0"
            title="View Details"
          >
            <Eye class="h-4 w-4" />
          </Button>

          <Button size="sm" onclick={handleImportClick} class="min-w-[90px] gap-1.5">
            <Download class="h-4 w-4" />
            Import
          </Button>
        </div>
      {/if}
    </div>

    <!-- Info -->
    <CardContent class="flex flex-1 flex-col gap-1 p-3">
      <h3 class="line-clamp-1 text-sm leading-none font-medium" title={card.name}>
        {card.name}
      </h3>
      {#if card.creator}
        <p class="text-muted-foreground line-clamp-1 text-xs">
          by {card.creator}
        </p>
      {/if}
      {#if card.description}
        <p class="text-muted-foreground mt-1 line-clamp-2 text-xs">
          {card.description}
        </p>
      {/if}

      <!-- Tags -->
      {#if card.tags.length > 0}
        <div class="mt-auto flex flex-wrap gap-1 pt-2">
          {#each card.tags.slice(0, 3) as tag, i (i)}
            <Badge variant="outline" class="h-5 px-1 py-0 text-[10px] font-normal">
              {tag}
            </Badge>
          {/each}
          {#if card.tags.length > 3}
            <Badge variant="outline" class="h-5 px-1 py-0 text-[10px] font-normal">
              +{card.tags.length - 3}
            </Badge>
          {/if}
        </div>
      {/if}
    </CardContent>
  </Card>
{/if}
