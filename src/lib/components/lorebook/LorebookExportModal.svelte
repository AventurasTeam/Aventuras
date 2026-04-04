<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { LorebookImportExport } from '$lib/services/lorebookImportExport'
  import { Download, FileJson, FileText, Loader2 } from 'lucide-svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { RadioGroup, RadioGroupItem } from '$lib/components/ui/radio-group'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'

  let selectedFormat = $state<LorebookImportExport.ExportFormat>('aventura')
  let exportSelected = $state(false)
  let exporting = $state(false)

  const formats: LorebookImportExport.ExportFormat[] = ['aventura', 'sillytavern', 'text']

  const entriesToExport = $derived(() => {
    if (exportSelected && ui.lorebookBulkSelection.size > 0) {
      return story.lorebookEntries.filter((e) => ui.lorebookBulkSelection.has(e.id))
    }
    return story.lorebookEntries
  })

  const entryCount = $derived(entriesToExport().length)
  const hasSelection = $derived(ui.lorebookBulkSelection.size > 0)

  async function handleExport() {
    if (entryCount === 0) {
      ui.showToast('No entries to export', 'error')
      return
    }

    exporting = true

    try {
      await LorebookImportExport.exportLorebook({
        format: selectedFormat,
        entries: entriesToExport(),
        filename: story.currentStory?.title ? `${story.currentStory.title}-lorebook` : undefined,
      })
      ui.showToast('Export successful', 'info')
      ui.closeLorebookExport()
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      exporting = false
    }
  }

  function close() {
    ui.closeLorebookExport()
  }
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && close()}>
  <ResponsiveModal.Content class="flex max-h-[90vh] max-w-md flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <div class="flex items-center gap-2">
        <Download class="text-primary h-5 w-5" />
        <ResponsiveModal.Title>Export Lorebook</ResponsiveModal.Title>
      </div>
    </ResponsiveModal.Header>

    <div class="space-y-6 px-6 py-6">
      <!-- Export scope -->
      {#if hasSelection}
        <div class="space-y-3">
          <Label>What to export</Label>
          <RadioGroup
            value={exportSelected ? 'selected' : 'all'}
            onValueChange={(v) => (exportSelected = v === 'selected')}
          >
            <div
              class={cn(
                'hover:bg-muted/50 flex cursor-pointer items-center space-x-2 rounded-lg border p-3',
                !exportSelected && 'border-primary bg-primary/5',
              )}
            >
              <RadioGroupItem value="all" id="scope-all" />
              <Label for="scope-all" class="flex-1 cursor-pointer">
                <div class="font-medium">All entries</div>
                <div class="text-muted-foreground text-xs">
                  {story.lorebookEntries.length} entries
                </div>
              </Label>
            </div>

            <div
              class={cn(
                'hover:bg-muted/50 flex cursor-pointer items-center space-x-2 rounded-lg border p-3',
                exportSelected && 'border-primary bg-primary/5',
              )}
            >
              <RadioGroupItem value="selected" id="scope-selected" />
              <Label for="scope-selected" class="flex-1 cursor-pointer">
                <div class="font-medium">Selected only</div>
                <div class="text-muted-foreground text-xs">
                  {ui.lorebookBulkSelection.size} entries
                </div>
              </Label>
            </div>
          </RadioGroup>
        </div>
      {:else}
        <div class="bg-muted/50 rounded-lg border p-3">
          <div class="text-foreground font-medium">{story.lorebookEntries.length} entries</div>
          <div class="text-muted-foreground text-xs">All lorebook entries will be exported</div>
        </div>
      {/if}

      <!-- Format selection -->
      <div class="space-y-3">
        <Label>Export format</Label>
        <RadioGroup
          value={selectedFormat}
          onValueChange={(v) => (selectedFormat = v as LorebookImportExport.ExportFormat)}
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
    </div>

    <ResponsiveModal.Footer class="mt-auto border-t px-6 py-4">
      <Button variant="outline" onclick={close} disabled={exporting}>Cancel</Button>
      <Button onclick={handleExport} disabled={exporting || entryCount === 0} class="gap-2">
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
