<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import type { ChapterBanner, ChapterBannerLink } from '$lib/utils/chapterBanners'
  import { Button } from '$lib/components/ui/button'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'

  let {
    banner,
    onNavigate,
  }: {
    banner: ChapterBanner
    onNavigate: (entryId: string) => void
  } = $props()

  // The tail is not a chapter, so it is introduced by what it follows.
  const eyebrow = $derived(
    banner.number === null
      ? banner.prev && `Since ${banner.prev.label}`
      : `Chapter ${banner.number}`,
  )
</script>

<header
  class="border-border border-t-primary/60 rounded-lg border border-t-2 px-4 pt-3 pb-2 shadow-sm {story.currentBgImage
    ? 'bg-card/60 backdrop-blur-md'
    : 'bg-card'}"
>
  {#if eyebrow}
    <div class="flex items-center gap-3">
      <span class="border-border flex-1 border-t"></span>
      <span class="text-primary text-xs font-semibold tracking-[0.2em] uppercase">{eyebrow}</span>
      <span class="border-border flex-1 border-t"></span>
    </div>
  {/if}

  {#if banner.title}
    <h2 class="text-foreground font-story mt-2 text-center text-xl font-semibold">
      {banner.title}
    </h2>
  {/if}

  {#if banner.summary}
    <p class="text-muted-foreground font-story mt-2 text-sm leading-relaxed whitespace-pre-line">
      {banner.summary}
    </p>
  {/if}

  <div class="mt-2 flex items-center">
    {#if banner.prev}
      {@render navLink(banner.prev, 'prev')}
    {/if}
    {#if banner.next}
      {@render navLink(banner.next, 'next')}
    {/if}
  </div>
</header>

{#snippet navLink(link: ChapterBannerLink, dir: 'prev' | 'next')}
  <Button
    variant="text"
    size="sm"
    class="h-7 gap-1 px-2 text-xs {dir === 'next' ? 'ml-auto' : ''}"
    onclick={() => onNavigate(link.entryId)}
    aria-label="Go to {link.label}"
  >
    {#if dir === 'prev'}<ChevronLeft />{/if}
    {link.label}
    {#if dir === 'next'}<ChevronRight />{/if}
  </Button>
{/snippet}
