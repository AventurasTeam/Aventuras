<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import type { VaultLorebook } from '$lib/types'
  import { LorebookImportExport } from '$lib/services/lorebookImportExport'
  import UniversalVaultBrowser from '$lib/components/vault/UniversalVaultBrowser.svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Archive, Loader2 } from 'lucide-svelte'

  interface Props {
    open: boolean
    onClose: () => void
  }

  let { open, onClose }: Props = $props()

  let importing = $state(false)

  async function handleSelectLorebook(lorebook: VaultLorebook) {
    if (!story.currentStory || importing) return
    importing = true
    try {
      const importedEntries = lorebook.entries.map((e) => ({
        ...e,
        description: e.description ?? '',
        keywords: e.keywords ?? [],
        aliases: e.aliases ?? [],
        injectionMode: e.injectionMode ?? ('keyword' as const),
        priority: e.priority ?? 100,
      }))

      const entries = LorebookImportExport.convertToEntries(importedEntries, 'import')
      const count = await story.addLorebookEntries(entries)

      ui.showToast(
        `Imported ${count} entr${count === 1 ? 'y' : 'ies'} from "${lorebook.name}"`,
        'info',
      )
      onClose()
    } catch (error) {
      ui.showToast(error instanceof Error ? error.message : 'Failed to import lorebook', 'error')
    } finally {
      importing = false
    }
  }

  function handleNavigateToVault() {
    onClose()
    ui.setActivePanel('vault')
  }
</script>

<ResponsiveModal.Root {open} onOpenChange={(v) => !v && onClose()}>
  <ResponsiveModal.Content class="flex max-h-[90vh] max-w-lg flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <div class="flex items-center gap-2">
        <Archive class="text-primary h-5 w-5" />
        <ResponsiveModal.Title>Import from Vault</ResponsiveModal.Title>
      </div>
      <ResponsiveModal.Description>
        Select a lorebook from your vault to add its entries to this story.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <div class="flex-1 overflow-y-auto px-6 py-4">
      {#if importing}
        <div class="flex items-center justify-center gap-2 py-12">
          <Loader2 class="h-5 w-5 animate-spin" />
          <span class="text-muted-foreground text-sm">Importing entries...</span>
        </div>
      {:else}
        <UniversalVaultBrowser
          type="lorebook"
          onSelect={handleSelectLorebook}
          onNavigateToVault={handleNavigateToVault}
        />
      {/if}
    </div>

    <ResponsiveModal.Footer class="border-t px-6 py-3">
      <Button variant="outline" onclick={onClose}>Cancel</Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
