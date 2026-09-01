<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import {
    buildLandmarks,
    entryNumber,
    resolveEntryByNumber,
    type Landmark,
  } from '$lib/utils/storyNavigation'
  import { supportsHover } from '$lib/utils/platform'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import EmptyState from '$lib/components/ui/empty-state/empty-state.svelte'
  import { swipe } from '$lib/utils/swipe'
  import { Bookmark, Check, CornerDownLeft, Edit2, GitBranch, Milestone, X } from '@lucide/svelte'

  let numberInput = $state('')
  let renamingCheckpointId = $state<string | null>(null)
  let renameValue = $state('')
  let landmarkNavigationMode = $state<'current-branch' | 'checkpoint-branch'>('current-branch')

  const activeBranch = $derived.by(() => {
    const branchId = story.currentStory?.currentBranchId ?? null
    if (!branchId) return null
    return story.branches.find((b) => b.id === branchId) ?? null
  })

  const landmarks = $derived(
    buildLandmarks(story.entries, story.checkpoints, story.branches, activeBranch),
  )

  const lastNumber = $derived(
    story.entries.length > 0 ? entryNumber(story.entries[story.entries.length - 1]) : 0,
  )

  // Fork points live in the story panel, which may not be the one that is up — and while it
  // isn't, StoryView is destroyed rather than hidden. The request is left on the ui store for
  // it to pick up on mount, the same way the Branches panel jumps to a fork point.
  function goTo(entryId: string, confirmation: string) {
    // The story view can only scroll to an entry it can render. Checked here as well so the
    // confirmation below reports what will actually happen rather than asserting success.
    const willLand = story.entries.some((e) => e.id === entryId)
    ui.requestEntryScroll(entryId)
    ui.setActivePanel('story')
    ui.closeNavPanelOnMobile()

    // Where the platform can't hover the panel may have just closed over the result, so the
    // jump confirms itself the way the fork-point jump does.
    if (!supportsHover()) {
      if (willLand) {
        ui.showToast(confirmation, 'info', 2000)
      } else {
        ui.showToast('That entry is not in this branch', 'error', 2000)
      }
    }
  }

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
    goTo(entry.id, `Jumped to entry ${entryNumber(entry)}`)
  }

  function setLandmarkNavigationMode(value: string) {
    if (value === 'current-branch' || value === 'checkpoint-branch') {
      landmarkNavigationMode = value
    }
  }

  async function goToLandmark(landmark: Landmark) {
    const currentBranchId = story.currentStory?.currentBranchId ?? null
    if (landmarkNavigationMode === 'checkpoint-branch' && currentBranchId !== landmark.branchId) {
      // Claimed before the switch, because the event that triggers the story view's own
      // end-of-branch landing is emitted inside it.
      ui.claimBranchLanding()
      try {
        await story.switchBranch(landmark.branchId)
      } catch (error) {
        console.error('Failed to switch to landmark branch:', error)
        ui.showToast(error instanceof Error ? error.message : 'Failed to switch branch', 'error')
        return
      } finally {
        // Only a mounted story view consumes the claim, and it is unmounted whenever another
        // panel is up — so drop it either way rather than let it suppress a later switch.
        ui.consumeBranchLandingClaim()
      }
    }

    goTo(landmark.entryId, `Jumped to entry ${landmark.number}`)
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
                class="flex min-h-[40px] w-full items-start gap-2 rounded-lg p-2 pr-10 text-left sm:min-h-0"
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
                  <span class="text-surface-200 block text-sm break-words">{landmark.label}</span>
                  <span class="text-surface-500 block truncate text-xs">{landmark.branchName}</span>
                </span>
              </button>
              {#if landmark.checkpointId}
                <button
                  class="text-surface-500 hover:text-surface-200 absolute top-1 right-1 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 transition-opacity sm:min-h-0 sm:min-w-0 sm:p-0.5 sm:opacity-0 sm:group-hover:opacity-100"
                  onclick={() => startRename(landmark.checkpointId!, landmark.label)}
                  title="Rename"
                  aria-label="Rename checkpoint"
                >
                  <Edit2 class="h-4 w-4 sm:h-3 sm:w-3" />
                </button>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="border-border border-t p-3">
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
</aside>
