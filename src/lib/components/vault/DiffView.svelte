<script lang="ts">
  import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
  import type { VaultLorebookEntry } from '$lib/types'
  import { Check, X, ArrowRight, Trash2, GitMerge, Plus } from 'lucide-svelte'
  import { fade } from 'svelte/transition'

  interface Props {
    change: VaultPendingChange
    onApprove: () => void
    onReject: () => void
  }

  let { change, onApprove, onReject }: Props = $props()

  // Format entry for display
  function formatEntry(entry: VaultLorebookEntry | undefined): string {
    if (!entry) return ''
    return [
      `Name: ${entry.name}`,
      `Type: ${entry.type}`,
      `Description: ${entry.description}`,
      entry.keywords.length > 0 ? `Keywords: ${entry.keywords.join(', ')}` : null,
      entry.aliases.length > 0 ? `Aliases: ${entry.aliases.join(', ')}` : null,
      `Injection: ${entry.injectionMode}`,
      `Priority: ${entry.priority}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  // Format updates for display
  function formatUpdates(updates: Partial<VaultLorebookEntry> | undefined): string {
    if (!updates) return ''
    const lines: string[] = []
    if (updates.name !== undefined) lines.push(`Name: ${updates.name}`)
    if (updates.type !== undefined) lines.push(`Type: ${updates.type}`)
    if (updates.description !== undefined) lines.push(`Description: ${updates.description}`)
    if (updates.keywords !== undefined) lines.push(`Keywords: ${updates.keywords.join(', ')}`)
    if (updates.aliases !== undefined) lines.push(`Aliases: ${updates.aliases.join(', ')}`)
    if (updates.injectionMode !== undefined) lines.push(`Injection: ${updates.injectionMode}`)
    if (updates.priority !== undefined) lines.push(`Priority: ${updates.priority}`)
    return lines.join('\n')
  }

  // Get the merged entry with updates applied
  function getMergedView(
    previous: VaultLorebookEntry,
    updates: Partial<VaultLorebookEntry>,
  ): VaultLorebookEntry {
    return { ...previous, ...updates }
  }

  // Extract data from VaultPendingChange for lorebook-entry display
  // This component only displays lorebook-entry changes
  const entryData = $derived(
    change.entityType === 'lorebook-entry' && change.action === 'create'
      ? (change.data as VaultLorebookEntry)
      : undefined,
  )
  const updateData = $derived(
    change.entityType === 'lorebook-entry' && change.action === 'update'
      ? (change.data as Partial<VaultLorebookEntry>)
      : undefined,
  )
  const previousEntry = $derived(
    change.entityType === 'lorebook-entry' &&
      (change.action === 'update' || change.action === 'delete')
      ? (change.previous as VaultLorebookEntry | undefined)
      : undefined,
  )
  const mergeData = $derived(
    change.entityType === 'lorebook-entry' && change.action === 'merge'
      ? (change.data as VaultLorebookEntry)
      : undefined,
  )
  const previousEntries = $derived(
    change.entityType === 'lorebook-entry' && change.action === 'merge'
      ? (change.previousEntries as VaultLorebookEntry[] | undefined)
      : undefined,
  )
</script>

<div
  class="border-surface-600 bg-surface-800 overflow-hidden rounded-lg border"
  in:fade={{ duration: 150 }}
>
  <!-- Header -->
  <div
    class="bg-surface-700 border-surface-600 flex flex-col justify-between gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:px-4"
  >
    <div class="flex items-center gap-2">
      {#if change.action === 'create'}
        <Plus class="h-4 w-4 text-green-400" />
        <span class="text-sm font-medium text-green-400">Create Entry</span>
      {:else if change.action === 'update'}
        <ArrowRight class="h-4 w-4 text-blue-400" />
        <span class="text-sm font-medium text-blue-400">Update Entry</span>
      {:else if change.action === 'delete'}
        <Trash2 class="h-4 w-4 text-red-400" />
        <span class="text-sm font-medium text-red-400">Delete Entry</span>
      {:else if change.action === 'merge'}
        <GitMerge class="h-4 w-4 text-purple-400" />
        <span class="text-sm font-medium text-purple-400">Merge Entries</span>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500/20 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 active:bg-red-500/40 sm:flex-none sm:py-1.5"
        onclick={onReject}
      >
        <X class="h-4 w-4" />
        Reject
      </button>
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-green-500/20 px-3 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/30 active:bg-green-500/40 sm:flex-none sm:py-1.5"
        onclick={onApprove}
      >
        <Check class="h-4 w-4" />
        Approve
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="p-3 sm:p-4">
    {#if change.action === 'create'}
      <!-- Create: Show new entry -->
      <div class="rounded-md border border-green-500/30 bg-green-500/10 p-3">
        <div class="mb-2 text-xs font-medium text-green-400">New Entry</div>
        <pre class="text-surface-200 font-mono text-sm whitespace-pre-wrap">{formatEntry(
            entryData,
          )}</pre>
      </div>
    {:else if change.action === 'update'}
      <!-- Update: Stacked on mobile, side-by-side on desktop -->
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <!-- Old (Previous) -->
        <div class="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <div class="mb-2 text-xs font-medium text-red-400">Before</div>
          <pre class="text-surface-300 font-mono text-sm whitespace-pre-wrap">{formatEntry(
              previousEntry,
            )}</pre>
        </div>

        <!-- New (With updates applied) -->
        <div class="rounded-md border border-green-500/30 bg-green-500/10 p-3">
          <div class="mb-2 text-xs font-medium text-green-400">After</div>
          {#if previousEntry && updateData}
            <pre class="text-surface-200 font-mono text-sm whitespace-pre-wrap">{formatEntry(
                getMergedView(previousEntry, updateData),
              )}</pre>
          {/if}
        </div>
      </div>

      <!-- Changes summary -->
      <div class="mt-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3">
        <div class="mb-2 text-xs font-medium text-blue-400">Changes</div>
        <pre class="text-surface-200 font-mono text-sm whitespace-pre-wrap">{formatUpdates(
            updateData,
          )}</pre>
      </div>
    {:else if change.action === 'delete'}
      <!-- Delete: Show entry being removed -->
      <div class="rounded-md border border-red-500/30 bg-red-500/10 p-3">
        <div class="mb-2 text-xs font-medium text-red-400">Entry to Delete</div>
        <pre
          class="text-surface-300 font-mono text-sm whitespace-pre-wrap line-through opacity-70">{formatEntry(
            previousEntry,
          )}</pre>
      </div>
    {:else if change.action === 'merge'}
      <!-- Merge: Show source entries and result -->
      <div class="space-y-4">
        <!-- Source entries -->
        <div class="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <div class="mb-2 text-xs font-medium text-red-400">
            Entries to Merge ({previousEntries?.length ?? 0})
          </div>
          <div class="space-y-2">
            {#each previousEntries ?? [] as entry, i (i)}
              <div class="bg-surface-700 rounded p-2">
                <div class="text-surface-400 mb-1 text-xs">Entry {i + 1}: {entry.name}</div>
                <pre class="text-surface-300 font-mono text-sm whitespace-pre-wrap">{formatEntry(
                    entry,
                  )}</pre>
              </div>
            {/each}
          </div>
        </div>

        <!-- Arrow -->
        <div class="flex justify-center">
          <ArrowRight class="h-5 w-5 rotate-90 text-purple-400" />
        </div>

        <!-- Merged result -->
        <div class="rounded-md border border-green-500/30 bg-green-500/10 p-3">
          <div class="mb-2 text-xs font-medium text-green-400">Merged Entry</div>
          <pre class="text-surface-200 font-mono text-sm whitespace-pre-wrap">{formatEntry(
              mergeData,
            )}</pre>
        </div>
      </div>
    {/if}
  </div>
</div>
