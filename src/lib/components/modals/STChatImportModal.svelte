<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { parseSTChat, type STChatParseResult } from '$lib/services/stChatImporter'
  import { open } from '@tauri-apps/plugin-dialog'
  import { readTextFile } from '@tauri-apps/plugin-fs'
  import { Upload, MessageSquare, Loader2, Check, AlertTriangle } from 'lucide-svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'

  let dragOver = $state(false)
  let parseResult = $state<STChatParseResult | null>(null)
  let importing = $state(false)

  // Reset state each time modal opens
  $effect(() => {
    if (ui.stChatImportModalOpen) {
      dragOver = false
      parseResult = null
      importing = false
    }
  })

  const userCount = $derived(
    parseResult?.messages.filter((m) => m.type === 'user_action').length ?? 0,
  )
  const narrationCount = $derived(
    parseResult?.messages.filter((m) => m.type === 'narration').length ?? 0,
  )
  const total = $derived(parseResult?.messages.length ?? 0)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    const file = e.dataTransfer?.files[0]
    if (file) processFile(file)
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
    const result = parseSTChat(text)
    if (!result.success) {
      ui.showToast(result.error, 'error')
      return
    }
    parseResult = result
  }

  async function processFile(file: File) {
    try {
      const text = await file.text()
      await processContent(text)
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Failed to read file', 'error')
    }
  }

  async function handleBrowse() {
    try {
      const filePath = await open({
        filters: [{ name: 'SillyTavern Chat', extensions: ['jsonl'] }],
      })
      if (!filePath || typeof filePath !== 'string') return
      const content = await readTextFile(filePath)
      await processContent(content)
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Failed to open file', 'error')
    }
  }

  async function handleImport() {
    if (!parseResult || !story.currentStory) return
    importing = true
    try {
      await story.importSTChat(parseResult.messages)
      ui.showToast(`Imported ${total} messages`, 'info')
      ui.closeSTChatImport()
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      importing = false
    }
  }

  function close() {
    ui.closeSTChatImport()
  }
</script>

<ResponsiveModal.Root open={ui.stChatImportModalOpen} onOpenChange={(open) => !open && close()}>
  <ResponsiveModal.Content class="flex max-h-[90vh] max-w-lg flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-6 py-4">
      <div class="flex items-center gap-2">
        <MessageSquare class="text-primary h-5 w-5" />
        <ResponsiveModal.Title>Import SillyTavern Chat</ResponsiveModal.Title>
      </div>
      <ResponsiveModal.Description>
        Replace this story's entries with a SillyTavern .jsonl chat export.
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
          <Upload class="text-muted-foreground mx-auto mb-3 h-12 w-12" />
          <p class="text-foreground mb-1">Drop a .jsonl chat file here</p>
          <p class="text-muted-foreground text-sm">or click to browse</p>
        </div>
        <p class="text-muted-foreground text-center text-xs">
          Supports SillyTavern .jsonl chat exports
        </p>
      {:else}
        <!-- Parse preview -->
        <div class="bg-muted/50 rounded-lg border p-4">
          <div class="mb-3 flex items-center gap-2">
            <Check class="h-5 w-5 text-green-500" />
            <span class="text-foreground font-medium">Found {total} messages</span>
          </div>
          <div class="text-muted-foreground space-y-1 text-sm">
            <div class="flex items-center justify-between">
              <span>Character</span>
              <span class="text-foreground font-medium">{parseResult.characterName}</span>
            </div>
            <div class="flex items-center justify-between">
              <span>User messages</span>
              <span>{userCount}</span>
            </div>
            <div class="flex items-center justify-between">
              <span>Narration messages</span>
              <span>{narrationCount}</span>
            </div>
            {#if parseResult.totalSkipped > 0}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground/70">Skipped (system / empty)</span>
                <span class="text-muted-foreground/70">{parseResult.totalSkipped}</span>
              </div>
            {/if}
          </div>
        </div>

        <!-- Destructive warning -->
        <div class="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div class="space-y-1 text-sm">
            <p class="text-foreground font-medium">
              This will permanently replace all entries in "{story.currentStory?.title}".
            </p>
            <p class="text-muted-foreground">
              Back up first: use <strong>Export → Aventuras (.avt)</strong> in the header, or
              <strong>Settings → Labs</strong> for a full database backup.
            </p>
          </div>
        </div>

        <!-- Change file button -->
        <Button variant="link" class="h-auto p-0 text-xs" onclick={() => (parseResult = null)}>
          Choose a different file
        </Button>
      {/if}
    </div>

    <ResponsiveModal.Footer class="mt-auto border-t px-6 py-4">
      <Button variant="outline" onclick={close} disabled={importing}>Cancel</Button>
      <Button
        onclick={handleImport}
        disabled={!parseResult || importing}
        variant="destructive"
        class="gap-2"
      >
        {#if importing}
          <Loader2 class="h-4 w-4 animate-spin" />
          Importing…
        {:else}
          Replace with {total} Messages
        {/if}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
