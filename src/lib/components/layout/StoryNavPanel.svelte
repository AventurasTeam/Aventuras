<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { buildLandmarks, entryNumber, resolveEntryByNumber } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'
  import { swipe } from '$lib/utils/swipe'
  import { Bookmark, CornerDownLeft, GitBranch, Milestone, X } from '@lucide/svelte'

  let numberInput = $state('')

  const activeBranch = $derived.by(() => {
    const branchId = story.currentStory?.currentBranchId ?? null
    if (!branchId) return null
    return story.branches.find((b) => b.id === branchId) ?? null
  })

  const landmarks = $derived(buildLandmarks(story.entries, story.checkpoints, activeBranch))

  const lastNumber = $derived(
    story.entries.length > 0 ? entryNumber(story.entries[story.entries.length - 1]) : 0,
  )

  // Fork points live in the story panel, which may not be the one that is up — and while it
  // isn't, StoryView is destroyed rather than hidden. The request is left on the ui store for
  // it to pick up on mount, the same way the Branches panel jumps to a fork point.
  function goTo(entryId: string, confirmation: string) {
    ui.requestEntryScroll(entryId)
    ui.setActivePanel('story')
    ui.closeNavPanelOnMobile()

    // Where the platform can't hover the panel may have just closed over the result, so the
    // jump confirms itself the way the fork-point jump does.
    if (!supportsHover()) {
      ui.showToast(confirmation, 'info', 2000)
    }
  }

  function goToNumber() {
    const entry = resolveEntryByNumber(story.entries, numberInput)
    if (!entry) return
    goTo(entry.id, `Jumped to entry ${entryNumber(entry)}`)
  }
</script>

<aside
  class="border-border bg-card/95 flex h-full w-full flex-col border-r backdrop-blur-[2px]"
  aria-label="Story navigation"
  use:swipe={{ onSwipeLeft: () => ui.closeNavPanel(), threshold: 50 }}
>
  <div class="border-border flex items-center justify-between border-b px-3 py-2">
    <h3 class="text-surface-200 font-medium">Go to</h3>
    <Button
      variant="text"
      size="icon"
      class="text-muted-foreground hover:text-foreground h-10 w-10 sm:h-7 sm:w-7"
      onclick={() => ui.closeNavPanel()}
      title="Close"
      aria-label="Close story navigation"
    >
      <X class="h-4 w-4" />
    </Button>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-3">
    <div class="flex items-end gap-2">
      <Input
        type="text"
        inputmode="numeric"
        label="Entry number"
        placeholder={lastNumber > 0 ? `1 – ${lastNumber}` : ''}
        bind:value={numberInput}
        onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && goToNumber()}
      />
      <Button
        variant="secondary"
        class="shrink-0"
        onclick={goToNumber}
        disabled={numberInput.trim() === ''}
        title="Go to this entry"
      >
        <CornerDownLeft class="h-4 w-4" />
      </Button>
    </div>

    <h4 class="text-muted-foreground mt-5 mb-2 text-xs font-medium tracking-wider uppercase">
      Landmarks
    </h4>

    {#if landmarks.length === 0}
      <EmptyState
        icon={Milestone}
        size="sm"
        title="No landmarks"
        description="This branch has no starting point or checkpoints to jump to. Checkpoints are saved at chapter boundaries."
        class="py-6"
      />
    {:else}
      <div class="space-y-1">
        {#each landmarks as landmark (landmark.entryId)}
          <button
            class="hover:bg-surface-700/50 flex min-h-[40px] w-full items-start gap-2 rounded-lg p-2 text-left transition-colors sm:min-h-0"
            onclick={() => goTo(landmark.entryId, `Jumped to entry ${landmark.number}`)}
            title="Go to entry {landmark.number}:&#10;{landmark.label}"
          >
            {#if landmark.kind === 'origin'}
              <GitBranch class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            {:else}
              <Bookmark class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
            {/if}
            <span class="text-surface-500 mt-0.5 shrink-0 font-mono text-xs tabular-nums">
              {landmark.number}
            </span>
            <span class="min-w-0 flex-1">
              <!-- Wrapped rather than truncated: a name the reader chose is the only thing
                   telling these rows apart, and a touch device has no tooltip to fall back
                   on. The list is a handful of rows, so the vertical space is affordable. -->
              <span class="text-surface-200 block text-sm break-words">{landmark.label}</span>
              {#if landmark.preview}
                <span class="text-surface-500 block truncate text-xs">{landmark.preview}</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</aside>
