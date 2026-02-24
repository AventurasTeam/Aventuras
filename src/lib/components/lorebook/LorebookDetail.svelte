<script lang="ts">
  import type { Entry, EntryType } from '$lib/types'
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import {
    Users,
    MapPin,
    Package,
    Shield,
    Lightbulb,
    Calendar,
    BookOpen,
    Pencil,
    Trash2,
    ArrowLeft,
  } from 'lucide-svelte'
  import LorebookEntryForm from './LorebookEntryForm.svelte'

  interface Props {
    entry: Entry
    isMobile?: boolean
  }

  let { entry, isMobile = false }: Props = $props()

  let deleting = $state(false)
  let confirmingDelete = $state(false)

  const typeIcons: Record<EntryType, typeof Users> = {
    character: Users,
    location: MapPin,
    item: Package,
    faction: Shield,
    concept: Lightbulb,
    event: Calendar,
  }

  const typeColors: Record<EntryType, string> = {
    character: 'text-blue-400 bg-blue-500/20',
    location: 'text-green-400 bg-green-500/20',
    item: 'text-amber-400 bg-amber-500/20',
    faction: 'text-purple-400 bg-purple-500/20',
    concept: 'text-pink-400 bg-pink-500/20',
    event: 'text-cyan-400 bg-cyan-500/20',
  }

  const injectionLabels: Record<string, string> = {
    always: 'Always Active',
    keyword: 'Automatic (keywords + AI)',
    never: 'Disabled',
  }

  const Icon = $derived(typeIcons[entry.type] || BookOpen)
  const colorClass = $derived(typeColors[entry.type] || 'text-surface-400 bg-surface-700')

  // Lore management active state - disable editing actions
  const isLoreManagementActive = $derived(ui.loreManagementActive)

  async function handleSave(updatedEntry: Entry) {
    if (entry.id) {
      // Update existing
      const { id: _id, storyId: _storyId, createdAt: _createdAt, ...updates } = updatedEntry
      await story.updateLorebookEntry(entry.id, updates)
    }
    ui.setLorebookEditMode(false)
  }

  async function handleDelete() {
    deleting = true
    try {
      await story.deleteLorebookEntry(entry.id)
      if (isMobile) {
        ui.hideLorebookDetail()
      } else {
        ui.selectLorebookEntry(null)
      }
    } catch (error) {
      console.error('[LorebookDetail] Failed to delete entry:', error)
      alert(error instanceof Error ? error.message : 'Failed to delete entry')
    } finally {
      deleting = false
      confirmingDelete = false
    }
  }

  function handleConfirmDelete() {
    confirmingDelete = true
  }

  function handleCancelDelete() {
    confirmingDelete = false
  }

  function handleBack() {
    if (ui.lorebookEditMode) {
      ui.setLorebookEditMode(false)
    } else {
      ui.hideLorebookDetail()
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- Header -->
  <div class="border-surface-700 flex items-center justify-between gap-3 border-b p-4">
    <div class="flex min-w-0 items-center gap-3">
      {#if isMobile}
        <button
          class="btn-ghost -ml-1 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg p-3"
          onclick={handleBack}
        >
          <ArrowLeft class="h-5 w-5" />
        </button>
      {/if}

      <div class="rounded-lg p-2 {colorClass}">
        <Icon class="h-5 w-5" />
      </div>

      <div class="min-w-0">
        <h2 class="text-surface-100 truncate font-semibold">
          {ui.lorebookEditMode ? 'Edit Entry' : entry.name}
        </h2>
        {#if !ui.lorebookEditMode}
          <span class="text-surface-500 text-xs capitalize">{entry.type}</span>
        {/if}
      </div>
    </div>

    {#if !ui.lorebookEditMode}
      <div class="flex items-center gap-2">
        {#if confirmingDelete}
          <button
            class="bg-surface-700 text-surface-300 hover:bg-surface-600 rounded px-2 py-1 text-xs"
            onclick={handleCancelDelete}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            class="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
            onclick={handleDelete}
            disabled={deleting}
          >
            Confirm Delete
          </button>
        {:else}
          <button
            class="btn-ghost rounded-lg p-2"
            onclick={() => ui.setLorebookEditMode(true)}
            disabled={isLoreManagementActive}
            title={isLoreManagementActive ? 'Editing disabled during lore management' : 'Edit'}
          >
            <Pencil class="h-4 w-4" />
          </button>
          <button
            class="btn-ghost rounded-lg p-2 text-red-400 hover:text-red-300"
            onclick={handleConfirmDelete}
            disabled={isLoreManagementActive}
            title={isLoreManagementActive ? 'Deletion disabled during lore management' : 'Delete'}
          >
            <Trash2 class="h-4 w-4" />
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Content -->
  <div class="touch-scroll flex-1 overflow-y-auto p-4">
    {#if ui.lorebookEditMode}
      <LorebookEntryForm
        {entry}
        onSave={handleSave}
        onCancel={() => ui.setLorebookEditMode(false)}
      />
    {:else}
      <div class="space-y-6">
        <!-- Description -->
        <div>
          <h3 class="text-surface-400 mb-2 text-sm font-medium">Description</h3>
          {#if entry.description}
            <p class="text-surface-200 whitespace-pre-wrap">{entry.description}</p>
          {:else}
            <p class="text-surface-500 italic">No description</p>
          {/if}
        </div>

        <!-- Aliases -->
        {#if entry.aliases.length > 0}
          <div>
            <h3 class="text-surface-400 mb-2 text-sm font-medium">Aliases</h3>
            <div class="flex flex-wrap gap-2">
              {#each entry.aliases as alias (alias)}
                <span class="bg-surface-700 text-surface-300 rounded-full px-2 py-1 text-sm">
                  {alias}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Keywords -->
        {#if entry.injection.keywords.length > 0}
          <div>
            <h3 class="text-surface-400 mb-2 text-sm font-medium">Keywords</h3>
            <div class="flex flex-wrap gap-2">
              {#each entry.injection.keywords as keyword (keyword)}
                <span class="bg-accent-500/20 text-accent-300 rounded-full px-2 py-1 text-sm">
                  {keyword}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Context Inclusion -->
        <div>
          <h3 class="text-surface-400 mb-2 text-sm font-medium">Context Inclusion</h3>
          <div class="flex items-center gap-4 text-sm">
            <div>
              <span class="text-surface-500">Mode:</span>
              <span class="text-surface-300 ml-1">{injectionLabels[entry.injection.mode]}</span>
            </div>
            <div>
              <span class="text-surface-500">Priority:</span>
              <span class="text-surface-300 ml-1">{entry.injection.priority}</span>
            </div>
          </div>
        </div>

        <!-- Lore Management Status -->
        {#if entry.loreManagementBlacklisted}
          <div
            class="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <span class="text-sm text-amber-400">Hidden from AI Lore Management</span>
          </div>
        {/if}

        <!-- Hidden Info -->
        {#if entry.hiddenInfo}
          <div>
            <h3 class="text-surface-400 mb-2 text-sm font-medium">Hidden Info</h3>
            <div class="bg-surface-800/50 border-surface-700 rounded-lg border p-3">
              <p class="text-surface-300 text-sm whitespace-pre-wrap">{entry.hiddenInfo}</p>
            </div>
          </div>
        {/if}

        <!-- Metadata -->
        <div>
          <h3 class="text-surface-400 mb-2 text-sm font-medium">Metadata</h3>
          <div class="text-surface-500 space-y-1 text-sm">
            <div>Created: {new Date(entry.createdAt).toLocaleDateString()}</div>
            <div>Updated: {new Date(entry.updatedAt).toLocaleDateString()}</div>
            <div>Source: <span class="capitalize">{entry.createdBy}</span></div>
            {#if entry.mentionCount > 0}
              <div>Mentions: {entry.mentionCount}</div>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
