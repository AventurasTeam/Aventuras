<script lang="ts">
  import type { PresetPack } from '$lib/services/packs/types'
  import { packService } from '$lib/services/packs/pack-service'
  import { database } from '$lib/services/database'
  import {
    importExportService,
    type ImportValidationResult,
  } from '$lib/services/packs/import-export'
  import type { PackUpdateSummary } from '$lib/services/packs/update-summary'
  import { ui } from '$lib/stores/ui.svelte'
  import { errMessage } from '$lib/utils/error'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button } from '$lib/components/ui/button'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { fade } from 'svelte/transition'
  import PromptPackCard from './PromptPackCard.svelte'
  import CreatePackDialog from './CreatePackDialog.svelte'
  import ImportPreviewDialog from './ImportPreviewDialog.svelte'
  import UpdatePackDialog from './UpdatePackDialog.svelte'

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

  // Update-from-file state
  let updateTarget = $state<PresetPack | null>(null)
  let updateValidation = $state<ImportValidationResult | null>(null)
  let updateSummary = $state<PackUpdateSummary | null>(null)
  let updateErrors = $state<ImportValidationResult | null>(null)
  let updating = $state(false)
  let exportingBeforeUpdate = $state(false)

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
      ui.showToast(`Export failed: ${errMessage(e)}`, 'error')
    }
  }

  async function handleUpdateFromFile(pack: PresetPack) {
    const content = await importExportService.pickAndReadImportFile()
    if (!content) return

    const result = importExportService.validateImport(content)
    if (!result.valid || !result.pack) {
      updateErrors = result
      return
    }

    try {
      updateSummary = await importExportService.summarizeUpdate(pack.id, result.pack)
      updateValidation = result
      updateTarget = pack
    } catch (e) {
      console.error('[PromptPackList] Failed to summarize update:', e)
      ui.showToast(`Could not read pack: ${errMessage(e)}`, 'error')
    }
  }

  function closeUpdateDialog() {
    updateTarget = null
    updateValidation = null
    updateSummary = null
  }

  async function handleExportBeforeUpdate() {
    if (!updateTarget) return
    exportingBeforeUpdate = true
    try {
      const success = await importExportService.exportPack(updateTarget.id)
      if (success) ui.showToast('Pack exported successfully', 'info')
    } catch (e) {
      console.error('Export failed:', e)
      ui.showToast(`Export failed: ${errMessage(e)}`, 'error')
    } finally {
      exportingBeforeUpdate = false
    }
  }

  async function handleConfirmUpdate() {
    if (!updateTarget || !updateValidation?.pack) return
    updating = true
    try {
      await importExportService.updatePackFromFile(updateTarget.id, updateValidation.pack)
      ui.showToast(`Updated "${updateTarget.name}"`, 'info')
      closeUpdateDialog()
      await loadPacks()
    } catch (e) {
      console.error('Update failed:', e)
      ui.showToast(`Update failed: ${errMessage(e)}`, 'error')
    } finally {
      updating = false
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
        onUpdateFromFile={pack.isDefault ? undefined : () => handleUpdateFromFile(pack)}
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

<UpdatePackDialog
  open={!!updateTarget}
  pack={updateTarget}
  packData={updateValidation?.pack ?? null}
  summary={updateSummary}
  exporting={exportingBeforeUpdate}
  {updating}
  onExportFirst={handleExportBeforeUpdate}
  onConfirm={handleConfirmUpdate}
  onCancel={closeUpdateDialog}
/>

<!-- A file that fails validation never reaches the update confirmation; its errors are
     reported through the import preview's error state. -->
<ImportPreviewDialog
  open={!!updateErrors}
  validationResult={updateErrors}
  conflictPack={null}
  onConfirm={() => {
    updateErrors = null
  }}
  onCancel={() => {
    updateErrors = null
  }}
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
