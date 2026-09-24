<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    buildLandmarks,
    checkpointDeletionBlocker,
    entryNumber,
    jumpToEntry,
    resolveEntryByNumber,
    type Landmark,
  } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import { ask } from '@tauri-apps/plugin-dialog'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'
  import * as Tabs from '$lib/components/ui/tabs'
  import TimelinePanel from '$lib/components/world/TimelinePanel.svelte'
  import { swipe } from '$lib/utils/swipe'
  import {
    Bookmark,
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    CornerDownLeft,
    Edit2,
    GitBranch,
    Milestone,
    Navigation,
    Trash2,
    X,
  } from '@lucide/svelte'

  /**
   * Anchors and reconciliation live beside navigation rather than in the world sidebar: both
   * are about the story's shape across branches, and both jump to entries. The clock stays in
   * the sidebar, because it belongs to the branch being played.
   */
  /** Left to right on screen. Navigation sits nearest the story and opens first. */
  const tabs = ['timeline', 'navigation'] as const

  /**
   * The sidebar's tab gestures, mirrored for a panel on the other edge.
   *
   * One gesture carries the reader inward: the swipe that opens the panel keeps stepping
   * through its tabs, and the opposite swipe walks back out and finally closes. The sidebar
   * enters from the right on a left swipe; this panel enters from the left on a right one, so
   * the tab strip is ordered to match and the first tab is the one nearest the story.
   */
  function handleSwipeRight() {
    const index = tabs.indexOf(ui.navPanelTab)
    if (index > 0) ui.setNavPanelTab(tabs[index - 1])
  }

  function handleSwipeLeft() {
    const index = tabs.indexOf(ui.navPanelTab)
    if (index < tabs.length - 1) {
      ui.setNavPanelTab(tabs[index + 1])
    } else {
      ui.closeNavPanel()
    }
  }
  let numberInput = $state('')
  let renamingCheckpointId = $state<string | null>(null)
  let renameValue = $state('')
  let landmarkNavigationMode = $state<'current-branch' | 'checkpoint-branch'>('current-branch')

  const activeBranch = $derived.by(() => {
    const branchId = story.currentStory?.currentBranchId ?? null
    if (!branchId) return null
    return story.branches.find((b) => b.id === branchId) ?? null
  })

  const landmarkList = $derived(
    buildLandmarks(story.entries, story.checkpoints, story.branches, activeBranch),
  )
  const landmarks = $derived(landmarkList.landmarks)
  const orphaned = $derived(landmarkList.orphaned)

  // Not persisted with the panel's own state: a reader who opens this to clear one checkpoint out
  // does not want it open on every story afterwards. Closing the panel unmounts this component,
  // but loading another story does not — it reassigns `currentStory` rather than clearing it — so
  // the fold is reset against the story it was opened for.
  let orphansExpanded = $state(false)
  let expandedForStoryId: string | null = null

  $effect(() => {
    const storyId = story.currentStory?.id ?? null
    if (storyId === expandedForStoryId) return
    expandedForStoryId = storyId
    orphansExpanded = false
  })

  const lastNumber = $derived(
    story.entries.length > 0 ? entryNumber(story.entries[story.entries.length - 1]) : 0,
  )

  function goToNumber() {
    if (!numberInput.trim()) return
    const entry = resolveEntryByNumber(story.entries, numberInput)
    if (!entry) {
      ui.showToast(
        story.entries.length === 0 ? 'This branch has no entries' : 'Enter a valid entry number',
        'error',
      )
      return
    }
    jumpToEntry({
      entries: story.entries,
      entryId: entry.id,
      ui,
      confirmation: `Jumped to entry ${entryNumber(entry)}`,
      closeOnMobile: () => ui.closeNavPanelOnMobile(),
      canHover: supportsHover(),
    })
  }

  function setLandmarkNavigationMode(value: string) {
    if (value === 'current-branch' || value === 'checkpoint-branch') {
      landmarkNavigationMode = value
    }
  }

  async function goToLandmark(landmark: Landmark) {
    const currentBranchId = story.currentStory?.currentBranchId ?? null
    if (landmarkNavigationMode === 'checkpoint-branch' && currentBranchId !== landmark.branchId) {
      // Refused before the landing is claimed, so a blocked switch leaves no claim to clean up.
      if (story.isGenerationLeaseHeld) {
        ui.showToast('Cannot switch branches while a generation is in progress', 'error')
        return
      }
      // Claimed before the switch, because the event that triggers the story view's own
      // end-of-branch landing is emitted inside it.
      ui.claimBranchLanding(landmark.branchId)
      try {
        await story.switchBranch(landmark.branchId)
      } catch (error) {
        console.error('Failed to switch to landmark branch:', error)
        ui.showToast(error instanceof Error ? error.message : 'Failed to switch branch', 'error')
        return
      } finally {
        // Only a mounted story view consumes the claim, and it is unmounted whenever another
        // panel is up — so drop it either way rather than let it suppress a later switch.
        ui.clearBranchLandingClaim()
      }
    }

    jumpToEntry({
      entries: story.entries,
      entryId: landmark.entryId,
      ui,
      confirmation: `Jumped to entry ${landmark.number}`,
      closeOnMobile: () => ui.closeNavPanelOnMobile(),
      canHover: supportsHover(),
    })
  }

  // The row is inert by design, but a tap that does nothing reads as a broken control where
  // there is no tooltip to explain it.
  function reportOrphan() {
    if (!supportsHover()) {
      ui.showToast('This checkpoint has no entry left to go to', 'info', 2000)
    }
  }

  function startRename(checkpointId: string, name: string) {
    renamingCheckpointId = checkpointId
    renameValue = name
  }

  async function confirmRename() {
    if (renamingCheckpointId && renameValue.trim()) {
      try {
        await story.renameCheckpoint(renamingCheckpointId, renameValue.trim())
      } catch (error) {
        console.error('Failed to rename checkpoint:', error)
        ui.showToast('Failed to rename checkpoint', 'error')
        return
      }
    }
    renamingCheckpointId = null
    renameValue = ''
  }

  function cancelRename() {
    renamingCheckpointId = null
    renameValue = ''
  }

  async function handleDeleteCheckpoint(
    checkpointId: string,
    checkpointName: string,
    blockedReason: string | null,
  ) {
    if (blockedReason) {
      ui.showToast(blockedReason, 'error')
      return
    }

    const confirmed = await ask(
      `Are you sure you want to delete checkpoint "${checkpointName}"? This cannot be undone.`,
      { title: 'Delete Checkpoint', kind: 'warning' },
    )
    if (!confirmed) return

    try {
      await story.deleteCheckpoint(checkpointId)
    } catch (error) {
      console.error('Failed to delete checkpoint:', error)
      ui.showToast(error instanceof Error ? error.message : 'Failed to delete checkpoint', 'error')
    }
  }
</script>

<aside
  class="border-border bg-card/95 flex h-full w-full flex-col border-r backdrop-blur-[2px]"
  aria-label="Story navigation"
  use:swipe={{ onSwipeLeft: handleSwipeLeft, onSwipeRight: handleSwipeRight, threshold: 50 }}
>
  <Tabs.Root
    value={ui.navPanelTab}
    onValueChange={(v) => ui.setNavPanelTab(v as (typeof tabs)[number])}
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="border-border bg-muted/60 flex-shrink-0 border-b">
      <Tabs.List class="flex h-auto w-full justify-start rounded-none bg-transparent p-0">
        <Tabs.Trigger
          value="timeline"
          class="data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-muted/30 hover:bg-muted/20 text-muted-foreground flex-1 rounded-none border-b-2 border-transparent bg-transparent py-3 transition-colors"
          title="Timeline"
        >
          <Clock class="h-4 w-4" />
        </Tabs.Trigger>
        <Tabs.Trigger
          value="navigation"
          class="data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-muted/30 hover:bg-muted/20 text-muted-foreground flex-1 rounded-none border-b-2 border-transparent bg-transparent py-3 transition-colors"
          title="Navigation"
        >
          <Navigation class="h-4 w-4" />
        </Tabs.Trigger>
      </Tabs.List>
    </div>

    <Tabs.Content value="timeline" class="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
      <TimelinePanel />
    </Tabs.Content>

    <Tabs.Content value="navigation" class="mt-0 flex min-h-0 flex-1 flex-col">
      <!-- The list scrolls; the mode selector below it does not, so it stays reachable
           whether the story has two landmarks or forty. -->
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <h3 class="text-foreground mb-3 text-xl font-bold tracking-tight">Navigation</h3>
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
            {#each landmarks as landmark (landmark.checkpointId ?? `origin:${landmark.entryId}`)}
              <div
                class="group hover:bg-surface-700/50 relative min-h-[40px] rounded-lg transition-colors sm:min-h-0"
              >
                {#if landmark.checkpointId && renamingCheckpointId === landmark.checkpointId}
                  <div class="flex items-start gap-2 p-2 text-left">
                    {#if landmark.kind === 'origin'}
                      <GitBranch class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    {:else}
                      <Bookmark class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    {/if}
                    <span class="text-surface-500 mt-0.5 shrink-0 font-mono text-xs tabular-nums">
                      {landmark.number}
                    </span>
                    <input
                      type="text"
                      class="input min-w-0 flex-1 px-1 py-0.5 text-sm"
                      aria-label="Checkpoint name"
                      bind:value={renameValue}
                      onkeydown={(e) => {
                        if (e.key === 'Enter') confirmRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                    />
                    <button
                      class="flex min-h-[32px] min-w-[32px] items-center justify-center p-1 text-green-400 hover:text-green-300 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                      onclick={confirmRename}
                      title="Save checkpoint name"
                      aria-label="Save checkpoint name"
                    >
                      <Check class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    </button>
                    <button
                      class="text-surface-400 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                      onclick={cancelRename}
                      title="Cancel rename"
                      aria-label="Cancel checkpoint rename"
                    >
                      <X class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    </button>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="flex min-h-[40px] w-full items-start gap-2 rounded-lg p-2 pr-20 text-left sm:min-h-0 sm:pr-14"
                    onclick={() => void goToLandmark(landmark)}
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
                      <span class="text-surface-200 block text-sm break-words"
                        >{landmark.label}</span
                      >
                      <span class="text-surface-500 block truncate text-xs"
                        >{landmark.branchName}</span
                      >
                    </span>
                  </button>
                  {#if landmark.checkpointId}
                    {@const deleteBlockedReason = checkpointDeletionBlocker(
                      landmark.checkpointId,
                      story.branches,
                    )}
                    {@const deleteUnavailable = deleteBlockedReason !== null}
                    <div
                      class="absolute top-1 right-1 flex transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
                    >
                      <button
                        class="text-surface-500 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                        onclick={() => startRename(landmark.checkpointId!, landmark.label)}
                        title="Rename"
                        aria-label="Rename checkpoint"
                      >
                        <Edit2 class="h-4 w-4 sm:h-3 sm:w-3" />
                      </button>
                      <button
                        class="flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5 {deleteUnavailable
                          ? 'text-surface-600 cursor-not-allowed'
                          : 'text-surface-500 hover:text-destructive'}"
                        onclick={() =>
                          void handleDeleteCheckpoint(
                            landmark.checkpointId!,
                            landmark.label,
                            deleteBlockedReason,
                          )}
                        title={deleteUnavailable
                          ? 'Cannot delete: used to create a branch'
                          : 'Delete checkpoint'}
                        aria-label={deleteUnavailable
                          ? 'Cannot delete checkpoint: used to create a branch'
                          : 'Delete checkpoint'}
                        aria-disabled={deleteUnavailable}
                      >
                        <Trash2 class="h-4 w-4 sm:h-3 sm:w-3" />
                      </button>
                    </div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        {#if orphaned.length > 0}
          <div class="border-surface-700/60 mt-4 border-t pt-3">
            <button
              type="button"
              class="text-muted-foreground hover:text-surface-200 flex min-h-[32px] w-full items-center gap-2 text-left text-xs font-medium tracking-wider uppercase"
              onclick={() => (orphansExpanded = !orphansExpanded)}
              aria-expanded={orphansExpanded}
              aria-controls="orphaned-checkpoints"
            >
              {#if orphansExpanded}
                <ChevronDown class="h-3.5 w-3.5 shrink-0" />
              {:else}
                <ChevronRight class="h-3.5 w-3.5 shrink-0" />
              {/if}
              Orphaned ({orphaned.length})
            </button>

            {#if orphansExpanded}
              <div id="orphaned-checkpoints" class="mt-2 space-y-1">
                {#each orphaned as orphan (orphan.checkpointId)}
                  <div
                    class="group hover:bg-surface-700/50 relative min-h-[40px] rounded-lg transition-colors sm:min-h-0"
                  >
                    {#if renamingCheckpointId === orphan.checkpointId}
                      <div class="flex items-start gap-2 p-2 text-left">
                        <Bookmark class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                        <Input
                          bind:value={renameValue}
                          class="h-7 flex-1 text-sm"
                          aria-label="Checkpoint name"
                          onkeydown={(e: KeyboardEvent) => {
                            if (e.key === 'Enter') void confirmRename()
                            if (e.key === 'Escape') cancelRename()
                          }}
                        />
                        <button
                          class="text-surface-500 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                          onclick={() => void confirmRename()}
                          title="Save checkpoint name"
                          aria-label="Save checkpoint name"
                        >
                          <Check class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </button>
                        <button
                          class="text-surface-500 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                          onclick={cancelRename}
                          title="Cancel rename"
                          aria-label="Cancel checkpoint rename"
                        >
                          <X class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                        </button>
                      </div>
                    {:else}
                      <button
                        type="button"
                        class="flex min-h-[40px] w-full items-start gap-2 rounded-lg p-2 pr-20 text-left sm:min-h-0 sm:pr-14"
                        onclick={reportOrphan}
                        title="This checkpoint's entry no longer exists, so there is nowhere to go"
                      >
                        <Bookmark class="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                        <span class="min-w-0 flex-1">
                          <span class="text-surface-200 block text-sm break-words"
                            >{orphan.label}</span
                          >
                          <span class="text-destructive block truncate text-xs">orphaned</span>
                        </span>
                      </button>
                      {@const orphanBlockedReason = checkpointDeletionBlocker(
                        orphan.checkpointId,
                        story.branches,
                      )}
                      {@const orphanDeleteUnavailable = orphanBlockedReason !== null}
                      <div
                        class="absolute top-1 right-1 flex transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
                      >
                        <button
                          class="text-surface-500 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
                          onclick={() => startRename(orphan.checkpointId, orphan.label)}
                          title="Rename"
                          aria-label="Rename checkpoint"
                        >
                          <Edit2 class="h-4 w-4 sm:h-3 sm:w-3" />
                        </button>
                        <button
                          class="flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5 {orphanDeleteUnavailable
                            ? 'text-surface-600 cursor-not-allowed'
                            : 'text-surface-500 hover:text-destructive'}"
                          onclick={() =>
                            void handleDeleteCheckpoint(
                              orphan.checkpointId,
                              orphan.label,
                              orphanBlockedReason,
                            )}
                          title={orphanDeleteUnavailable
                            ? 'Cannot delete: used to create a branch'
                            : 'Delete checkpoint'}
                          aria-label={orphanDeleteUnavailable
                            ? 'Cannot delete checkpoint: used to create a branch'
                            : 'Delete checkpoint'}
                          aria-disabled={orphanDeleteUnavailable}
                        >
                          <Trash2 class="h-4 w-4 sm:h-3 sm:w-3" />
                        </button>
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Not locked during a generation: this chooses what a landmark tap does, it does not
           switch anything. Locking it would hide which mode is set and block the one useful
           response — selecting "stay on current branch". The switch itself is refused in
           goToLandmark. -->
      <div class="border-border shrink-0 border-t p-3">
        <p class="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
          Landmark navigation
        </p>
        <RadioGroup
          value={landmarkNavigationMode}
          onValueChange={setLandmarkNavigationMode}
          class="gap-2"
          aria-label="Landmark navigation behavior"
        >
          <div class="flex items-center gap-2">
            <RadioGroupItem value="current-branch" id="landmark-current-branch" />
            <Label for="landmark-current-branch" class="cursor-pointer text-xs font-normal">
              Stay on current branch
            </Label>
          </div>
          <div class="flex items-center gap-2">
            <RadioGroupItem value="checkpoint-branch" id="landmark-checkpoint-branch" />
            <Label for="landmark-checkpoint-branch" class="cursor-pointer text-xs font-normal">
              Switch to checkpoint branch
            </Label>
          </div>
        </RadioGroup>
      </div>
    </Tabs.Content>
  </Tabs.Root>
</aside>
