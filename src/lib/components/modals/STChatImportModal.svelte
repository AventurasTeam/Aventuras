<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte'
  import { story } from '$lib/stores/story.svelte'
  import { parseSTChat, type STChatParseResult } from '$lib/services/stChatImporter'
  import { open } from '@tauri-apps/plugin-dialog'
  import { readTextFile } from '@tauri-apps/plugin-fs'
  import { Upload, MessageSquare, Loader2, Check, AlertTriangle, GitBranch, RefreshCw } from 'lucide-svelte'

  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { cn } from '$lib/utils/cn'

  let dragOver = $state(false)
  let parseResult = $state<STChatParseResult | null>(null)
  let importing = $state(false)
  let imported = $state(false)
  let resettingWorldState = $state(false)

  // Reset state each time modal opens
  $effect(() => {
    if (ui.stChatImportModalOpen) {
      dragOver = false
      parseResult = null
      importing = false
      imported = false
      resettingWorldState = false
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
    if (file) void processFile(file)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    dragOver = true
  }

  function handleDragLeave() {
    dragOver = false
  }

  function processContent(text: string) {
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
      processContent(text)
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
      processContent(content)
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Failed to open file', 'error')
    }
  }

  async function handleImport() {
    if (!parseResult || !story.currentStory) return
    importing = true
    try {
      await story.importSTChat(parseResult.messages)
      imported = true
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Import failed', 'error')
    } finally {
      importing = false
    }
  }

  function handleKeepWorldState() {
    story.triggerSuggestionsAfterImport()
    ui.showToast(`Imported ${total} messages`, 'info')
    ui.closeSTChatImport()
  }

  async function handleResetWorldState() {
    resettingWorldState = true
    try {
      await story.resetWorldStateAfterImport()
      story.triggerSuggestionsAfterImport()
      ui.showToast(`Imported ${total} messages — world state reset`, 'info')
    } catch (err) {
      ui.showToast(err instanceof Error ? err.message : 'Reset failed', 'error')
    } finally {
      resettingWorldState = false
      ui.closeSTChatImport()
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
      {#if story.branches.length > 0}
        <!-- Blocking error: branches must be deleted first -->
        <div class="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <GitBranch class="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div class="space-y-1 text-sm">
            <p class="text-foreground font-medium">Branches must be deleted first</p>
            <p class="text-muted-foreground">
              This story has {story.branches.length} branch{story.branches.length === 1
                ? ''
                : 'es'}. Because branches reference main-branch entries via fork points,
              importing would leave them broken. Delete all branches in the Branch panel, then
              re-open this dialog.
            </p>
          </div>
        </div>
      {:else if imported}
        <!-- Post-import: world state choice -->
        <div class="flex flex-col items-center gap-4 py-2 text-center">
          <div class="bg-muted rounded-full p-3">
            <Check class="h-8 w-8 text-green-500" />
          </div>
          <div class="space-y-1">
            <p class="text-foreground font-medium">{total} messages imported</p>
            <p class="text-muted-foreground text-sm">
              Locations, items, story beats, and the time tracker still reflect your previous
              story. Reset them now, or keep them to fill in manually later.
            </p>
          </div>
          <div
            class="text-muted-foreground w-full rounded-md border px-3 py-2 text-left text-xs"
          >
            <strong class="text-foreground">Characters and lorebook are not affected</strong>
            — they are always preserved.
          </div>
        </div>
      {:else if !parseResult}
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
        <p class="text-muted-foreground text-center text-xs">
          <strong class="text-foreground">Recommended:</strong> An empty story is recommended for
          better state tracking and classification.
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
      {#if imported}
        <Button
          onclick={handleKeepWorldState}
          disabled={resettingWorldState}
          class="gap-2 bg-yellow-500 text-black hover:bg-yellow-400"
        >
          Keep World State
        </Button>
        <Button
          onclick={handleResetWorldState}
          disabled={resettingWorldState}
          class="gap-2 bg-red-600 text-white hover:bg-red-500"
        >
          {#if resettingWorldState}
            <Loader2 class="h-4 w-4 animate-spin" />
            Resetting…
          {:else}
            <RefreshCw class="h-4 w-4" />
            Reset World State
          {/if}
        </Button>
      {:else}
        <Button variant="outline" onclick={close} disabled={importing}>Cancel</Button>
        <Button
          onclick={handleImport}
          disabled={!parseResult || importing || story.branches.length > 0}
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
      {/if}
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
