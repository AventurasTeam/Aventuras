<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { database } from '$lib/services/database'
  import { LorebookImportExport } from '$lib/services/lorebookImportExport'
  import { open } from '@tauri-apps/plugin-dialog'
  import { readTextFile } from '@tauri-apps/plugin-fs'
  import { Check, FileJson, Loader2, Upload } from 'lucide-svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Progress } from '$lib/components/ui/progress'
  import { Checkbox } from '$lib/components/ui/checkbox'
  import { Label } from '$lib/components/ui/label'
  import { cn } from '$lib/utils/cn'

  let dragOver = $state(false)
  let parseResult = $state<LorebookImportExport.LorebookImportResult | null>(null)
  let useAIClassification = $state(true)
  let importing = $state(false)
  let importProgress = $state<LorebookImportExport.ImportProgress | null>(null)

  const previewCount = $derived(parseResult?.entries.length ?? 0)

  // Type counts for preview
  const typeCounts = $derived.by(() => {
    if (!parseResult) return {}
    return parseResult.entries.reduce(
      (acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
  })

  // Progress percentage for UI
  const progressPercent = $derived(
    importProgress && importProgress.total > 0
      ? Math.round((importProgress.current / importProgress.total) * 100)
      : 0,
  )

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) {
      processFile(file)
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    dragOver = true
  }

  function handleDragLeave() {
    dragOver = false
  }

  async function processContent(text: string) {
    parseResult = null

    const result = LorebookImportExport.parse(text)

    if (!result.success) {
      ui.showToast(
        result.errors.length > 0 ? result.errors.join(', ') : 'Invalid lorebook file format',
        'error',
      )
      return
    }

    if (result.entries.length === 0) {
      ui.showToast('No valid entries found in this lorebook file', 'error')
      return
    }

    parseResult = result
  }

  async function processFile(file: File) {
    try {
      await processContent(await file.text())
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Failed to read file', 'error')
    }
  }

  async function handleBrowse() {
    try {
      const filePath = await open({
        filters: [
          { name: 'Aventura Lorebook', extensions: ['json', 'avt'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (!filePath || typeof filePath !== 'string') {
        return
      }

      await processContent(await readTextFile(filePath))
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Failed to open file', 'error')
    }
  }

  async function handleImport() {
    if (!parseResult || !story.currentStory) return

    importing = true
    importProgress = null

    try {
      const result = await LorebookImportExport.importEntries(parseResult, {
        storyId: story.currentStory.id,
        useAIClassification,
        storyMode: story.currentStory.mode ?? 'adventure',
        onProgress: (progress) => {
          importProgress = progress
        },
      })

      if (result.success) {
        // Reload entries into store
        story.lorebookEntries = await database.getEntries(story.currentStory.id)

        ui.showToast(`Successfully imported ${result.entriesImported} entries`, 'info')
        ui.closeLorebookImport()
      } else {
        const errorMsg = result.errors.length > 0 ? result.errors.join(', ') : 'Import failed'
        ui.showToast(errorMsg, 'error')
      }
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      importing = false
      importProgress = null
    }
  }

  function close() {
    ui.closeLorebookImport()
  }
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && close()}>
  <ResponsiveModal.Content class="flex max-h-[90vh] max-w-lg flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <div class="flex items-center gap-2">
        <Upload class="text-primary h-5 w-5" />
        <ResponsiveModal.Title>Import Lorebook</ResponsiveModal.Title>
      </div>
      <ResponsiveModal.Description>
        Import entries from a JSON or Aventuras file.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <div class="flex-1 space-y-4 overflow-y-auto px-6 py-6">
      {#if !parseResult}
        <!-- File upload area -->
        <div
          class={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            dragOver
              ? 'border-primary bg-primary/10'
              : 'border-muted hover:border-muted-foreground/50',
          )}
          ondrop={handleDrop}
          ondragover={handleDragOver}
          ondragleave={handleDragLeave}
          role="button"
          tabindex="0"
          onclick={handleBrowse}
          onkeydown={(e) => e.key === 'Enter' && handleBrowse()}
        >
          <FileJson class="text-muted-foreground mx-auto mb-3 h-12 w-12" />
          <p class="text-foreground mb-1">Drop a lorebook file here</p>
          <p class="text-muted-foreground text-sm">or click to browse</p>
        </div>

        <p class="text-muted-foreground text-center text-xs">
          Supports Aventuras (.avt, .json) and SillyTavern lorebook formats
        </p>
      {:else}
        <!-- Preview -->
        <div class="bg-muted/50 rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-2">
            <Check class="h-5 w-5 text-green-500" />
            <span class="text-foreground font-medium">Found {previewCount} entries</span>
          </div>

          <!-- Entry type breakdown -->
          <div class="text-muted-foreground space-y-1 text-sm">
            {#each Object.entries(typeCounts) as [type, count], i (i)}
              <div class="flex items-center justify-between">
                <span class="capitalize">{type}</span>
                <span>{count}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- AI Classification toggle -->
        <div class="flex items-start space-x-2 rounded-lg border p-3">
          <Checkbox id="ai-classification" bind:checked={useAIClassification} class="mt-1" />
          <div class="grid gap-1.5 leading-none">
            <Label
              for="ai-classification"
              class="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              AI-powered classification
            </Label>
            <p class="text-muted-foreground text-xs">
              Use AI to better categorize entry types based on their content
            </p>
          </div>
        </div>

        {#if importing && importProgress}
          <div class="bg-muted/30 space-y-2 rounded-lg border p-3">
            <div class="flex items-center gap-2">
              <Loader2 class="text-primary h-4 w-4 animate-spin" />
              <span class="text-foreground text-sm">{importProgress.message}</span>
            </div>
            <Progress value={progressPercent} class="h-2" />
          </div>
        {/if}

        <!-- Change file button -->
        <Button
          variant="link"
          class="h-auto p-0 text-xs"
          onclick={() => {
            parseResult = null
          }}
        >
          Choose a different file
        </Button>
      {/if}
    </div>

    <ResponsiveModal.Footer class="mt-auto border-t px-6 py-4">
      <Button variant="outline" onclick={close} disabled={importing}>Cancel</Button>
      <Button onclick={handleImport} disabled={!parseResult || importing} class="gap-2">
        {#if importing}
          <Loader2 class="h-4 w-4 animate-spin" />
          {importProgress?.phase === 'classifying' ? 'Classifying...' : 'Importing...'}
        {:else}
          Import {previewCount} Entries
        {/if}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
