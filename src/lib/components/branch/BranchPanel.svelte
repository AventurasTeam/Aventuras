<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
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
  } from 'lucide-svelte'
  import type { Branch, Checkpoint } from '$lib/types'
  import { SvelteSet } from 'svelte/reactivity'

  // Track expanded branches in tree view
  let expandedBranches = $state<Set<string>>(new Set(['main']))

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

  async function handleSwitchBranch(branchId: string | null) {
    try {
      await story.switchBranch(branchId)
    } catch (error) {
      console.error('Failed to switch branch:', error)
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

  // Get the most recent checkpoint for branching
  function getCheckpointBranchId(checkpoint: Checkpoint): string | null {
    const lastEntry = checkpoint.entriesSnapshot.find((e) => e.id === checkpoint.lastEntryId)
    return lastEntry?.branchId ?? null
  }

  function getLatestCheckpoint() {
    if (story.checkpoints.length === 0) return null
    const currentBranchId = story.currentStory?.currentBranchId ?? null
    const eligible = story.checkpoints.filter(
      (checkpoint) => getCheckpointBranchId(checkpoint) === currentBranchId,
    )
    if (eligible.length === 0) return null
    // Sort by createdAt descending and return the most recent
    const sorted = [...eligible].sort((a, b) => b.createdAt - a.createdAt)
    return sorted[0]
  }

  const latestCheckpoint = $derived(getLatestCheckpoint())
  const canCreateBranch = $derived(!!latestCheckpoint)

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
</script>

<div class="space-y-3">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h3 class="text-surface-200 font-medium">Branches</h3>
    <button
      class="btn-ghost flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-2 sm:min-h-0 sm:min-w-0 sm:p-1.5 {canCreateBranch
        ? 'text-surface-400 hover:text-surface-200'
        : 'text-surface-600 cursor-not-allowed'}"
      onclick={() => canCreateBranch && (showCreateForm = !showCreateForm)}
      disabled={!canCreateBranch}
      title={canCreateBranch
        ? 'Create new branch from latest checkpoint'
        : 'No checkpoints available - checkpoints are created at chapter boundaries'}
    >
      <Plus class="h-5 w-5 sm:h-4 sm:w-4" />
    </button>
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
          class="btn-ghost min-h-[40px] rounded px-3 py-2 text-sm sm:min-h-0 sm:px-2 sm:py-1 sm:text-xs"
          onclick={() => {
            showCreateForm = false
            newBranchName = ''
          }}
        >
          Cancel
        </button>
        <button
          class="btn-primary min-h-[40px] rounded px-3 py-2 text-sm sm:min-h-0 sm:px-2 sm:py-1 sm:text-xs"
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
            class="text-surface-400 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
            onclick={(e) => {
              e.stopPropagation()
              toggleExpand(branch.id)
            }}
          >
            {#if isExpanded(branch.id)}
              <ChevronDown class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            {:else}
              <ChevronRight class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
            {/if}
          </button>
        {:else}
          <span class="w-8 sm:w-5"></span>
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
            class="flex min-h-[32px] min-w-[32px] items-center justify-center p-1 text-green-400 hover:text-green-300 sm:min-h-0 sm:min-w-0 sm:p-0.5"
            onclick={(e) => {
              e.stopPropagation()
              confirmRename()
            }}
          >
            <Check class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
          <button
            class="text-surface-400 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
            onclick={(e) => {
              e.stopPropagation()
              cancelRename()
            }}
          >
            <X class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        {:else}
          <span class="text-surface-200 flex-1 truncate text-sm">{branch.name}</span>
          <span class="text-surface-500 text-xs">{getBranchEntryCount(branch.id)}</span>
          {#if isCurrent(branch.id)}
            <span class="bg-accent-500 h-2 w-2 rounded-full" title="Current branch"></span>
          {/if}
          <button
            class="text-surface-500 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 transition-opacity sm:min-h-0 sm:min-w-0 sm:p-0.5 sm:opacity-0 sm:group-hover:opacity-100"
            onclick={(e) => {
              e.stopPropagation()
              startRename(branch)
            }}
            title="Rename"
          >
            <Edit2 class="h-4 w-4 sm:h-3 sm:w-3" />
          </button>
          {#if !isCurrent(branch.id)}
            <button
              class="text-surface-500 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 transition-opacity sm:min-h-0 sm:min-w-0 sm:p-0.5 {children.length >
              0
                ? 'cursor-not-allowed opacity-30'
                : 'hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100'}"
              onclick={(e) => {
                e.stopPropagation()
                handleDeleteBranch(branch.id)
              }}
              disabled={children.length > 0}
              title={children.length > 0 ? 'Cannot delete: has child branches' : 'Delete'}
            >
              <Trash2 class="h-4 w-4 sm:h-3 sm:w-3" />
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

  <!-- Branch Tree -->
  <div class="space-y-1">
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
        class="text-surface-400 hover:text-surface-200 flex min-h-[32px] min-w-[32px] items-center justify-center p-1 sm:min-h-0 sm:min-w-0 sm:p-0.5"
        onclick={(e) => {
          e.stopPropagation()
          toggleExpand('main')
        }}
      >
        {#if isExpanded('main')}
          <ChevronDown class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        {:else}
          <ChevronRight class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        {/if}
      </button>
      <GitBranch class="text-surface-400 h-4 w-4" />
      <span class="text-surface-200 flex-1 text-sm">Main</span>
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
