<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import type { ChapterBanner } from '$lib/utils/chapterBanners'
  import { Button } from '$lib/components/ui/button'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'

  let {
    banner,
    onNavigate,
  }: {
    banner: ChapterBanner
    onNavigate: (entryId: string) => void
  } = $props()

  const storyFont = 'font-family: var(--font-story-custom, var(--font-story))'
</script>

<header
  class="border-border border-t-primary/60 rounded-lg border border-t-2 px-4 pt-3 pb-2 shadow-sm {story.currentBgImage
    ? 'bg-card/60 backdrop-blur-md'
    : 'bg-card'}"
>
  <div class="flex items-center gap-3">
    <span class="border-border flex-1 border-t"></span>
    <span class="text-primary text-xs font-semibold tracking-[0.2em] uppercase">
      Chapter {banner.number}
    </span>
    <span class="border-border flex-1 border-t"></span>
  </div>

  {#if banner.title}
    <h2 class="text-foreground mt-2 text-center text-xl font-semibold" style={storyFont}>
      {banner.title}
    </h2>
  {/if}

  {#if banner.summary}
    <p
      class="text-muted-foreground mt-2 text-sm leading-relaxed whitespace-pre-line"
      style={storyFont}
    >
      {banner.summary}
    </p>
  {/if}

  <div class="mt-2 flex items-center justify-between">
    {#if banner.prev}
      {@const prev = banner.prev}
      <Button
        variant="text"
        size="sm"
        class="h-7 gap-1 px-2 text-xs"
        onclick={() => onNavigate(prev.entryId)}
        aria-label="Go to the start of chapter {prev.number}"
      >
        <ChevronLeft />
        Chapter {prev.number}
      </Button>
    {:else}
      <span></span>
    {/if}
    {#if banner.next}
      {@const next = banner.next}
      <Button
        variant="text"
        size="sm"
        class="h-7 gap-1 px-2 text-xs"
        onclick={() => onNavigate(next.entryId)}
        aria-label="Go to the start of chapter {next.number}"
      >
        Chapter {next.number}
        <ChevronRight />
      </Button>
    {/if}
  </div>
</header>
