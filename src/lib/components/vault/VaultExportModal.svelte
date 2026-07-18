<script lang="ts">
  import { LorebookImportExport } from '$lib/services/lorebookImportExport'
  import { Download, FileJson, FileText, Loader2 } from 'lucide-svelte'
  import type { VaultLorebook, VaultCharacter, VaultScenario } from '$lib/types'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'
  import { ui } from '$lib/stores/ui.svelte'
  import { errMessage } from '$lib/utils/error'

  type ExportFormat = LorebookImportExport.ExportFormat
  type EntityType = 'lorebook' | 'character' | 'scenario'

  interface Props {
    entity: VaultLorebook | VaultCharacter | VaultScenario
    entityType: EntityType
    onClose: () => void
  }

  let { entity, entityType, onClose }: Props = $props()

  let selectedFormat = $state<ExportFormat>('aventura')
  let exporting = $state(false)

  const formats: ExportFormat[] = ['aventura', 'sillytavern', 'text']

  const entityLabel = $derived(
    entityType === 'lorebook' ? 'Lorebook' : entityType === 'character' ? 'Character' : 'Scenario',
  )

  const entryCount = $derived(
    entityType === 'lorebook' ? (entity as VaultLorebook).entries.length : 0,
  )

  async function handleExport() {
    exporting = true

    try {
      let success = false

      if (entityType === 'lorebook') {
        success = await LorebookImportExport.exportVaultLorebook(
          entity as VaultLorebook,
          selectedFormat,
        )
      } else if (entityType === 'character') {
        success = await LorebookImportExport.exportVaultCharacter(entity as VaultCharacter)
      } else {
        success = await LorebookImportExport.exportVaultScenario(entity as VaultScenario)
      }

      if (success) {
        onClose()
      }
    } catch (err) {
      console.error('[VaultExportModal] Export failed:', err)
      ui.showToast(`Export failed: ${errMessage(err)}`, 'error')
    } finally {
      exporting = false
    }
  }
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
  <ResponsiveModal.Content class="flex max-h-[90vh] max-w-md flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <div class="flex items-center gap-2">
        <Download class="text-primary h-5 w-5" />
        <ResponsiveModal.Title>Export {entityLabel}</ResponsiveModal.Title>
      </div>
    </ResponsiveModal.Header>

    <div class="space-y-6 px-6 py-6">
      <!-- Entity info -->
      <div class="bg-muted/50 rounded-lg border p-3">
        <div class="text-foreground font-medium">{entity.name}</div>
        {#if entityType === 'lorebook'}
          <div class="text-muted-foreground text-xs">{entryCount} entries</div>
        {/if}
      </div>

      <!-- Format selection (only for lorebooks) -->
      {#if entityType === 'lorebook'}
        <div class="space-y-3">
          <Label>Export format</Label>
          <RadioGroup
            value={selectedFormat}
            onValueChange={(v) => (selectedFormat = v as ExportFormat)}
          >
            {#each formats as format (format)}
              {@const info = LorebookImportExport.getFormatInfo(format)}
              <div
                class={cn(
                  'hover:bg-muted/50 flex cursor-pointer items-start space-x-3 rounded-lg border p-3 transition-colors',
                  selectedFormat === format && 'border-primary bg-primary/5',
                )}
              >
                <RadioGroupItem value={format} id={`format-${format}`} class="mt-1" />
                <div class="flex-1 space-y-1">
                  <Label
                    for={`format-${format}`}
                    class="flex cursor-pointer items-center gap-2 font-medium"
                  >
                    {info.label}
                    <span class="text-muted-foreground ml-auto text-xs font-normal"
                      >{info.extension}</span
                    >
                  </Label>
                  <p class="text-muted-foreground text-xs">{info.description}</p>
                </div>
                <div class="text-muted-foreground mt-0.5">
                  {#if format === 'text'}
                    <FileText class="h-4 w-4" />
                  {:else}
                    <FileJson class="h-4 w-4" />
                  {/if}
                </div>
              </div>
            {/each}
          </RadioGroup>
        </div>
      {:else}
        <div class="bg-muted/30 rounded-lg border p-3">
          <div class="text-muted-foreground text-sm">
            {entityLabel}s are exported as Aventura JSON format.
          </div>
        </div>
      {/if}
    </div>

    <ResponsiveModal.Footer class="mt-auto border-t px-6 py-4">
      <Button variant="outline" onclick={onClose} disabled={exporting}>Cancel</Button>
      <Button onclick={handleExport} disabled={exporting} class="gap-2">
        {#if exporting}
          <Loader2 class="h-4 w-4 animate-spin" />
          Exporting...
        {:else}
          <Download class="h-4 w-4" />
          Export
        {/if}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
