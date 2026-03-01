<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { Loader2, BookOpen, ChevronDown, ChevronUp } from 'lucide-svelte'
  import { tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import StoryEntry from './StoryEntry.svelte'
  import StreamingEntry from './StreamingEntry.svelte'
  import ActionInput from './ActionInput.svelte'
  import ActionChoices from './ActionChoices.svelte'
  import { Button } from '$lib/components/ui/button'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'

  let storyContainer: HTMLDivElement
  let containerHeight = $state(0)
  let innerHeight = $state(0)

  // Virtualization: Only render recent entries by default for performance
  // This dramatically improves performance with large stories (80k+ words)
  const DEFAULT_VISIBLE_ENTRIES = 50
  const LOAD_MORE_BATCH = 50
  const MAX_VISIBLE_ENTRIES = DEFAULT_VISIBLE_ENTRIES * 2 // keep both current + previous batch
  const SCROLL_THRESHOLD = 50 // pixels from top/bottom to trigger state changes

  // Explicit window into story.entries. Loading more on one side trims the other
  // to keep the rendered DOM at a fixed size for performance.
  let windowStart = $state(0)
  let windowEnd = $state(DEFAULT_VISIBLE_ENTRIES)

  // Track if user has scrolled away from top (for showing scroll-to-top button)
  let userScrolledDown = $state(false)

  // Track the current story ID to detect story switches
  let lastStoryId = $state<string | null>(null)

  // Auto-scroll to bottom when new entries are added or streaming content changes
  // Use requestAnimationFrame to batch scroll updates and avoid layout thrashing
  let scrollRAF: number | null = null
  let prevEntryCount = 0
  let suppressScrollHandler = false

  // Anchor the window to the end (latest entries) or start (oldest entries)
  function anchorToBottom(total: number) {
    windowStart = Math.max(0, total - DEFAULT_VISIBLE_ENTRIES)
    windowEnd = total
  }

  function anchorToTop(total: number) {
    windowStart = 0
    windowEnd = Math.min(total, DEFAULT_VISIBLE_ENTRIES)
  }

  // Reset window when story changes
  $effect(() => {
    const currentStoryId = story.currentStory?.id ?? null

    if (currentStoryId !== lastStoryId) {
      lastStoryId = currentStoryId
      anchorToBottom(story.entries.length)
    }
  })

  // Compute which entries to render
  const displayedEntries = $derived.by(() => {
    const entries = story.entries
    const total = entries.length
    const start = Math.max(0, Math.min(windowStart, total))
    const end = Math.min(total, Math.max(windowEnd, start))
    return {
      entries: entries.slice(start, end),
      hiddenAtTop: start,
      hiddenAtBottom: total - end,
      startIndex: start,
    }
  })

  // Load earlier entries above, compensate scroll, then trim the bottom if it's
  // safely off-screen (two-phase so each compensation is isolated and correct).
  async function showMoreAbove() {
    const prevScrollHeight = storyContainer?.scrollHeight ?? 0
    const prevScrollTop = storyContainer?.scrollTop ?? 0

    // Phase 1: expand window upward
    windowStart = Math.max(0, windowStart - LOAD_MORE_BATCH)
    await tick()

    if (!storyContainer) return

    // Compensate: new entries above push existing content down
    storyContainer.scrollTop = prevScrollTop + (storyContainer.scrollHeight - prevScrollHeight)

    // Phase 2: trim from bottom only if those entries are safely below the viewport
    const distFromBottom =
      storyContainer.scrollHeight - storyContainer.scrollTop - storyContainer.clientHeight
    if (
      distFromBottom > storyContainer.clientHeight &&
      windowEnd - windowStart > MAX_VISIBLE_ENTRIES
    ) {
      const trimCount = Math.min(windowEnd - windowStart - MAX_VISIBLE_ENTRIES, LOAD_MORE_BATCH)
      windowEnd -= trimCount
      await tick()
      // No scroll compensation: removed entries were below the viewport
    }
  }

  // Load later entries below, then trim the top if it's safely off-screen.
  async function showMoreBelow() {
    const total = story.entries.length

    // Phase 1: expand window downward (no scroll compensation needed — adding below doesn't shift content)
    windowEnd = Math.min(total, windowEnd + LOAD_MORE_BATCH)
    await tick()

    if (!storyContainer) return

    // Phase 2: trim from top only if those entries are safely above the viewport
    if (
      storyContainer.scrollTop > storyContainer.clientHeight &&
      windowEnd - windowStart > MAX_VISIBLE_ENTRIES
    ) {
      const prevScrollHeight = storyContainer.scrollHeight
      const prevScrollTop = storyContainer.scrollTop
      const trimCount = Math.min(windowEnd - windowStart - MAX_VISIBLE_ENTRIES, LOAD_MORE_BATCH)
      windowStart += trimCount
      await tick()
      // Compensate: removed entries above shift all content up
      storyContainer.scrollTop = prevScrollTop - (prevScrollHeight - storyContainer.scrollHeight)
    }
  }

  // Helper function to perform smooth scroll with RAF batching
  function performScroll(scrollPosition: number) {
    if (!storyContainer) return

    if (scrollRAF !== null) {
      cancelAnimationFrame(scrollRAF)
    }

    scrollRAF = requestAnimationFrame(() => {
      if (storyContainer) {
        storyContainer.scrollTop = scrollPosition
      }
      scrollRAF = null
    })
  }

  function scrollToBottom() {
    anchorToBottom(story.entries.length)
    requestAnimationFrame(() => {
      performScroll(storyContainer?.scrollHeight ?? 0)
    })
  }

  async function scrollToTop() {
    ui.setScrollBreak(true)
    suppressScrollHandler = true
    anchorToTop(story.entries.length)
    await tick()
    performScroll(0)
    requestAnimationFrame(() => {
      suppressScrollHandler = false
    })
  }

  // Check if container is scrolled near a specific edge
  function isNearEdge(edge: 'top' | 'bottom'): boolean {
    if (!storyContainer) return true

    if (edge === 'top') {
      return storyContainer.scrollTop < SCROLL_THRESHOLD
    }

    return (
      storyContainer.scrollHeight - storyContainer.scrollTop - storyContainer.clientHeight <
      SCROLL_THRESHOLD
    )
  }
  // Handle scroll events during streaming
  function handleScroll() {
    if (!storyContainer || suppressScrollHandler) return

    const nearBottom = isNearEdge('bottom')
    const nearTop = isNearEdge('top')

    // Update scroll break state - if near bottom, re-engage auto-scroll
    if (nearBottom) {
      if (ui.userScrolledUp) ui.setScrollBreak(false)
    } else {
      if (!ui.userScrolledUp) ui.setScrollBreak(true)
    }

    // Track if user has scrolled down from top (for scroll-to-top button)
    userScrolledDown = !nearTop
  }

  // Disabled when truly at the very start/end of the entire story
  const atVeryTop = $derived(displayedEntries.hiddenAtTop === 0 && !userScrolledDown)
  const atVeryBottom = $derived(displayedEntries.hiddenAtBottom === 0 && !ui.userScrolledUp)

  // Auto-scroll to bottom when new entries are added or streaming content changes
  $effect(() => {
    // Track primary scroll-inducing changes
    const currentCount = story.entries.length
    const _ = innerHeight
    const __ = containerHeight

    // Detect if entries were added (vs deleted or unchanged)
    const wasAdded = currentCount > prevEntryCount
    prevEntryCount = currentCount

    // Detect if we should scroll:
    // 1. We are NOT user-scrolled-up (pinned mode)
    // 2. OR on user action send message/retry
    const lastEntry = story.entries[story.entries.length - 1]
    const shouldScroll =
      settings.uiSettings.autoScroll &&
      (!ui.userScrolledUp ||
        (wasAdded && lastEntry && ['user_action', 'retry'].includes(lastEntry.type)))

    if (!shouldScroll) return

    // New entries: re-anchor window to the latest entries
    if (wasAdded) {
      anchorToBottom(currentCount)
    }

    performScroll(storyContainer?.scrollHeight ?? 0)
  })

  // Scroll to bottom when returning from gallery or other panels
  $effect(() => {
    if (ui.activePanel === 'story' && storyContainer) {
      scrollToBottom()
    }
  })

  // Format background image URL (handling raw base64 vs data URL)
  const bgImageUrl = $derived.by(() => {
    const raw = story.currentBgImage
    if (!raw) return null
    if (raw.startsWith('data:')) return `url(${raw})`
    return `url(data:image/png;base64,${raw})`
  })
</script>

<div class="relative flex h-full flex-col overflow-hidden">
  <!-- Background Image Layer -->
  {#if story.currentBgImage}
    {#key story.currentBgImage}
      <div
        class="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat transition-all duration-300"
        style="background-image: {bgImageUrl}; filter: blur({settings.systemServicesSettings
          .imageGeneration.backgroundBlur}px); transform: scale({settings.systemServicesSettings
          .imageGeneration.backgroundBlur > 0
          ? 1.05
          : 1});"
        in:fade={{ duration: 800 }}
        out:fade={{ duration: 800 }}
      ></div>
    {/key}
    <!-- Overlay to improve readability -->
    <div class="bg-background/40 pointer-events-none absolute inset-0 z-0"></div>
  {/if}

  <!-- Story entries container -->
  <div
    bind:this={storyContainer}
    bind:clientHeight={containerHeight}
    class="relative z-10 flex-1 overflow-y-auto px-3 pt-3 pb-1 sm:px-6 sm:pt-4 sm:pb-2"
    onscroll={handleScroll}
  >
    <div class="mx-auto max-w-3xl space-y-2.5 sm:space-y-3" bind:clientHeight={innerHeight}>
      {#if story.entries.length === 0 && !ui.isStreaming}
        <EmptyState
          icon={BookOpen}
          title="Your adventure begins here..."
          description="Type an action below to start your story."
          class="py-12 sm:py-20"
        />
      {:else}
        <!-- Show collapsed entries indicator if there are hidden entries at top -->
        {#if displayedEntries.hiddenAtTop > 0}
          <div class="border-border mb-3 flex flex-col items-center gap-2 border-b py-3">
            <p class="text-muted-foreground text-sm">
              {displayedEntries.hiddenAtTop} earlier entries hidden for performance
            </p>
            <div class="flex flex-row gap-2">
              <Button variant="secondary" size="sm" class="h-7 text-xs" onclick={showMoreAbove}>
                Show {Math.min(LOAD_MORE_BATCH, displayedEntries.hiddenAtTop)} more
              </Button>
              {#if !settings.uiSettings.showScrollToTop}
                <Button variant="secondary" size="sm" class="h-7 text-xs" onclick={scrollToTop}>
                  Go to top
                </Button>
              {/if}
            </div>
          </div>
        {/if}

        {#each displayedEntries.entries as entry (entry.id)}
          <StoryEntry {entry} />
        {/each}

        <!-- Show streaming entry while generating -->
        {#if ui.isStreaming}
          <StreamingEntry />
        {/if}

        <!-- Show post-generation status (e.g. Updating world...) -->
        {#if ui.isGenerating && !ui.isStreaming && ui.generationStatus}
          <div
            class="text-muted-foreground animate-fade-in flex items-center justify-center gap-2 py-2"
          >
            <Loader2 class="h-4 w-4 animate-spin" />
            <span class="text-sm">{ui.generationStatus}</span>
          </div>
        {/if}

        <!-- Show RPG-style action choices after narration (adventure mode only) -->
        {#if !ui.isStreaming && !ui.isGenerating && story.storyMode === 'adventure' && !settings.uiSettings.disableSuggestions}
          <ActionChoices />
        {/if}

        <!-- Show collapsed entries indicator if there are hidden entries at bottom -->
        {#if displayedEntries.hiddenAtBottom > 0}
          <div class="border-border mt-3 flex flex-col items-center gap-2 border-t py-3">
            <p class="text-muted-foreground text-sm">
              {displayedEntries.hiddenAtBottom} later entries hidden for performance
            </p>
            <div class="flex flex-row gap-2">
              <Button variant="secondary" size="sm" class="h-7 text-xs" onclick={showMoreBelow}>
                Show {Math.min(LOAD_MORE_BATCH, displayedEntries.hiddenAtBottom)} more
              </Button>
              {#if !settings.uiSettings.showScrollToBottom}
                <Button variant="secondary" size="sm" class="h-7 text-xs" onclick={scrollToBottom}>
                  Go to bottom
                </Button>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Scroll navigation buttons (floating at bottom of scroll container) -->
    {#if story.entries.length > 0}
      {@const buttonClasses = 'h-8 w-8 rounded-full shadow-lg disabled:opacity-50 sm:h-9 sm:w-9'}
      {@const iconClasses = 'h-4 w-4 sm:h-5 sm:w-5'}

      <div class="pointer-events-none sticky right-0 bottom-0 left-0 z-20 flex justify-center py-2">
        <div class="pointer-events-auto flex gap-2">
          <!-- Scroll to top button -->
          {#if settings.uiSettings.showScrollToTop}
            <Button
              variant="secondary"
              size="sm"
              class={buttonClasses}
              onclick={scrollToTop}
              disabled={atVeryTop}
              aria-label="Scroll to first message"
            >
              <ChevronUp class={iconClasses} />
            </Button>
          {/if}

          <!-- Scroll to bottom button -->
          {#if settings.uiSettings.showScrollToBottom}
            <Button
              variant="secondary"
              size="sm"
              class={buttonClasses}
              onclick={scrollToBottom}
              disabled={atVeryBottom}
              aria-label="Scroll to bottom"
            >
              <ChevronDown class={iconClasses} />
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Action input area -->
  <div
    class="border-border relative z-10 border-t px-3 pt-2 pb-1 sm:pt-3 sm:pr-8 sm:pb-2 sm:pl-6 {story.currentBgImage
      ? 'bg-background/60 backdrop-blur-md'
      : 'bg-card'}"
  >
    <div class="mx-auto max-w-3xl">
      <ActionInput />
    </div>
  </div>
</div>
