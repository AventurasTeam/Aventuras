<script lang="ts">
  import type { Entry, EntryType } from '$lib/types'
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import {
    Search,
    Plus,
    Download,
    Upload,
    Trash2,
    X,
    Filter,
    ArrowUpDown,
    Archive,
  } from 'lucide-svelte'
  import LorebookEntryCard from './LorebookEntryCard.svelte'

  import { Input } from '$lib/components/ui/input'
  import { Button } from '$lib/components/ui/button'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import * as Dialog from '$lib/components/ui/dialog'
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from '$lib/components/ui/dropdown-menu'

  interface Props {
    onNewEntry?: () => void
    onImportFromVault?: () => void
    onSaveToVault?: () => void
  }

  let { onNewEntry, onImportFromVault, onSaveToVault }: Props = $props()

  let searchDebounceTimer: ReturnType<typeof setTimeout>
  let confirmingBulkDelete = $state(false)
  let deleteAllDialogOpen = $state(false)
  let isDeleting = $state(false)

  const entryTypes: Array<EntryType | 'all'> = [
    'all',
    'character',
    'location',
    'item',
    'faction',
    'concept',
    'event',
  ]
  const sortOptions: Array<{
    value: 'name' | 'type' | 'updated'
    label: string
  }> = [
    { value: 'name', label: 'Name' },
    { value: 'type', label: 'Type' },
    { value: 'updated', label: 'Recently Updated' },
  ]

  // Lore management active state - disable editing actions
  const isLoreManagementActive = $derived(ui.loreManagementActive)

  // Filtered and sorted entries
  const filteredEntries = $derived.by(() => {
    let result = [...story.lorebookEntries] // Create a copy to avoid mutating original

    // Filter by type
    if (ui.lorebookTypeFilter !== 'all') {
      result = result.filter((e) => e.type === ui.lorebookTypeFilter)
    }

    // Filter by search query
    if (ui.lorebookSearchQuery.trim()) {
      const query = ui.lorebookSearchQuery.toLowerCase()
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(query) ||
          e.description.toLowerCase().includes(query) ||
          e.aliases.some((a) => a.toLowerCase().includes(query)) ||
          e.injection.keywords.some((k) => k.toLowerCase().includes(query)),
      )
    }

    // Sort (safe since we already created a copy)
    return result.sort((a, b) => {
      switch (ui.lorebookSortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'type':
          return a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
        case 'updated':
          return b.updatedAt - a.updatedAt
        default:
          return 0
      }
    })
  })

  const hasBulkSelection = $derived(ui.lorebookBulkSelection.size > 0)
  const allSelected = $derived(
    filteredEntries.length > 0 && filteredEntries.every((e) => ui.lorebookBulkSelection.has(e.id)),
  )

  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(() => {
      ui.setLorebookSearchQuery(value)
    }, 300)
  }

  function toggleSelectAll() {
    if (allSelected) {
      ui.clearBulkSelection()
    } else {
      ui.selectAllForBulk(filteredEntries.map((e) => e.id))
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(ui.lorebookBulkSelection)
    isDeleting = true
    try {
      await story.deleteLorebookEntries(ids)
      ui.clearBulkSelection()
      ui.showToast(`Deleted ${ids.length} entries`, 'info')
    } catch (error) {
      console.error('[LorebookList] Failed to delete entries:', error)
      ui.showToast(error instanceof Error ? error.message : 'Failed to delete entries', 'error')
    } finally {
      isDeleting = false
      confirmingBulkDelete = false
    }
  }

  function handleConfirmBulkDelete() {
    if (ui.lorebookBulkSelection.size === 0) return
    confirmingBulkDelete = true
  }

  function handleCancelBulkDelete() {
    confirmingBulkDelete = false
  }

  function handleClearSelection() {
    ui.clearBulkSelection()
  }

  async function handleDeleteAll() {
    isDeleting = true
    const ids = story.lorebookEntries.map((e) => e.id)
    try {
      await story.deleteLorebookEntries(ids)
      ui.clearBulkSelection()
      ui.selectLorebookEntry(null)
      deleteAllDialogOpen = false
      ui.showToast(`Deleted all ${ids.length} entries`, 'info')
    } catch (error) {
      ui.showToast(error instanceof Error ? error.message : 'Failed to delete entries', 'error')
    } finally {
      isDeleting = false
    }
  }

  function selectEntry(entry: Entry) {
    ui.selectLorebookEntry(entry.id)
  }
</script>

<div class="flex h-full flex-col">
  <!-- Search -->
  <div class="border-b px-3 pt-0 pb-3 sm:pt-3">
    <div class="relative">
      <Input
        type="text"
        placeholder="Search entries..."
        value={ui.lorebookSearchQuery}
        oninput={handleSearchInput}
        class="w-full pr-8 pl-9"
        leftIcon={Search}
      />
      {#if ui.lorebookSearchQuery}
        <button
          class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 p-1"
          onclick={() => ui.setLorebookSearchQuery('')}
        >
          <X class="h-4 w-4" />
        </button>
      {/if}
    </div>

    <!-- Filters -->
    <div class="mt-2 flex gap-2">
      <!-- Type filter -->
      <DropdownMenu>
        <DropdownMenuTrigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" class="w-full justify-between font-normal">
              <span class="flex items-center gap-2 capitalize">
                <Filter class="text-muted-foreground h-4 w-4" />
                {ui.lorebookTypeFilter === 'all' ? 'All Types' : ui.lorebookTypeFilter}
              </span>
            </Button>
          {/snippet}
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-50" align="start">
          <DropdownMenuLabel>Filter by Type</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={ui.lorebookTypeFilter}
            onValueChange={(val) => ui.setLorebookTypeFilter(val as EntryType | 'all')}
          >
            {#each entryTypes as type (type)}
              <DropdownMenuRadioItem value={type} class="capitalize">
                {type === 'all' ? 'All Types' : type}
              </DropdownMenuRadioItem>
            {/each}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Sort -->
      <div class="flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" class="w-full justify-between font-normal">
                <span class="flex items-center gap-2">
                  <ArrowUpDown class="text-muted-foreground h-4 w-4" />
                  {sortOptions.find((s) => s.value === ui.lorebookSortBy)?.label}
                </span>
              </Button>
            {/snippet}
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-[200px]" align="start">
            <DropdownMenuLabel>Sort Entries</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={ui.lorebookSortBy}
              onValueChange={(val) => ui.setLorebookSortBy(val as 'name' | 'type' | 'updated')}
            >
              {#each sortOptions as option (option.value)}
                <DropdownMenuRadioItem value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              {/each}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  </div>

  <!-- Action buttons -->
  <div class="flex gap-2 border-b p-3">
    <Button
      class="flex-1 gap-2"
      onclick={onNewEntry}
      disabled={isLoreManagementActive}
      title={isLoreManagementActive ? 'Editing disabled during lore management' : undefined}
    >
      <Plus class="h-4 w-4" />
      <span class="xs:inline hidden">New Entry</span>
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="icon"
            disabled={isLoreManagementActive}
            title="Vault"
          >
            <Archive class="h-4 w-4" />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Vault</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onclick={onImportFromVault}>
          <Upload class="mr-2 h-4 w-4" />
          Import from Vault
        </DropdownMenuItem>
        <DropdownMenuItem onclick={onSaveToVault} disabled={story.lorebookEntries.length === 0}>
          <Download class="mr-2 h-4 w-4" />
          Save to Vault
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button
      variant="outline"
      size="icon"
      onclick={() => ui.openLorebookImport()}
      disabled={isLoreManagementActive}
      title={isLoreManagementActive ? 'Import disabled during lore management' : 'Import from file'}
    >
      <Upload class="h-4 w-4" />
    </Button>
    <Button variant="outline" size="icon" onclick={() => ui.openLorebookExport()} title="Export">
      <Download class="h-4 w-4" />
    </Button>
    {#if story.lorebookEntries.length > 0 && !isLoreManagementActive}
      <Dialog.Root bind:open={deleteAllDialogOpen}>
        <Dialog.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="outline"
              size="icon"
              class="border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              title="Delete all entries"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          {/snippet}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Delete all lorebook entries?</Dialog.Title>
              <Dialog.Description>
                This will permanently delete all {story.lorebookEntries.length} entr{story
                  .lorebookEntries.length === 1
                  ? 'y'
                  : 'ies'} from this story's lorebook. This action cannot be undone.
              </Dialog.Description>
            </Dialog.Header>
            <Dialog.Footer>
              <Dialog.Close>
                {#snippet child({ props })}
                  <Button {...props} variant="outline">Cancel</Button>
                {/snippet}
              </Dialog.Close>
              <Button
                class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
                onclick={handleDeleteAll}
                disabled={isDeleting}
              >
                <Trash2 class="mr-2 h-4 w-4" />
                Delete all entries
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    {/if}
  </div>

  <!-- Bulk selection header -->
  {#if hasBulkSelection}
    <div class="bg-muted/30 flex items-center justify-between gap-2 border-b p-3">
      <div class="flex items-center gap-2">
        <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
        <span class="text-muted-foreground text-sm">{ui.lorebookBulkSelection.size} selected</span>
      </div>
      <div class="flex items-center gap-2">
        {#if confirmingBulkDelete}
          <Button
            variant="secondary"
            size="sm"
            class="h-7 px-2 text-xs"
            onclick={handleCancelBulkDelete}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            class="h-7 px-2 text-xs"
            onclick={handleBulkDelete}
            disabled={isDeleting}
          >
            Confirm Delete
          </Button>
        {:else}
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive h-7 gap-1 px-2 text-xs"
            onclick={handleConfirmBulkDelete}
          >
            <Trash2 class="h-3.5 w-3.5" />
            <span class="xs:inline hidden">Delete</span>
          </Button>
          <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={handleClearSelection}>
            Cancel
          </Button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Entry count -->
  <div class="text-muted-foreground bg-muted/10 border-b px-3 py-2 text-xs">
    {filteredEntries.length} entr{filteredEntries.length === 1 ? 'y' : 'ies'}
    {#if ui.lorebookTypeFilter !== 'all' || ui.lorebookSearchQuery}
      <span class="opacity-70">
        (filtered from {story.lorebookEntries.length})
      </span>
    {/if}
  </div>

  <!-- Entry list -->
  <ScrollArea class="flex-1 pb-16 sm:pb-10">
    <div class="space-y-2 p-3">
      {#if filteredEntries.length === 0}
        {#if story.lorebookEntries.length === 0}
          <div class="text-muted-foreground py-8 text-center">
            <p>No lorebook entries yet.</p>
            <p class="mt-1 text-sm">Create one or import a lorebook to get started.</p>
            {#if onImportFromVault}
              <Button
                variant="outline"
                class="mt-4 gap-2"
                onclick={onImportFromVault}
                disabled={isLoreManagementActive}
              >
                <Archive class="h-4 w-4" />
                Import from Vault
              </Button>
            {/if}
          </div>
        {:else}
          <div class="text-muted-foreground py-8 text-center">
            <p>No entries match your filters.</p>
            <Button
              variant="link"
              class="mt-1 h-auto p-0 text-sm"
              onclick={() => {
                ui.setLorebookSearchQuery('')
                ui.setLorebookTypeFilter('all')
              }}
            >
              Clear filters
            </Button>
          </div>
        {/if}
      {:else}
        {#each filteredEntries as entry (entry.id)}
          <LorebookEntryCard
            {entry}
            selected={ui.selectedLorebookEntryId === entry.id}
            showCheckbox={hasBulkSelection}
            onSelect={() => selectEntry(entry)}
          />
        {/each}
      {/if}
    </div>
  </ScrollArea>
</div>
