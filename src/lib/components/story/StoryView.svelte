<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { settings, STORY_WIDTH_OPTIONS } from '$lib/stores/settings.svelte'
  import { Loader2, BookOpen, ChevronDown, ChevronUp } from '@lucide/svelte'
  import { tick, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import StoryEntry from './StoryEntry.svelte'
  import StreamingEntry from './StreamingEntry.svelte'
  import ActionInput from './ActionInput.svelte'
  import ActionChoices from './ActionChoices.svelte'
  import { Button } from '$lib/components/ui/button'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'
  import { eventBus, type BranchSwitchedEvent } from '$lib/services/events'

  const storyMaxWidthStyle = $derived.by(() => {
    const maxWidth =
      STORY_WIDTH_OPTIONS.find((o) => o.key === settings.uiSettings.storyMaxWidth)?.maxWidth ??
      '48rem'
    return `max-width: ${maxWidth}`
  })

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
  // Track physical scroll position at bottom (updated on scroll AND on content resize)
  let isAtPhysicalBottom = $state(true)

  // Track the current story ID to detect story switches
  let lastStoryId = $state<string | null>(null)

  // Auto-scroll to bottom when new entries are added or streaming content changes
  // Use requestAnimationFrame to batch scroll updates and avoid layout thrashing
  let scrollRAF: number | null = null
  let prevEntryCount = 0
  let suppressScrollHandler = false
  // Identifies the scroll that currently owns suppressScrollHandler. Overlapping
  // programmatic scrolls would otherwise have the earlier one clear the flag while the
  // later is still scrolling, and handleScroll would read that as a user scroll and
  // break auto-scroll. Only the newest owner clears it.
  let scrollSuppressOwner = 0

  // Suppress handleScroll for a programmatic scroll; returns the release callback.
  function suppressScrollFor(): () => void {
    const owner = ++scrollSuppressOwner
    suppressScrollHandler = true
    return () => {
      if (owner !== scrollSuppressOwner) return
      suppressScrollHandler = false
    }
  }

  // No reactive reads — runs once on mount, cleanup cancels any in-flight RAF on unmount
  $effect(() => {
    return () => {
      if (scrollRAF !== null) cancelAnimationFrame(scrollRAF)
    }
  })

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
      const isRemount = lastStoryId === null
      lastStoryId = currentStoryId
      prevEntryCount = story.entries.length
      // Drop any deferred landing: its branch or entry belongs to the story we just left
      pendingBranchLanding = false
      // Only when we actually left a story. This component is destroyed whenever another
      // panel is up, so every mount arrives here with lastStoryId still null and would
      // otherwise discard the very request that brought the panel back.
      if (!isRemount) ui.consumeEntryScroll()
      anchorToBottom(story.entries.length)
      tick().then(() => performScroll())
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
      if (!storyContainer) return
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
      if (!storyContainer) return
      // Compensate: removed entries above shift all content up
      storyContainer.scrollTop = prevScrollTop - (prevScrollHeight - storyContainer.scrollHeight)
    }
  }

  // Helper function to perform scroll with RAF batching.
  // Pass scrollPosition for an exact position, or omit/pass undefined to scroll to the
  // current bottom at RAF execution time (avoids stale scrollHeight from content changes).
  function performScroll(scrollPosition?: number) {
    if (!storyContainer) return

    if (scrollRAF !== null) {
      cancelAnimationFrame(scrollRAF)
    }

    scrollRAF = requestAnimationFrame(() => {
      if (storyContainer) {
        storyContainer.scrollTop = scrollPosition ?? storyContainer.scrollHeight
      }
      scrollRAF = null
    })
  }

  function scrollToBottom() {
    anchorToBottom(story.entries.length)
    performScroll()
  }

  async function scrollToTop() {
    ui.setScrollBreak(true)
    const release = suppressScrollFor()
    anchorToTop(story.entries.length)
    await tick()
    performScroll(0)
    // Reset in the frame AFTER performScroll's RAF fires, so the scroll event
    // triggered by scrollTop=0 is still ignored by handleScroll
    requestAnimationFrame(() => {
      release()
    })
  }

  // ===== Branch navigation =====

  // How many entries before the fork point stay in the render window. This is about what
  // exists in the DOM, not what is on screen — the visible context above the fork entry is
  // decided by the lift in scrollEntryIntoView. Keeping a few rendered means scrolling up
  // from the fork point doesn't immediately hit the "earlier entries hidden" divider.
  const FORK_CONTEXT_BEFORE = 5

  // Most of the viewport the preceding entry may take when lifted into view. A tall entry
  // shows a slice; a short one shows in full, and the fork entry stays near the top either way.
  const CONTEXT_LIFT_MAX_RATIO = 0.3

  // A branch switch happened while the story panel was hidden; consumed when it returns
  let pendingBranchLanding = false

  // Scroll an entry to the top of the viewport. When `liftForContext` is set, the scroll is
  // then pulled up so the preceding entry is partly visible, which is what makes a fork
  // point read as a divergence from something rather than as the start of the story.
  // Falls back to the container bottom when the element isn't in the DOM.
  function scrollEntryIntoView(entryId: string, liftForContext = false) {
    const release = suppressScrollFor()
    requestAnimationFrame(() => {
      const el = storyContainer?.querySelector(`[data-entry-id="${entryId}"]`)
      if (el) {
        el.scrollIntoView({ block: 'start' })
        if (liftForContext && storyContainer) {
          const prevEl = el.previousElementSibling
          if (prevEl) {
            // Cap the lift so a long preceding entry can't push the fork entry off the bottom
            const lift = Math.min(
              prevEl.getBoundingClientRect().height,
              CONTEXT_LIFT_MAX_RATIO * storyContainer.clientHeight,
            )
            storyContainer.scrollTop -= lift
          }
        }
      } else {
        performScroll()
      }
      // Reset in the frame AFTER the scroll, so its scroll event is still ignored
      requestAnimationFrame(() => {
        release()
        if (storyContainer) {
          userScrolledDown = !isNearEdge('top')
          isAtPhysicalBottom = isNearEdge('bottom')
        }
      })
    })
  }

  // Where a branch switch leaves the reader: at the very end of the switched-to branch.
  // The window is recomputed for this branch's own length — inheriting it from the branch
  // being left is what clamps it to an empty slice when switching to a shorter one.
  async function performBranchLanding() {
    const total = story.entries.length
    // Claim the current count so the auto-scroll effect doesn't see this as "entries added"
    prevEntryCount = total
    ui.setScrollBreak(false)
    anchorToBottom(total)
    await tick()

    // The container bottom, not the last entry's top edge: past the entry and the action
    // choices below it is where writing continues.
    performScroll()
  }

  // Window the virtual list around one entry and scroll to it. Returns false, having
  // changed nothing, when the entry isn't in the current branch's view — the view can
  // only scroll to what it can render, and the caller decides what to do instead.
  async function landOnEntry(entryId: string): Promise<boolean> {
    const entries = story.entries
    const idx = entries.findIndex((e) => e.id === entryId)
    if (idx === -1) return false

    const total = entries.length
    prevEntryCount = total
    // Landing away from the end is a scroll break: the next narration must not yank
    // the view back to the bottom while the user reads where they asked to be.
    ui.setScrollBreak(true)
    windowStart = Math.max(0, idx - FORK_CONTEXT_BEFORE)
    windowEnd = Math.min(total, idx + DEFAULT_VISIBLE_ENTRIES)
    await tick()

    // Lift the scroll so the preceding entry stays partly visible: a fork point should
    // read as a departure from something, not as the start of the story.
    scrollEntryIntoView(entryId, true)
    return true
  }

  // No reactive reads in the effect bodies — subscribe once, unsubscribe on teardown
  $effect(() => {
    // The payload is unread: landing resolves everything from the store when it runs
    return eventBus.subscribe<BranchSwitchedEvent>('BranchSwitched', (event) => {
      // The switch is one step of a jump someone else is making: they position the view, and
      // landing at the end of the branch here would race the entry they are about to request.
      // Matched on the branch, so a switch already in flight cannot spend someone else's claim.
      if (ui.consumeBranchLandingClaim(event.branchId)) return

      // Panel hidden: defer until the story panel comes back (see panel effect below)
      if (ui.activePanel !== 'story' || !storyContainer) {
        pendingBranchLanding = true
        return
      }

      void performBranchLanding()
    })
  })

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
  // Handle scroll events — update scroll break state, button visibility, and lazy-load triggers
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
    isAtPhysicalBottom = nearBottom
  }

  // Disabled when truly at the very start/end of the entire story
  const atVeryTop = $derived(displayedEntries.hiddenAtTop === 0 && !userScrolledDown)
  const atVeryBottom = $derived(displayedEntries.hiddenAtBottom === 0 && isAtPhysicalBottom)

  // Auto-scroll to bottom when new entries are added or streaming content changes
  $effect(() => {
    // Track primary scroll-inducing changes
    const currentCount = story.entries.length
    const _ = innerHeight
    const __ = containerHeight

    // Update physical bottom state on content/viewport resize (scroll events handle it during scrolling)
    if (storyContainer) isAtPhysicalBottom = isNearEdge('bottom')

    // Detect if entries were added (vs deleted or unchanged).
    // wasEmpty: entries just loaded for the first time for this story.
    const prevCount = prevEntryCount
    const wasAdded = currentCount > prevCount
    const wasEmpty = prevCount === 0 && wasAdded
    prevEntryCount = currentCount

    const lastEntry = story.entries[story.entries.length - 1]
    // Key entries (user action, narration, retry) must never be hidden behind
    // the "N later entries hidden" collapse indicator.
    const isKeyEntry =
      wasAdded && lastEntry && ['user_action', 'retry', 'narration'].includes(lastEntry.type)

    if (wasAdded) {
      if (!ui.userScrolledUp) {
        // Normal case: anchor window to the latest entries
        anchorToBottom(currentCount)
      } else if (isKeyEntry) {
        // User is scrolled up but a key entry arrived: extend windowEnd so the
        // entry is in the virtual window (no collapse), but do NOT call
        // anchorToBottom (which trims windowStart and can re-trigger this effect
        // via innerHeight changes, inadvertently causing a scroll to bottom).
        windowEnd = currentCount
      }
    }

    // Initial story load: entries just went from 0 → N (loaded asynchronously
    // after the story switch). Always scroll to bottom here — autoScroll only
    // applies during generation, not when positioning on story open.
    // This fires AFTER the story-switch effect's early performScroll (which ran
    // against an empty container) and its cancelAnimationFrame ensures it wins.
    if (wasEmpty) {
      performScroll()
      return
    }

    // Physical scroll: autoScroll setting must be enabled. user_action/retry
    // additionally override the userScrolledUp check (sending a message always
    // re-engages auto-scroll). Narration does NOT — if the user scrolled up
    // during streaming they stay where they are.
    const shouldScroll =
      settings.uiSettings.autoScroll &&
      (ui.isStreaming || wasAdded) &&
      (!ui.userScrolledUp ||
        (wasAdded && lastEntry && ['user_action', 'retry'].includes(lastEntry.type)))

    if (!shouldScroll) return

    performScroll()
  })

  // Scroll to bottom when opening/returning to story panel — always, regardless of autoScroll
  // (autoScroll only controls scrolling during generation, not initial panel positioning)
  // untrack prevents story.entries.length (accessed inside scrollToBottom) from being
  // tracked as a dependency — otherwise this effect would re-fire on every new entry.
  $effect(() => {
    if (ui.activePanel === 'story' && storyContainer) {
      untrack(() => {
        // A branch switch that happened while the panel was hidden lands now instead
        const pending = pendingBranchLanding
        pendingBranchLanding = false
        // …as does a jump-to-entry request made from another panel, which is why the
        // request lives on the ui store: this component is destroyed while another
        // panel is up, so it cannot be waiting on an event when the request is made.
        // Read untracked — consuming it must not re-run this effect and undo the
        // landing with the scrollToBottom below.
        // Consumed before the branch-landing return, so a request that can no longer be
        // honoured — one made for a story that was closed before the panel came back, or
        // one a branch landing takes precedence over — doesn't linger and get picked up
        // by the trailing effect as a second landing competing with this one.
        const entryId = ui.consumeEntryScroll()
        if (pending) {
          void performBranchLanding()
          return
        }
        if (entryId && story.entries.some((e) => e.id === entryId)) {
          void landOnEntry(entryId)
          return
        }
        scrollToBottom()
      })
    }
  })

  // The same request, arriving while the story panel is already up — the effect above
  // won't re-run, since neither activePanel nor storyContainer changed. Declared after
  // it so that on a remount the panel effect takes the request first and this one finds
  // nothing; consumeEntryScroll is atomic, so exactly one of the two ever lands it.
  $effect(() => {
    const entryId = ui.pendingEntryScrollId
    if (!entryId || ui.activePanel !== 'story' || !storyContainer) return
    untrack(() => {
      ui.consumeEntryScroll()
      void landOnEntry(entryId)
    })
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
    <div
      class="mx-auto space-y-2.5 sm:space-y-3"
      style={storyMaxWidthStyle}
      bind:clientHeight={innerHeight}
    >
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
          <!-- data-entry-id lets branch-switch landing locate a specific entry element -->
          <div data-entry-id={entry.id}>
            <StoryEntry {entry} />
          </div>
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
          {#if settings.uiSettings.showScrollToTop && !atVeryTop}
            <div transition:fade={{ duration: 150 }}>
              <Button
                variant="secondary"
                size="sm"
                class={buttonClasses}
                onclick={scrollToTop}
                aria-label="Scroll to first message"
              >
                <ChevronUp class={iconClasses} />
              </Button>
            </div>
          {/if}

          <!-- Scroll to bottom button -->
          {#if settings.uiSettings.showScrollToBottom && !atVeryBottom}
            <div transition:fade={{ duration: 150 }}>
              <Button
                variant="secondary"
                size="sm"
                class={buttonClasses}
                onclick={scrollToBottom}
                aria-label="Scroll to bottom"
              >
                <ChevronDown class={iconClasses} />
              </Button>
            </div>
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
    <div class="mx-auto" style={storyMaxWidthStyle}>
      <ActionInput />
    </div>
  </div>
</div>
