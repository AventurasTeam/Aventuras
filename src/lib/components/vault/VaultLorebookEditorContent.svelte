<script lang="ts">
  import type { VaultLorebook, VaultLorebookEntry, EntryType } from '$lib/types'
  import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
  import type { FocusedEntity } from '$lib/services/ai/vault/InteractiveVaultService'
  import {
    X,
    Plus,
    Search,
    Trash2,
    Save,
    ArrowLeft,
    List,
    Users,
    MapPin,
    Box,
    Flag,
    Brain,
    Calendar,
    EyeOff,
    Settings,
    Check,
    Pencil,
    GitMerge,
    Bot,
  } from 'lucide-svelte'
  import TagInput from '$lib/components/tags/TagInput.svelte'
  import VaultLorebookEntryFields from './VaultLorebookEntryFields.svelte'
  import VaultPendingOperations, { type PendingOperation } from './VaultPendingOperations.svelte'

  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import * as Tabs from '$lib/components/ui/tabs'
  import { cn } from '$lib/utils/cn'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

  interface Props {
    lorebook: VaultLorebook
    onSave: (updatedLorebook: VaultLorebook) => Promise<void> | void
    onSaveAndClose?: (updatedLorebook: VaultLorebook) => Promise<void> | void
    onClose: () => void
    initialEntryIndex?: number | null
    isEmbedded?: boolean
    isPendingApproval?: boolean
    onApprove?: () => void
    pendingEntries?: VaultPendingChange[]
    onApproveEntry?: (change: VaultPendingChange) => void
    onRejectEntry?: (change: VaultPendingChange) => void
    onUpdatePendingChange?: (change: VaultPendingChange, newData: VaultLorebookEntry) => void
    onOpenAssistant?: (entity: FocusedEntity) => void
  }

  let {
    lorebook,
    onSave,
    onSaveAndClose,
    onClose,
    initialEntryIndex = null,
    isEmbedded = false,
    isPendingApproval = false,
    pendingEntries = [],
    onApproveEntry,
    onRejectEntry,
    onUpdatePendingChange,
    onOpenAssistant,
  }: Props = $props()

  // Local state for editing - initialized from props but mutable
  let name = $derived(lorebook.name)
  let description = $derived(lorebook.description ?? '')
  let tags = $derived<string[]>([...lorebook.tags])
  // svelte-ignore state_referenced_locally
  let entries = $state<VaultLorebookEntry[]>(JSON.parse(JSON.stringify(lorebook.entries))) // Deep copy — $state so manual adds persist

  // New-entry draft: not in entries[] until user clicks Save
  let newEntryDraft = $state<VaultLorebookEntry | null>(null)

  // Track locally deleted entry names so the sync effect won't re-add them
  let locallyDeleted = $state<Set<string>>(new Set())

  // Inline delete confirmation
  let confirmingDeleteIndex = $state<number | null>(null)

  // Sync entries from the lorebook prop when vault updates add or remove entries
  // (e.g. after pending creates are approved and saved, or deletes are applied).
  // Only needed in embedded mode where the AI can add entries concurrently.
  $effect(() => {
    if (!isEmbedded) return

    const localNames = new Set(entries.map((e) => e.name))

    // Only add entries that are new in the prop and not locally deleted
    const newFromVault = lorebook.entries.filter(
      (e) => !localNames.has(e.name) && !locallyDeleted.has(e.name),
    )

    if (newFromVault.length > 0) {
      entries = [...entries, ...newFromVault.map((e) => JSON.parse(JSON.stringify(e)))]
    }
  })

  // UI State
  let searchQuery = $state('')
  // -1 = new entry draft, null = nothing selected, >=0 = existing entry
  // svelte-ignore state_referenced_locally
  let selectedIndex = $state<number | null>(initialEntryIndex)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let activeTab = $derived(isPendingApproval && entries.length === 0 ? 'settings' : 'editor')

  // Dirty tracking & save feedback
  let settingsDirty = $state(false)
  let entriesDirty = $state(false)
  let savedFeedback = $state<'settings' | 'entry' | null>(null)
  let savedFeedbackTimer: ReturnType<typeof setTimeout> | null = null

  function showSavedFeedback(type: 'settings' | 'entry') {
    savedFeedback = type
    if (savedFeedbackTimer) clearTimeout(savedFeedbackTimer)
    savedFeedbackTimer = setTimeout(() => {
      savedFeedback = null
    }, 2000)
  }

  // Sync settings when prop changes (one-way binding from parent)
  // Note: we intentionally do NOT re-sync `entries` here — manual entries would be lost.
  $effect(() => {
    name = lorebook.name
    description = lorebook.description ?? ''
    tags = [...lorebook.tags]
    settingsDirty = false
  })

  // Filtered entries (Combines existing + pending, overlays edits/deletes on existing entries)
  type CombinedEntry = {
    entry: VaultLorebookEntry
    index: number
    isPending: boolean
    pendingChange: import('$lib/services/ai/sdk/schemas/vault').VaultPendingChange | null
    pendingAction?: 'create' | 'edit' | 'delete' | 'merge-source' | 'merge-result'
  }

  const combinedEntries = $derived.by((): CombinedEntry[] => {
    // Build a map of pending changes that target existing entries (by entryIndex)
    const editMap = new SvelteMap<number, VaultPendingChange>()
    const deleteMap = new SvelteMap<number, VaultPendingChange>()
    const creates: VaultPendingChange[] = []
    const mergeDeletedIndices = new SvelteSet<number>()
    const mergeCreates: VaultPendingChange[] = []

    for (const change of pendingEntries) {
      if (change.entityType !== 'lorebook-entry') continue
      if (change.status !== 'pending') continue
      switch (change.action) {
        case 'create':
          creates.push(change)
          break
        case 'update':
          if ('entryIndex' in change && typeof change.entryIndex === 'number') {
            editMap.set(change.entryIndex, change)
          }
          break
        case 'delete':
          if ('entryIndex' in change && typeof change.entryIndex === 'number') {
            deleteMap.set(change.entryIndex, change)
          }
          break
        case 'merge':
          if ('entryIndices' in change && Array.isArray(change.entryIndices)) {
            for (const idx of change.entryIndices) {
              mergeDeletedIndices.add(idx)
              deleteMap.set(idx, change)
            }
          }
          mergeCreates.push(change)
          break
      }
    }

    // Regular entries with overlaid pending state
    const regular: CombinedEntry[] = entries.map((e, i) => {
      if (mergeDeletedIndices.has(i)) {
        return {
          entry: e,
          index: i,
          isPending: true,
          pendingChange: deleteMap.get(i) ?? null,
          pendingAction: 'merge-source' as const,
        }
      }
      if (deleteMap.has(i)) {
        return {
          entry: e,
          index: i,
          isPending: true,
          pendingChange: deleteMap.get(i) ?? null,
          pendingAction: 'delete' as const,
        }
      }
      if (editMap.has(i)) {
        return {
          entry: e,
          index: i,
          isPending: true,
          pendingChange: editMap.get(i)!,
          pendingAction: 'edit' as const,
        }
      }
      return {
        entry: e,
        index: i,
        isPending: false,
        pendingChange: null,
      }
    })

    // New entries (creates + merge results)
    const newEntries: CombinedEntry[] = []
    for (let i = 0; i < creates.length; i++) {
      const change = creates[i]
      const data = 'data' in change ? (change.data as VaultLorebookEntry) : null
      if (data) {
        newEntries.push({
          entry: data,
          index: -100 - i,
          isPending: true,
          pendingChange: change,
          pendingAction: 'create',
        })
      }
    }
    for (let i = 0; i < mergeCreates.length; i++) {
      const change = mergeCreates[i]
      const data = 'data' in change ? (change.data as VaultLorebookEntry) : null
      if (data) {
        newEntries.push({
          entry: data,
          index: -100 - creates.length - i,
          isPending: true,
          pendingChange: change,
          pendingAction: 'merge-result',
        })
      }
    }

    const all = [...regular, ...newEntries]

    if (!searchQuery.trim()) return all

    const q = searchQuery.toLowerCase()
    return all.filter(
      ({ entry }) =>
        entry.name.toLowerCase().includes(q) ||
        (entry.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false),
    )
  })

  // Build grouped pending operations for the banner
  let selectedOperationId = $state<string | null>(null)

  const pendingOperations = $derived.by((): PendingOperation[] => {
    const ops: PendingOperation[] = []
    const seenMergeIds = new SvelteSet<string>()

    for (const combined of combinedEntries) {
      if (!combined.isPending || !combined.pendingChange) continue
      const change = combined.pendingChange
      const changeId = change.id

      if (combined.pendingAction === 'merge-source' || combined.pendingAction === 'merge-result') {
        if (seenMergeIds.has(changeId)) continue
        seenMergeIds.add(changeId)

        // Gather all sources and the result for this merge
        const sources = combinedEntries.filter(
          (c) => c.pendingAction === 'merge-source' && c.pendingChange?.id === changeId,
        )
        const result = combinedEntries.find(
          (c) => c.pendingAction === 'merge-result' && c.pendingChange?.id === changeId,
        )

        const sourceNames = sources.map((s) => s.entry.name)
        const resultName = result?.entry.name ?? 'Merged Entry'
        const summary = `${sourceNames.join(' + ')} → ${resultName}`

        ops.push({
          id: changeId,
          type: 'merge',
          summary,
          primaryChange: change,
          relatedChanges: [change],
          sourceNames,
          resultName,
        })
      } else if (combined.pendingAction === 'create') {
        ops.push({
          id: changeId,
          type: 'create',
          summary: combined.entry.name || 'New Entry',
          primaryChange: change,
          relatedChanges: [change],
          entryName: combined.entry.name,
        })
      } else if (combined.pendingAction === 'edit') {
        ops.push({
          id: changeId,
          type: 'edit',
          summary: combined.entry.name,
          primaryChange: change,
          relatedChanges: [change],
          entryName: combined.entry.name,
        })
      } else if (combined.pendingAction === 'delete') {
        ops.push({
          id: changeId,
          type: 'delete',
          summary: combined.entry.name,
          primaryChange: change,
          relatedChanges: [change],
          entryName: combined.entry.name,
        })
      }
    }

    return ops
  })

  // Ensure selectedIndex is valid when entries change
  // Note: negative indices (< 0) are valid — they encode pending entries (-100 - i)
  // -1 is reserved for the new entry draft
  $effect(() => {
    if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex >= entries.length) {
      selectedIndex = null
    }
  })

  const selectedEntry = $derived.by((): VaultLorebookEntry | null => {
    if (selectedIndex === null) return null

    // New entry draft
    if (selectedIndex === -1) return newEntryDraft

    // Find the matching combined entry to get merged/overlaid data
    const combined = combinedEntries.find((c) => c.index === selectedIndex)
    if (!combined) return null

    // For edits: merge partial update data onto the full existing entry
    if (combined.pendingAction === 'edit' && combined.pendingChange) {
      const updateData =
        'data' in combined.pendingChange
          ? (combined.pendingChange.data as Partial<VaultLorebookEntry>)
          : {}
      return { ...combined.entry, ...updateData }
    }

    return combined.entry
  })

  const selectedCombined = $derived.by(() => {
    if (selectedIndex === null || selectedIndex === -1) return null
    return combinedEntries.find((c) => c.index === selectedIndex) ?? null
  })

  const selectedPendingChange = $derived(selectedCombined?.pendingChange ?? null)
  const selectedPendingAction = $derived(selectedCombined?.pendingAction ?? null)

  // Compute changed fields for pending entry updates
  const entryChangedFields = $derived.by(() => {
    if (!selectedPendingChange || selectedPendingChange.action !== 'update') return undefined
    if (!('previous' in selectedPendingChange) || !selectedPendingChange.previous) return undefined
    if (!('data' in selectedPendingChange)) return undefined
    const changed = new SvelteSet<string>()
    const prev = selectedPendingChange.previous as Record<string, unknown>
    const cur = selectedPendingChange.data as Record<string, unknown>
    for (const key of Object.keys(cur)) {
      const oldVal = JSON.stringify(prev[key] ?? '')
      const newVal = JSON.stringify(cur[key] ?? '')
      if (oldVal !== newVal) changed.add(key)
    }
    return changed.size > 0 ? changed : undefined
  })

  const typeIcons: Record<EntryType, any> = {
    character: Users,
    location: MapPin,
    item: Box,
    faction: Flag,
    concept: Brain,
    event: Calendar,
  }

  async function handleSaveClick(
    saveHandler: (updatedLorebook: VaultLorebook) => Promise<void> | void = onSave,
  ) {
    if (!name.trim()) {
      error = 'Lorebook name is required'
      return
    }

    saving = true
    error = null

    try {
      // Update metadata entry breakdown
      const breakdown: Record<EntryType, number> = {
        character: 0,
        location: 0,
        item: 0,
        faction: 0,
        concept: 0,
        event: 0,
      }
      entries.forEach((e) => {
        if (breakdown[e.type] !== undefined) breakdown[e.type]++
      })

      const updatedLorebook: VaultLorebook = {
        ...lorebook,
        name,
        description: description || null,
        entries,
        tags,
        metadata: {
          ...lorebook.metadata,
          format: lorebook.metadata?.format ?? 'aventura',
          totalEntries: entries.length,
          entryBreakdown: breakdown,
        },
      }

      await saveHandler(updatedLorebook)
      saving = false
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to save lorebook'
      saving = false
    }
  }

  function handleAddEntry() {
    newEntryDraft = {
      name: '',
      type: 'character',
      description: '',
      keywords: [],
      aliases: [],
      injectionMode: 'keyword',
      priority: 10,
    }
    selectedIndex = -1
    activeTab = 'editor'
    searchQuery = ''
    confirmingDeleteIndex = null
  }

  function handleSaveNewEntry() {
    if (!newEntryDraft) return
    if (!newEntryDraft.name.trim()) {
      error = 'Entry name is required'
      return
    }
    entries = [...entries, newEntryDraft]
    selectedIndex = entries.length - 1
    newEntryDraft = null
    entriesDirty = true
    if (isEmbedded) handleSaveClick()
  }

  function handleDeleteEntry(index: number) {
    if (index < 0 || index >= entries.length) return
    const deletedName = entries[index].name
    locallyDeleted = new Set([...locallyDeleted, deletedName])
    entries.splice(index, 1)
    entries = [...entries]
    entriesDirty = true
    confirmingDeleteIndex = null
    if (selectedIndex === index) {
      selectedIndex = null
    } else if (selectedIndex !== null && selectedIndex > index) {
      selectedIndex--
    }
    if (isEmbedded) handleSaveClick()
  }

  function handleDuplicateEntry(index: number) {
    const entry = entries[index]
    const newEntry = JSON.parse(JSON.stringify(entry))
    newEntry.name = `${newEntry.name} (Copy)`
    entries.push(newEntry)
    entries = [...entries]
    selectedIndex = entries.length - 1
  }

  /** Approve a pending entry change and optimistically update local state */
  function handleApproveEntry(change: VaultPendingChange) {
    if (!onApproveEntry) return

    if (change.entityType === 'lorebook-entry') {
      switch (change.action) {
        case 'update': {
          const idx = change.entryIndex
          if (idx >= 0 && idx < entries.length) {
            entries[idx] = { ...entries[idx], ...(change.data as Partial<VaultLorebookEntry>) }
            entries = [...entries]
          }
          break
        }
        case 'delete': {
          const idx = change.entryIndex
          if (idx >= 0 && idx < entries.length) {
            const deletedName = entries[idx].name
            locallyDeleted = new Set([...locallyDeleted, deletedName])
            entries.splice(idx, 1)
            entries = [...entries]
            if (selectedIndex === idx) selectedIndex = null
            else if (selectedIndex !== null && selectedIndex > idx) selectedIndex--
          }
          break
        }
        case 'merge': {
          if (change.entryIndices) {
            // Remove source entries (descending order to preserve indices)
            const sorted = [...change.entryIndices].sort((a, b) => b - a)
            for (const idx of sorted) {
              if (idx >= 0 && idx < entries.length) {
                locallyDeleted = new Set([...locallyDeleted, entries[idx].name])
                entries.splice(idx, 1)
              }
            }
            // Add the merged result entry to the local list
            if ('data' in change && change.data) {
              entries = [...entries, change.data as VaultLorebookEntry]
              selectedIndex = entries.length - 1
            } else {
              entries = [...entries]
              selectedIndex = null
            }
          }
          break
        }
      }
    }

    onApproveEntry(change)
  }

  /** Select an operation from the banner — select the merge result or the relevant entry */
  function handleSelectOperation(op: PendingOperation) {
    selectedOperationId = op.id
    newEntryDraft = null
    confirmingDeleteIndex = null

    if (op.type === 'merge') {
      // Select the merge result entry to show its content
      const result = combinedEntries.find(
        (c) => c.pendingAction === 'merge-result' && c.pendingChange?.id === op.id,
      )
      if (result) {
        selectedIndex = result.index
      }
    } else {
      // For create/edit/delete, find the entry matching this change
      const match = combinedEntries.find((c) => c.pendingChange?.id === op.id)
      if (match) {
        selectedIndex = match.index
      }
    }
  }

  /** Approve an operation from the banner */
  function handleApproveOperation(op: PendingOperation) {
    if (!onApproveEntry) return
    selectedOperationId = null
    handleApproveEntry(op.primaryChange)
  }

  /** Reject an operation from the banner */
  function handleRejectOperation(op: PendingOperation) {
    if (!onRejectEntry) return
    selectedOperationId = null
    onRejectEntry(op.primaryChange)
    // Deselect if the rejected entry was selected
    if (selectedIndex !== null) {
      const match = combinedEntries.find((c) => c.pendingChange?.id === op.id)
      if (match && match.index === selectedIndex) {
        selectedIndex = null
      }
    }
  }

  /** Approve all pending operations — snapshot first to avoid index-shifting bugs */
  function handleApproveAll() {
    if (!onApproveEntry) return
    selectedOperationId = null
    // Snapshot: handleApproveEntry mutates entries[] which shifts indices,
    // so we collect all changes first and delegate to parent without optimistic splicing
    const changes = [...pendingOperations].map((op) => op.primaryChange)
    for (const change of changes) {
      onApproveEntry(change)
    }
  }
</script>

<div class="bg-surface-900 flex h-full w-full flex-col overflow-hidden">
  <!-- Header -->
  {#if !isEmbedded}
    <div
      class="border-surface-700 bg-surface-900 relative flex flex-shrink-0 items-center justify-center border-b px-6 py-3"
    >
      <h2 class="text-surface-100 text-sm font-semibold tracking-tight">Edit Lorebook</h2>
      {#if error}
        <div
          class="absolute top-full left-0 w-full border-b border-red-500/20 bg-red-500/8 py-1 text-center text-xs text-red-400 backdrop-blur"
        >
          {error}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Embedded header with close button -->
    <div
      class="border-surface-700 bg-surface-900 flex flex-shrink-0 items-center justify-between border-b px-4 py-2"
    >
      <div class="flex items-center gap-2">
        <div class="flex h-6 w-6 items-center justify-center rounded-md bg-cyan-500/15">
          <List class="h-3 w-3 text-cyan-400" />
        </div>
        <span class="text-surface-200 text-xs font-semibold">Lorebook Editor</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="text-surface-400 hover:text-foreground h-6 w-6"
        onclick={onClose}
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>
    {#if error}
      <div
        class="w-full border-b border-red-500/20 bg-red-500/8 py-1 text-center text-xs text-red-400"
      >
        {error}
      </div>
    {/if}
  {/if}

  <Tabs.Root bind:value={activeTab} class="flex flex-1 flex-col overflow-hidden">
    <div
      class="border-surface-700 bg-surface-800 flex shrink-0 items-center justify-between border-b"
    >
      <Tabs.List class="h-10 justify-start bg-transparent p-0">
        <Tabs.Trigger
          value="editor"
          class="data-[state=active]:border-accent-500 data-[state=active]:text-foreground h-full rounded-none px-3.5 text-xs data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <List class="mr-1.5 h-3.5 w-3.5" />
          Entries ({entries.length})
        </Tabs.Trigger>
        <Tabs.Trigger
          value="settings"
          class="data-[state=active]:border-accent-500 data-[state=active]:text-foreground h-full rounded-none px-3.5 text-xs data-[state=active]:border-b-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
        >
          <Settings class="mr-1.5 h-3.5 w-3.5" />
          Settings
        </Tabs.Trigger>
      </Tabs.List>
    </div>

    <!-- Main Content Area -->
    <div class="bg-surface-900 relative flex flex-1 overflow-hidden">
      <!-- Tab Contents Wrapper -->
      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Tabs.Content value="settings" class="m-0 flex-1 overflow-y-auto p-6">
          <div class="mx-auto max-w-2xl space-y-6">
            <div class="space-y-4">
              <div class="space-y-2">
                <Label for="name">Lorebook Name</Label>
                <Input
                  id="name"
                  bind:value={name}
                  oninput={() => (settingsDirty = true)}
                  placeholder="Lorebook Name"
                />
              </div>

              <div class="space-y-2">
                <Label for="description">Description</Label>
                <Textarea
                  id="description"
                  bind:value={description}
                  oninput={() => (settingsDirty = true)}
                  rows={4}
                  placeholder="Describe what this lorebook contains..."
                  class="resize-none"
                />
              </div>

              <div class="space-y-2">
                <Label>Tags</Label>
                <TagInput
                  value={tags}
                  type="lorebook"
                  onChange={(newTags) => {
                    tags = newTags
                    settingsDirty = true
                  }}
                  placeholder="Add tags..."
                />
              </div>

              <div class="border-surface-700 bg-surface-800 rounded-xl border p-4">
                <h4 class="text-surface-300 mb-3 text-xs font-semibold">Statistics</h4>
                <div class="grid grid-cols-2 gap-3 text-xs">
                  <div
                    class="border-surface-700 bg-surface-900 flex justify-between rounded-lg border p-2.5"
                  >
                    <span class="text-surface-400">Total Entries</span>
                    <span class="text-surface-200 font-semibold">{entries.length}</span>
                  </div>
                  <div
                    class="border-surface-700 bg-surface-900 flex justify-between rounded-lg border p-2.5"
                  >
                    <span class="text-surface-400">Active Entries</span>
                    <span class="text-surface-200 font-semibold"
                      >{entries.filter((e) => e.injectionMode !== 'never').length}</span
                    >
                  </div>
                </div>
              </div>

              <!-- Inline save/approve for embedded mode (settings only) -->
              {#if isEmbedded && (settingsDirty || savedFeedback === 'settings')}
                <Button
                  class={cn(
                    'w-full gap-1.5',
                    savedFeedback === 'settings' &&
                      'bg-emerald-600 text-white hover:bg-emerald-700',
                  )}
                  onclick={() => {
                    handleSaveClick()
                    settingsDirty = false
                    showSavedFeedback('settings')
                  }}
                  disabled={saving || !name.trim() || savedFeedback === 'settings'}
                >
                  {#if savedFeedback === 'settings'}
                    <Check class="h-4 w-4" />
                    Saved
                  {:else if saving}
                    <div
                      class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                    ></div>
                    Saving...
                  {:else}
                    <Save class="h-4 w-4" />
                    Save Settings
                  {/if}
                </Button>
              {/if}
            </div>
          </div>
        </Tabs.Content>

        <Tabs.Content
          value="editor"
          class={cn(
            'm-0 flex h-full flex-1 flex-col overflow-hidden',
            // If embedded, we might want a different layout, but for now stick to responsive
            'sm:flex-row',
          )}
        >
          <!-- Sidebar (List) -->
          <div
            class={cn(
              'sm:border-border sm:bg-foreground/[0.03] flex w-full flex-col sm:w-72 sm:border-r',
              selectedIndex !== null && 'hidden sm:flex',
            )}
          >
            <div class="border-surface-700 space-y-2 border-b p-3">
              <div class="relative">
                <Input
                  bind:value={searchQuery}
                  placeholder="Search entries..."
                  class="border-surface-700 bg-surface-800 placeholder:text-surface-500 h-8 rounded-lg pl-9 text-xs"
                  leftIcon={Search}
                />
              </div>
              <Button class="h-8 w-full rounded-lg text-xs" onclick={handleAddEntry}>
                <Plus class="h-3.5 w-3.5" /> Add Entry
              </Button>
            </div>

            <!-- Pending Operations Banner -->
            <VaultPendingOperations
              operations={pendingOperations}
              {selectedOperationId}
              onSelectOperation={handleSelectOperation}
              onApproveOperation={handleApproveOperation}
              onRejectOperation={handleRejectOperation}
              onApproveAll={handleApproveAll}
            />

            <div class="flex flex-1 flex-col space-y-0.5 overflow-y-auto p-1.5">
              {#if combinedEntries.length === 0}
                <div
                  class="text-surface-500 flex min-h-[200px] flex-1 flex-col items-center justify-center text-center text-xs"
                >
                  {#if searchQuery}
                    No matches found
                  {:else}
                    No entries yet
                  {/if}
                </div>
              {:else}
                {#each combinedEntries as { entry, index, isPending, pendingChange, pendingAction } (isPending ? `pending-${pendingChange?.id ?? 'x'}-${index}` : index)}
                  {@const Icon = typeIcons[entry.type]}
                  {@const isBeingRemoved =
                    pendingAction === 'delete' || pendingAction === 'merge-source'}
                  <button
                    class={cn(
                      'hover:bg-foreground/5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      selectedIndex === index &&
                        'bg-accent-500/10 text-accent-foreground ring-accent-500/20 ring-1',
                      pendingAction === 'edit' && 'border-l-2 border-l-blue-500/30',
                      pendingAction === 'delete' && 'border-l-2 border-l-red-500/30',
                      pendingAction === 'create' && 'border-l-2 border-l-emerald-500/30',
                      pendingAction === 'merge-source' && 'border-l-2 border-l-amber-500/30',
                      pendingAction === 'merge-result' && 'border-l-2 border-l-amber-500/30',
                      isBeingRemoved && 'opacity-45',
                    )}
                    onclick={() => {
                      selectedIndex = index
                      newEntryDraft = null
                      confirmingDeleteIndex = null
                      if (isPending && pendingChange) {
                        selectedOperationId = pendingChange.id
                      } else {
                        selectedOperationId = null
                      }
                    }}
                  >
                    <div
                      class={cn(
                        'border-surface-700 bg-surface-800 flex h-7 w-7 items-center justify-center rounded-lg border',
                        selectedIndex === index && 'border-accent-500/20 bg-accent-500/10',
                        pendingAction === 'edit' && 'border-blue-500/30 text-blue-400',
                        pendingAction === 'delete' && 'border-red-500/30 text-red-400',
                        pendingAction === 'create' && 'border-emerald-500/30 text-emerald-400',
                        (pendingAction === 'merge-source' || pendingAction === 'merge-result') &&
                          'border-amber-500/30 text-amber-400',
                      )}
                    >
                      {#if pendingAction === 'merge-source'}
                        <GitMerge class="h-3.5 w-3.5 text-amber-500/70" />
                      {:else if pendingAction === 'merge-result'}
                        <GitMerge class="h-3.5 w-3.5 text-amber-500/70" />
                      {:else}
                        <Icon class="h-3.5 w-3.5" />
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5 text-xs font-medium">
                        <span class={cn('truncate', isBeingRemoved && 'line-through')}
                          >{entry.name}</span
                        >
                        {#if pendingAction === 'edit'}
                          <span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                          ></span>
                        {:else if pendingAction === 'delete'}
                          <span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"></span>
                        {:else if pendingAction === 'create'}
                          <span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          ></span>
                        {:else if pendingAction === 'merge-source' || pendingAction === 'merge-result'}
                          <span class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                          ></span>
                        {/if}
                      </div>
                      <div class="text-surface-500 flex items-center gap-1.5 text-[10px]">
                        <span class="capitalize">{entry.type}</span>
                        {#if entry.injectionMode === 'never'}
                          <span class="ml-auto flex items-center gap-0.5">
                            <EyeOff class="h-2.5 w-2.5" />
                          </span>
                        {/if}
                      </div>
                    </div>
                  </button>
                {/each}
              {/if}
            </div>
          </div>

          <!-- Editor Area -->
          <div
            class={cn(
              'bg-surface-900 flex flex-1 flex-col overflow-hidden',
              selectedIndex === null && 'hidden sm:flex',
            )}
          >
            {#if selectedEntry !== null && selectedIndex !== null}
              <div
                class="border-surface-700 flex flex-shrink-0 items-center justify-between border-b px-4 py-2.5"
              >
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    class="-ml-2 h-7 w-7 sm:hidden"
                    onclick={() => {
                      selectedIndex = null
                      newEntryDraft = null
                    }}
                  >
                    <ArrowLeft class="h-4 w-4" />
                  </Button>
                  <Input
                    bind:value={selectedEntry.name}
                    class="text-surface-100 hover:border-surface-700 focus:border-surface-600 h-auto w-full min-w-[200px] border-transparent bg-transparent px-2 py-1 text-sm font-semibold transition-colors sm:w-auto"
                  />
                </div>
                <div class="flex items-center gap-2">
                  {#if selectedIndex === -1}
                    <!-- New entry draft: Save button -->
                    <Button
                      size="sm"
                      class="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onclick={handleSaveNewEntry}
                      disabled={saving}
                    >
                      <Save class="h-3.5 w-3.5" />
                      Save Entry
                    </Button>
                  {:else if selectedPendingChange}
                    <Button
                      size="sm"
                      class={cn(
                        'gap-1.5 text-white',
                        selectedPendingAction === 'delete'
                          ? 'bg-red-600 hover:bg-red-700'
                          : selectedPendingAction === 'edit'
                            ? 'bg-blue-600 hover:bg-blue-700'
                            : selectedPendingAction === 'merge-source' ||
                                selectedPendingAction === 'merge-result'
                              ? 'bg-amber-600 hover:bg-amber-700'
                              : 'bg-emerald-600 hover:bg-emerald-700',
                      )}
                      onclick={() => handleApproveEntry(selectedPendingChange!)}
                    >
                      {#if selectedPendingAction === 'delete'}
                        <Trash2 class="h-3.5 w-3.5" />
                        Approve Delete
                      {:else if selectedPendingAction === 'edit'}
                        <Pencil class="h-3.5 w-3.5" />
                        Approve Edit
                      {:else if selectedPendingAction === 'merge-source' || selectedPendingAction === 'merge-result'}
                        <GitMerge class="h-3.5 w-3.5" />
                        Approve Merge
                      {:else}
                        <Save class="h-3.5 w-3.5" />
                        Approve & Save
                      {/if}
                    </Button>
                  {:else if isEmbedded && (entriesDirty || savedFeedback === 'entry')}
                    <Button
                      size="sm"
                      class={cn(
                        'gap-1.5',
                        savedFeedback === 'entry' &&
                          'bg-emerald-600 text-white hover:bg-emerald-700',
                      )}
                      onclick={() => {
                        handleSaveClick()
                        entriesDirty = false
                        showSavedFeedback('entry')
                      }}
                      disabled={saving || savedFeedback === 'entry'}
                    >
                      {#if savedFeedback === 'entry'}
                        <Check class="h-3.5 w-3.5" />
                        Saved
                      {:else}
                        <Save class="h-3.5 w-3.5" />
                        Save Entry
                      {/if}
                    </Button>
                  {/if}
                  {#if selectedIndex >= 0}
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => handleDuplicateEntry(selectedIndex!)}
                      disabled={!!selectedPendingChange}
                    >
                      <span class="hidden sm:inline">Duplicate</span>
                      <Plus class="h-4 w-4" />
                    </Button>
                    {#if confirmingDeleteIndex === selectedIndex}
                      <Button
                        size="sm"
                        class="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                        onclick={() => handleDeleteEntry(selectedIndex!)}
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                        Confirm
                      </Button>
                    {:else}
                      <Button
                        variant="ghost"
                        size="icon"
                        class="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onclick={() => (confirmingDeleteIndex = selectedIndex)}
                        disabled={!!selectedPendingChange}
                      >
                        <Trash2 class="h-4 w-4" />
                      </Button>
                    {/if}
                  {/if}
                </div>
              </div>

              <div class="flex-1 overflow-y-auto p-6">
                <div class="mx-auto max-w-3xl">
                  <VaultLorebookEntryFields
                    data={selectedEntry}
                    changedFields={entryChangedFields}
                    onUpdate={(newData) => {
                      entriesDirty = true
                      if (selectedIndex === -1) {
                        // Editing the new entry draft
                        newEntryDraft = newData
                      } else if (selectedIndex !== null) {
                        if (selectedIndex >= 0) {
                          entries[selectedIndex] = newData
                          entries = [...entries]
                        } else if (selectedPendingChange && onUpdatePendingChange) {
                          onUpdatePendingChange(selectedPendingChange, newData)
                        }
                      }
                    }}
                  />
                </div>
              </div>
            {:else}
              <div class="text-surface-500 flex flex-1 flex-col items-center justify-center">
                <div class="bg-surface-800 mb-3 rounded-2xl p-5">
                  <Search class="h-6 w-6 opacity-40" />
                </div>
                <p class="text-surface-400 text-sm font-medium">Select an entry to edit</p>
                <p class="mt-1 text-xs">Or click "Add Entry" to create one</p>
              </div>
            {/if}
          </div>
        </Tabs.Content>
      </div>
    </div>
  </Tabs.Root>

  <!-- Footer -->
  {#if !isEmbedded}
    <div
      class="border-surface-700 bg-surface-800 flex flex-shrink-0 items-center gap-2 border-t px-4 py-2.5"
    >
      {#if onOpenAssistant}
        <Button
          variant="outline"
          class="border-surface-600 h-8 text-xs"
          onclick={() =>
            onOpenAssistant({
              entityType: 'lorebook',
              entityId: lorebook.id,
              entityName: lorebook.name,
            })}
          disabled={saving}
        >
          <Bot class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">Ask Assistant</span>
        </Button>
      {/if}
      <div class="flex flex-1 items-center justify-end gap-2">
        <Button
          variant="outline"
          class="border-surface-600 h-8 w-10 p-0 text-xs sm:w-auto sm:px-3"
          onclick={onClose}
          disabled={saving}
        >
          <X class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">Cancel</span>
        </Button>
        <Button
          class="h-8 flex-1 text-xs sm:flex-none"
          onclick={() => handleSaveClick(onSaveAndClose ?? onSave)}
          disabled={saving || !name.trim()}
        >
          {#if saving}
            <div
              class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            ></div>
          {:else}
            <Save class="h-3.5 w-3.5" />
          {/if}
          Save Changes
        </Button>
      </div>
    </div>
  {/if}
</div>
