<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import { Loader2, BookOpen, ChevronDown, ChevronUp } from 'lucide-svelte'
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

  // Track how many entries to show (starts at DEFAULT_VISIBLE_ENTRIES)
  let visibleEntryCount = $state(DEFAULT_VISIBLE_ENTRIES)

  // Track the current story ID to detect story switches
  let lastStoryId = $state<string | null>(null)

  // Reset visible count when story changes
  $effect(() => {
    const currentStoryId = story.currentStory?.id ?? null

    // If story changed, reset the visible count
    if (currentStoryId !== lastStoryId) {
      lastStoryId = currentStoryId
      visibleEntryCount = DEFAULT_VISIBLE_ENTRIES
    }
  })

  // Compute which entries to render (using $derived.by for complex logic)
  const displayedEntries = $derived.by(() => {
    const entries = story.entries
    const total = entries.length

    if (total <= visibleEntryCount) {
      return { entries, hiddenCount: 0, startIndex: 0 }
    }

    // Show the most recent entries
    const startIndex = total - visibleEntryCount
    return {
      entries: entries.slice(startIndex),
      hiddenCount: startIndex,
      startIndex,
    }
  })

  function showMoreEntries() {
    visibleEntryCount = Math.min(visibleEntryCount + LOAD_MORE_BATCH, story.entries.length)
  }

  function showAllEntries() {
    visibleEntryCount = story.entries.length
  }

  function scrollToBottom() {
    if (!storyContainer) return

    if (scrollRAF !== null) {
      cancelAnimationFrame(scrollRAF)
    }

    // Batch scroll update with requestAnimationFrame for better performance
    scrollRAF = requestAnimationFrame(() => {
      if (storyContainer) {
        storyContainer.scrollTop = storyContainer.scrollHeight
      }
      scrollRAF = null
    })
  }

  // Track whether the user has scrolled away from the top
  let isScrolledFromTop = $state(false)

  // Check if container is scrolled near bottom
  function isNearBottom(): boolean {
    if (!storyContainer) return true
    const threshold = 50 // pixels from bottom
    return (
      storyContainer.scrollHeight - storyContainer.scrollTop - storyContainer.clientHeight <
      threshold
    )
  }

  function isNearTop(): boolean {
    if (!storyContainer) return true
    return storyContainer.scrollTop < 100
  }

  // Handle scroll events during streaming
  function handleScroll() {
    if (!storyContainer) return

    // Keep userScrolledUp in sync with actual scroll position
    // This allows re-engaging auto-scroll when the user scrolls back to bottom
    const nearBottom = isNearBottom()

    // Update the break state based on current scroll position
    // If we are near bottom, we are NOT "scrolled up"
    // If we are NOT near bottom, we ARE "scrolled up"
    if (nearBottom) {
      if (ui.userScrolledUp) ui.setScrollBreak(false)
    } else {
      if (!ui.userScrolledUp) ui.setScrollBreak(true)
    }

    // Track scroll-from-top for the scroll-to-top button
    isScrolledFromTop = !isNearTop()
  }

  function scrollToTop() {
    // Load all entries first so the user can see the full history
    if (displayedEntries.hiddenCount > 0) {
      showAllEntries()
    }

    requestAnimationFrame(() => {
      if (storyContainer) {
        storyContainer.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  // Auto-scroll to bottom when new entries are added or streaming content changes
  // Use requestAnimationFrame to batch scroll updates and avoid layout thrashing
  let scrollRAF: number | null = null
  let prevEntryCount = 0

  $effect(() => {
    // Track primary scroll-inducing changes
    const currentCount = story.entries.length
    const _ = innerHeight
    const __ = containerHeight

    // Detect if entries were added (vs deleted or unchanged)
    const wasAdded = currentCount > prevEntryCount
    prevEntryCount = currentCount

    // Detect if we should scroll:
    // 1. Auto-scroll is enabled AND we are NOT user-scrolled-up (pinned mode)
    // 2. OR on user action send message/retry (always scroll for user's own actions)
    const lastEntry = story.entries[story.entries.length - 1]
    const isUserAction = wasAdded && lastEntry && ['user_action', 'retry'].includes(lastEntry.type)
    const shouldScroll = (settings.uiSettings.autoScroll && !ui.userScrolledUp) || isUserAction

    if (!shouldScroll) return

    scrollToBottom()
  })

  // Scroll to bottom when returning from gallery or other panels
  $effect(() => {
    if (settings.uiSettings.autoScroll && ui.activePanel === 'story' && storyContainer) {
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
    class="relative z-10 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-4"
    onscroll={handleScroll}
  >
    <div class="mx-auto max-w-3xl space-y-3 sm:space-y-4" bind:clientHeight={innerHeight}>
      {#if story.entries.length === 0 && !ui.isStreaming}
        <EmptyState
          icon={BookOpen}
          title="Your adventure begins here..."
          description="Type an action below to start your story."
          class="py-12 sm:py-20"
        />
      {:else}
        <!-- Show collapsed entries indicator if there are hidden entries -->
        {#if displayedEntries.hiddenCount > 0}
          <div class="border-border mb-3 flex flex-col items-center gap-2 border-b py-3">
            <p class="text-muted-foreground text-sm">
              {displayedEntries.hiddenCount} earlier entries hidden for performance
            </p>
            <div class="flex gap-2">
              <Button variant="secondary" size="sm" class="h-7 text-xs" onclick={showMoreEntries}>
                Show {Math.min(LOAD_MORE_BATCH, displayedEntries.hiddenCount)} more
              </Button>
              <Button variant="text" size="sm" class="h-7 text-xs" onclick={showAllEntries}>
                Show all
              </Button>
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
      {/if}
    </div>

    <!-- Scroll navigation buttons -->
    {#if ui.userScrolledUp || (settings.uiSettings.showScrollToTop && isScrolledFromTop)}
      <div class="pointer-events-none sticky bottom-2 flex w-full justify-center pb-2">
        <div class="animate-in fade-in slide-in-from-bottom-2 pointer-events-auto flex gap-2">
          {#if settings.uiSettings.showScrollToTop && isScrolledFromTop}
            <Button
              variant="secondary"
              size="sm"
              class="border-border bg-background/80 hover:bg-accent h-9 w-9 rounded-full border shadow-lg backdrop-blur-sm"
              onclick={scrollToTop}
              aria-label="Scroll to top"
            >
              <ChevronUp class="h-5 w-5" />
            </Button>
          {/if}
          {#if ui.userScrolledUp}
            <Button
              variant="secondary"
              size="sm"
              class="border-border bg-background/80 hover:bg-accent h-9 w-9 rounded-full border shadow-lg backdrop-blur-sm"
              onclick={scrollToBottom}
              aria-label="Scroll to bottom"
            >
              <ChevronDown class="h-5 w-5" />
            </Button>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Action input area -->
  <div
    class="border-border relative z-10 border-t px-3 pt-2 pb-1 sm:py-4 sm:pr-8 sm:pl-6 {story.currentBgImage
      ? 'bg-background/60 backdrop-blur-md'
      : 'bg-card'}"
  >
    <div class="mx-auto max-w-3xl">
      <ActionInput />
    </div>
  </div>
</div>
