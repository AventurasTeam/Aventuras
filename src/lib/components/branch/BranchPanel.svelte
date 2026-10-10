<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { ask } from '@tauri-apps/plugin-dialog'
  import {
    GitBranch,
    ChevronRight,
    ChevronDown,
    Plus,
    Trash2,
    Edit2,
    Check,
    X,
    LayerArrowUp,
    Lock,
  } from '@lucide/svelte'
  import type { Branch } from '$lib/types'
  import { SvelteSet } from 'svelte/reactivity'
  import { tick, untrack } from 'svelte'
  import { supportsHover } from '$lib/utils/platform'
  import { errMessage } from '$lib/utils/error'
  import { checkpointsOnBranch, jumpToEntry } from '$lib/utils/storyNavigation'

  // Track expanded branches in tree view
  let expandedBranches = $state<Set<string>>(new Set(['main']))

  /**
   * Unfold the path down to the branch being read, so the tree never opens with the current
   * branch hidden inside a collapsed ancestor.
   *
   * Only its ancestors are expanded — a node's own state controls its children, not whether
   * its row is visible. Done once per branch, so a node collapsed afterwards stays collapsed.
   */
  let revealedFor: string | null | undefined = undefined

  $effect(() => {
    const branchId = story.currentStory?.currentBranchId ?? null
    const branches = story.branches
    if (branchId === revealedFor) return
    // Branches load after the story, so wait for the one we are asked to reveal.
    if (branchId && !branches.some((b) => b.id === branchId)) return
    revealedFor = branchId

    untrack(() => {
      const next = new SvelteSet(expandedBranches)
      next.add('main')
      let current = branches.find((b) => b.id === branchId)
      const visited = new SvelteSet<string>()
      while (current?.parentBranchId && !visited.has(current.id)) {
        visited.add(current.id)
        const parentId: string = current.parentBranchId
        next.add(parentId)
        current = branches.find((b) => b.id === parentId)
      }
      expandedBranches = next
    })
    void scrollCurrentRowIntoView()
  })

  let treeScroller = $state<HTMLDivElement | null>(null)

  /** Scroll offset that brings `[start, end]` into `[viewStart, viewEnd]`, `start` winning. */
  function nearestDelta(start: number, end: number, viewStart: number, viewEnd: number): number {
    if (start < viewStart) return start - viewStart
    if (end > viewEnd) return Math.min(end - viewEnd, start - viewStart)
    return 0
  }

  // Not `scrollIntoView`: it also scrolls the page, which on a phone shifts the whole app sideways
  // while the sidebar is still sliding in from off-screen.
  async function scrollCurrentRowIntoView() {
    await tick()
    const scroller = treeScroller
    const name = scroller?.querySelector<HTMLElement>('[data-current-name]')
    const row = name?.parentElement
    if (!scroller || !name || !row) return

    const view = scroller.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    const nameBox = name.getBoundingClientRect()
    scroller.scrollLeft += nearestDelta(rowBox.left, nameBox.right, view.left, view.right)

    let panel = scroller.parentElement
    while (panel && !/auto|scroll/.test(getComputedStyle(panel).overflowY)) {
      panel = panel.parentElement
    }
    if (!panel) return
    const panelBox = panel.getBoundingClientRect()
    panel.scrollTop += nearestDelta(rowBox.top, rowBox.bottom, panelBox.top, panelBox.bottom)
  }

  /** While the tree overflows, a sideways swipe over it belongs to the tree, not to `swipe`. */
  function keepsSidewaysSwipes(node: HTMLElement) {
    // Native, not `ontouchstart`: Svelte delegates that to the root, past the ancestors' listeners.
    function onTouchStart(e: TouchEvent) {
      if (node.scrollWidth > node.clientWidth) e.stopPropagation()
    }
    node.addEventListener('touchstart', onTouchStart, { passive: true })
    return {
      destroy() {
        node.removeEventListener('touchstart', onTouchStart)
      },
    }
  }

  // Track which branch is being renamed
  let renamingBranchId = $state<string | null>(null)
  let renameValue = $state('')

  // Track if creating new branch
  let showCreateForm = $state(false)
  let newBranchName = $state('')

  let entryCounts = $state<Record<string, number>>({})
  let entryCountsRun = 0

  function toggleExpand(branchId: string) {
    if (expandedBranches.has(branchId)) {
      expandedBranches.delete(branchId)
    } else {
      expandedBranches.add(branchId)
    }
    expandedBranches = new SvelteSet(expandedBranches)
  }

  function isExpanded(branchId: string): boolean {
    return expandedBranches.has(branchId)
  }

  // A generation writes against the branch loaded in memory, so it holds the branch until
  // its last write lands. See docs/architecture/overview.md.
  const switchingBlocked = $derived(story.isGenerationLeaseHeld)

  async function handleSwitchBranch(branchId: string | null) {
    if (switchingBlocked) return
    try {
      await story.switchBranch(branchId)
    } catch (error) {
      console.error('Failed to switch branch:', error)
      ui.showToast(errMessage(error), 'error')
    }
  }

  function startRename(branch: Branch) {
    renamingBranchId = branch.id
    renameValue = branch.name
  }

  async function confirmRename() {
    if (renamingBranchId && renameValue.trim()) {
      try {
        await story.renameBranch(renamingBranchId, renameValue.trim())
      } catch (error) {
        console.error('Failed to rename branch:', error)
      }
    }
    renamingBranchId = null
    renameValue = ''
  }

  function cancelRename() {
    renamingBranchId = null
    renameValue = ''
  }

  async function handleDeleteBranch(branchId: string) {
    const confirmed = await ask(
      'Are you sure you want to delete this branch? This will delete all entries in the branch.',
      { title: 'Delete Branch', kind: 'warning' },
    )
    if (!confirmed) return
    try {
      await story.deleteBranch(branchId)
    } catch (error) {
      console.error('Failed to delete branch:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete branch')
    }
  }

  function getLatestCheckpoint() {
    if (story.checkpoints.length === 0) return null
    const currentBranchId = story.currentStory?.currentBranchId ?? null
    // A checkpoint left behind by a story saved before entry deletion pruned them still points
    // at an entry that is gone; branching from it would fail on the missing fork entry.
    const liveEntryIds = new Set(story.entries.map((e) => e.id))
    const eligible = checkpointsOnBranch(story.checkpoints, currentBranchId).filter((checkpoint) =>
      liveEntryIds.has(checkpoint.lastEntryId),
    )
    if (eligible.length === 0) return null
    // Sort by createdAt descending and return the most recent
    const sorted = [...eligible].sort((a, b) => b.createdAt - a.createdAt)
    return sorted[0]
  }

  const latestCheckpoint = $derived(getLatestCheckpoint())
  const canCreateBranch = $derived(!!latestCheckpoint)

  /**
   * Distinguishes "never had one" from "had one, but its entry isn't there". A branch switch
   * sets the branch id before the entries it loads arrive, so the second case is ambiguous —
   * the same ambiguity `forkPointTitle` names below.
   */
  const createBranchTitle = $derived.by(() => {
    if (canCreateBranch) return 'Create new branch from latest checkpoint'
    const currentBranchId = story.currentStory?.currentBranchId ?? null
    const hadOne = checkpointsOnBranch(story.checkpoints, currentBranchId).length > 0
    return hadOne
      ? "This branch's checkpoints aren't usable - their entries aren't loaded yet, or were deleted"
      : 'No checkpoints available - checkpoints are created at chapter boundaries'
  })

  async function handleCreateBranch() {
    if (!newBranchName.trim()) return
    if (!latestCheckpoint) {
      alert(
        'Cannot create a branch without a checkpoint. Checkpoints are created at chapter boundaries.',
      )
      return
    }

    try {
      // Create branch from the most recent checkpoint
      await story.createBranchFromCheckpoint(
        newBranchName.trim(),
        latestCheckpoint.lastEntryId,
        latestCheckpoint.id,
      )
      newBranchName = ''
      showCreateForm = false
    } catch (error) {
      console.error('Failed to create branch:', error)
      alert(error instanceof Error ? error.message : 'Failed to create branch')
    }
  }

  // Get children of a branch (or main branch if null)
  function getChildBranches(parentId: string | null): Branch[] {
    return story.branches.filter((b) => b.parentBranchId === parentId)
  }

  async function refreshEntryCounts() {
    if (!story.currentStory) return
    const runId = ++entryCountsRun
    const counts: Record<string, number> = {}

    counts.main = await story.getBranchEntryCount(null)
    const branchCounts = await Promise.all(
      story.branches.map(async (branch) => ({
        id: branch.id,
        count: await story.getBranchEntryCount(branch.id),
      })),
    )
    for (const result of branchCounts) {
      counts[result.id] = result.count
    }

    if (runId !== entryCountsRun) return
    entryCounts = counts
  }

  $effect(() => {
    const _ = [
      story.currentStory?.id,
      story.currentStory?.currentBranchId,
      story.branches.length,
      story.entries.length,
    ]
    refreshEntryCounts()
  })

  function getBranchEntryCount(branchId: string | null): number {
    const key = branchId ?? 'main'
    return entryCounts[key] ?? 0
  }

  // Check if branch is current
  function isCurrent(branchId: string | null): boolean {
    return story.currentStory?.currentBranchId === branchId
  }

  // The action targets the branch being read. A per-branch control would be disabled on
  // most rows anyway: `story.entries` is the ACTIVE branch's view — main + ancestors up
  // to their forks + the branch itself — so any branch outside that lineage has its fork
  // entry nowhere in it. The active branch always has its own, so this is enabled
  // whenever there is a branching point at all, i.e. everywhere except main.
  const activeBranch = $derived.by(() => {
    const branchId = story.currentStory?.currentBranchId ?? null
    if (!branchId) return null
    return story.branches.find((b) => b.id === branchId) ?? null
  })

  const visibleEntryIds = $derived(new Set(story.entries.map((e) => e.id)))
  const canGoToForkPoint = $derived(
    !!activeBranch?.forkEntryId && visibleEntryIds.has(activeBranch.forkEntryId),
  )

  // Each way the button can be unavailable says so in its own words: claiming "no
  // branching point" while entries are still loading, or "not loaded yet" for a branch
  // that records no fork at all, would both send the reader looking for the wrong thing.
  const forkPointTitle = $derived.by(() => {
    if (canGoToForkPoint) return 'Jump to where this branch began'
    if (!story.currentStory?.currentBranchId) return 'The main branch has no branching point'
    if (!activeBranch?.forkEntryId) return 'This branch has no recorded branching point'
    return "This branch's starting point isn't loaded yet"
  })

  function goToForkPoint() {
    if (!canGoToForkPoint || !activeBranch) return

    jumpToEntry({
      entries: story.entries,
      entryId: activeBranch.forkEntryId,
      ui,
      confirmation: 'Jumped to where this branch began',
      closeOnMobile: () => ui.closeSidebarOnMobile(),
      canHover: supportsHover(),
    })
  }
</script>

<div class="relative">
  <!-- Unreachable rather than merely discouraged: a dimmed row with a tooltip says nothing on a
       touch device, where there is no cursor to change and no hover to explain it. -->
  <div class="space-y-3" inert={switchingBlocked}>
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-surface-200 font-medium">Branches</h3>
      <div class="flex items-center">
        <button
          class="btn-ghost can-hover:min-h-0 can-hover:min-w-0 can-hover:p-1.5 flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2 {canGoToForkPoint
            ? 'text-surface-400 hover:text-surface-200'
            : 'text-surface-600 cursor-not-allowed'}"
          onclick={goToForkPoint}
          disabled={!canGoToForkPoint}
          title={forkPointTitle}
        >
          <LayerArrowUp class="can-hover:size-4 size-5" />
        </button>
        <button
          class="btn-ghost can-hover:min-h-0 can-hover:min-w-0 can-hover:p-1.5 flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2 {canCreateBranch
            ? 'text-surface-400 hover:text-surface-200'
            : 'text-surface-600 cursor-not-allowed'}"
          onclick={() => canCreateBranch && (showCreateForm = !showCreateForm)}
          disabled={!canCreateBranch}
          title={createBranchTitle}
        >
          <Plus class="can-hover:size-4 size-5" />
        </button>
      </div>
    </div>

    <!-- Create Branch Form -->
    {#if showCreateForm && latestCheckpoint}
      <div class="card space-y-2 p-3">
        <p class="text-surface-400 text-xs">
          Branch from: <span class="text-surface-300">{latestCheckpoint.name}</span>
        </p>
        <input
          type="text"
          class="input w-full"
          placeholder="Branch name..."
          bind:value={newBranchName}
          onkeydown={(e) => e.key === 'Enter' && handleCreateBranch()}
        />
        <div class="flex justify-end gap-2">
          <button
            class="btn-ghost can-hover:min-h-0 can-hover:px-2 can-hover:py-1 can-hover:text-xs min-h-[40px] rounded px-3 py-2 text-sm"
            onclick={() => {
              showCreateForm = false
              newBranchName = ''
            }}
          >
            Cancel
          </button>
          <button
            class="btn-primary can-hover:min-h-0 can-hover:px-2 can-hover:py-1 can-hover:text-xs min-h-[40px] rounded px-3 py-2 text-sm"
            onclick={handleCreateBranch}
            disabled={!newBranchName.trim()}
          >
            Create
          </button>
        </div>
      </div>
    {/if}

    <!-- Recursive branch item snippet -->
    {#snippet branchItem(branch: Branch)}
      {@const children = getChildBranches(branch.id)}
      <div class="ml-4">
        <div
          class="group flex cursor-pointer items-center gap-2 rounded-lg p-2 transition-colors {isCurrent(
            branch.id,
          )
            ? 'bg-accent-500/20 border-accent-500 border-l-2'
            : 'hover:bg-surface-700/50'}"
          onclick={() => handleSwitchBranch(branch.id)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && handleSwitchBranch(branch.id)}
        >
          {#if children.length > 0}
            <button
              class="text-surface-400 hover:text-surface-200 tap-target"
              onclick={(e) => {
                e.stopPropagation()
                toggleExpand(branch.id)
              }}
            >
              {#if isExpanded(branch.id)}
                <ChevronDown class="can-hover:size-3.5 size-4" />
              {:else}
                <ChevronRight class="can-hover:size-3.5 size-4" />
              {/if}
            </button>
          {:else}
            <span class="can-hover:w-5 w-8"></span>
          {/if}
          <GitBranch class="text-surface-400 h-4 w-4" />

          {#if renamingBranchId === branch.id}
            <input
              type="text"
              class="input flex-1 px-1 py-0.5 text-sm"
              bind:value={renameValue}
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') confirmRename()
                if (e.key === 'Escape') cancelRename()
              }}
            />
            <button
              class="tap-target text-green-400 hover:text-green-300"
              onclick={(e) => {
                e.stopPropagation()
                confirmRename()
              }}
            >
              <Check class="can-hover:size-3.5 size-4" />
            </button>
            <button
              class="text-surface-400 hover:text-surface-200 tap-target"
              onclick={(e) => {
                e.stopPropagation()
                cancelRename()
              }}
            >
              <X class="can-hover:size-3.5 size-4" />
            </button>
          {:else}
            <span
              class="text-surface-200 flex-1 text-sm whitespace-nowrap"
              data-current-name={isCurrent(branch.id) || undefined}>{branch.name}</span
            >
            <span class="text-surface-500 text-xs">{getBranchEntryCount(branch.id)}</span>
            {#if isCurrent(branch.id)}
              <span class="bg-accent-500 h-2 w-2 rounded-full" title="Current branch"></span>
            {/if}
            <button
              class="text-surface-500 hover:text-surface-200 can-hover:opacity-0 tap-target transition-opacity group-hover:opacity-100"
              onclick={(e) => {
                e.stopPropagation()
                startRename(branch)
              }}
              title="Rename"
            >
              <Edit2 class="can-hover:size-3 size-4" />
            </button>
            {#if !isCurrent(branch.id)}
              <button
                class="text-surface-500 tap-target transition-opacity {children.length > 0
                  ? 'cursor-not-allowed opacity-30'
                  : 'can-hover:opacity-0 group-hover:opacity-100 hover:text-red-400'}"
                onclick={(e) => {
                  e.stopPropagation()
                  handleDeleteBranch(branch.id)
                }}
                disabled={children.length > 0}
                title={children.length > 0 ? 'Cannot delete: has child branches' : 'Delete'}
              >
                <Trash2 class="can-hover:size-3 size-4" />
              </button>
            {/if}
          {/if}
        </div>

        <!-- Recursively render children -->
        {#if isExpanded(branch.id) && children.length > 0}
          {#each children as child (child.id)}
            {@render branchItem(child)}
          {/each}
        {/if}
      </div>
    {/snippet}

    <!-- Branch Tree: scrolls sideways when deep, so names are never cut. -->
    <div bind:this={treeScroller} class="overflow-x-auto" use:keepsSidewaysSwipes>
      <div class="w-max min-w-full space-y-1">
        <!-- Main Branch -->
        <div
          class="flex cursor-pointer items-center gap-2 rounded-lg p-2 transition-colors {isCurrent(
            null,
          )
            ? 'bg-accent-500/20 border-accent-500 border-l-2'
            : 'hover:bg-surface-700/50'}"
          onclick={() => handleSwitchBranch(null)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && handleSwitchBranch(null)}
        >
          <button
            class="text-surface-400 hover:text-surface-200 tap-target"
            onclick={(e) => {
              e.stopPropagation()
              toggleExpand('main')
            }}
          >
            {#if isExpanded('main')}
              <ChevronDown class="can-hover:size-3.5 size-4" />
            {:else}
              <ChevronRight class="can-hover:size-3.5 size-4" />
            {/if}
          </button>
          <GitBranch class="text-surface-400 h-4 w-4" />
          <span
            class="text-surface-200 flex-1 text-sm"
            data-current-name={isCurrent(null) || undefined}>Main</span
          >
          <span class="text-surface-500 text-xs">{getBranchEntryCount(null)}</span>
          {#if isCurrent(null)}
            <span class="bg-accent-500 h-2 w-2 rounded-full" title="Current branch"></span>
          {/if}
        </div>

        <!-- Child branches of main (recursive) -->
        {#if isExpanded('main')}
          {#each getChildBranches(null) as branch (branch.id)}
            {@render branchItem(branch)}
          {/each}
        {/if}
      </div>
    </div>

    <!-- Empty state -->
    {#if story.branches.length === 0}
      <p class="text-surface-400 py-4 text-center text-sm">
        {#if canCreateBranch}
          No branches yet. Create one to explore alternate storylines.
        {:else}
          Branches can be created from checkpoints. Checkpoints are automatically saved at chapter
          boundaries.
        {/if}
      </p>
    {/if}
  </div>

  {#if switchingBlocked}
    <div
      class="bg-surface-900/60 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg backdrop-blur-[1px]"
    >
      <Lock class="text-surface-300 h-6 w-6" />
      <p class="text-surface-300 max-w-[18rem] px-4 text-center text-xs">
        {#if story.isGenerationLeaseForAnotherStory}
          A response in another story is still finishing. Switching a branch mid-flight is not
          available.
        {:else}
          A response is generating on this branch. Switching a branch mid-flight is not available.
        {/if}
      </p>
    </div>
  {/if}
</div>
