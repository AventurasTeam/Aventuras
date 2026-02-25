<script lang="ts">
  import type { PresetPack } from '$lib/services/packs/types'
  import { packService } from '$lib/services/packs/pack-service'
  import { database } from '$lib/services/database'
  import { importExportService } from '$lib/services/packs/import-export'
  import { ui } from '$lib/stores/ui.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button } from '$lib/components/ui/button'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { fade } from 'svelte/transition'
  import PromptPackCard from './PromptPackCard.svelte'
  import CreatePackDialog from './CreatePackDialog.svelte'

  interface Props {
    onOpenPack: (packId: string) => void
    showCreateDialog?: boolean
  }

  let { onOpenPack, showCreateDialog = $bindable(false) }: Props = $props()

  let packs = $state<PresetPack[]>([])
  let modifiedCounts = $state<Map<string, number>>(new Map())
  let usageCounts = $state<Map<string, number>>(new Map())
  let loading = $state(true)

  // Delete confirmation state
  let deleteTarget = $state<PresetPack | null>(null)
  let deleting = $state(false)

  async function loadPacks() {
    loading = true
    try {
      const allPacks = await packService.getAllPacks()

      // Load modified counts and usage counts in parallel for each pack
      const [modifiedResults, usageResults] = await Promise.all([
        Promise.all(
          allPacks.map(async (pack) => {
            const modified = await packService.getModifiedTemplates(pack.id)
            const count = [...modified.values()].filter(Boolean).length
            return [pack.id, count] as const
          }),
        ),
        Promise.all(
          allPacks.map(async (pack) => {
            const count = await database.getPackUsageCount(pack.id)
            return [pack.id, count] as const
          }),
        ),
      ])

      modifiedCounts = new Map(modifiedResults)
      usageCounts = new Map(usageResults)

      // Sort: default pack first, then user-created packs by name
      packs = allPacks.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1
        if (!a.isDefault && b.isDefault) return 1
        return a.name.localeCompare(b.name)
      })
    } catch (error) {
      console.error('[PromptPackList] Failed to load packs:', error)
    } finally {
      loading = false
    }
  }

  function handlePackCreated() {
    loadPacks()
  }

  async function handleExportPack(packId: string) {
    try {
      const success = await importExportService.exportPack(packId)
      if (success) ui.showToast('Pack exported successfully', 'info')
    } catch (e) {
      console.error('Export failed:', e)
      ui.showToast('Export failed', 'error')
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    deleting = true
    try {
      const result = await packService.deletePack(deleteTarget.id)
      if (result.deleted) {
        ui.showToast(`Deleted "${deleteTarget.name}"`, 'info')
        deleteTarget = null
        await loadPacks()
      } else {
        ui.showToast(result.reason ?? 'Could not delete pack', 'error')
      }
    } catch (e) {
      console.error('Delete failed:', e)
      ui.showToast('Delete failed', 'error')
    } finally {
      deleting = false
    }
  }

  // Load on mount
  $effect(() => {
    loadPacks()
  })
</script>

{#if loading}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {#each Array(3) as _, i (i)}
      <div class="space-y-3">
        <Skeleton class="h-30 w-full rounded-xl" />
      </div>
    {/each}
  </div>
{:else}
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" in:fade>
    {#each packs as pack (pack.id)}
      <PromptPackCard
        {pack}
        modifiedCount={modifiedCounts.get(pack.id) ?? 0}
        usageCount={usageCounts.get(pack.id) ?? 0}
        onclick={() => onOpenPack(pack.id)}
        onExport={() => handleExportPack(pack.id)}
        onDelete={pack.isDefault
          ? undefined
          : () => {
              deleteTarget = pack
            }}
      />
    {/each}
  </div>
{/if}

<CreatePackDialog
  open={showCreateDialog}
  onOpenChange={(v) => (showCreateDialog = v)}
  onCreated={handlePackCreated}
/>

<!-- Delete confirmation -->
<ResponsiveModal.Root
  open={!!deleteTarget}
  onOpenChange={(v) => {
    if (!v) deleteTarget = null
  }}
>
  <ResponsiveModal.Content class="p-0 sm:max-w-sm">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <ResponsiveModal.Title>Delete Pack</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Are you sure you want to delete "{deleteTarget?.name}"? This cannot be undone.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>
    <ResponsiveModal.Footer class="border-t px-6 py-4">
      <Button
        variant="outline"
        onclick={() => {
          deleteTarget = null
        }}>Cancel</Button
      >
      <Button variant="destructive" onclick={handleConfirmDelete} disabled={deleting}>
        {deleting ? 'Deleting...' : 'Delete'}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
