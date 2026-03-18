<script lang="ts">
  import { storyContext } from '$lib/stores/storyContext.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { RefreshCw, AlertTriangle } from 'lucide-svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert'

  interface Props {
    chapterId: string | null
    onConfirm: () => void
    onClose: () => void
  }

  let { chapterId, onConfirm, onClose }: Props = $props()

  const chapter = $derived(chapterId ? storyContext.chapters.find((c) => c.id === chapterId) : null)

  // Get previous chapters (for context display)
  const previousChapters = $derived(
    chapter
      ? storyContext.chapters
          .filter((c) => c.number < chapter.number)
          .sort((a, b) => a.number - b.number)
      : [],
  )
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && !ui.memoryLoading && onClose()}>
  <ResponsiveModal.Content class="flex max-h-[85vh] max-w-md flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-4 py-4">
      <div class="flex items-center gap-2">
        <RefreshCw class="text-primary h-5 w-5" />
        <ResponsiveModal.Title>Resummarize Chapter</ResponsiveModal.Title>
      </div>
      <ResponsiveModal.Description>
        Update the summary for this chapter.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <ScrollArea class="flex-1 p-4">
      <div class="space-y-4">
        {#if chapter}
          <div class="bg-muted/50 rounded-lg border p-3">
            <div class="text-foreground text-sm font-medium">
              Chapter {chapter.number}{chapter.title ? `: ${chapter.title}` : ''}
            </div>
            <p class="text-muted-foreground mt-1 line-clamp-2 text-xs">
              {chapter.summary}
            </p>
          </div>

          {#if previousChapters.length > 0}
            <div class="space-y-2">
              <p class="text-muted-foreground text-sm">
                The following {previousChapters.length} chapter{previousChapters.length === 1
                  ? ''
                  : 's'} will be used as context:
              </p>
              <div class="max-h-32 space-y-1 overflow-y-auto pr-1">
                {#each previousChapters as prevChapter (prevChapter.id)}
                  <div class="text-muted-foreground bg-muted/30 rounded p-2 text-xs">
                    <span class="text-foreground/80 font-medium">Ch {prevChapter.number}</span>
                    {#if prevChapter.title}
                      <span>: {prevChapter.title}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <Alert>
              <AlertTriangle class="h-4 w-4" />
              <AlertTitle>No Context</AlertTitle>
              <AlertDescription>
                This is the first chapter, so no previous context will be used.
              </AlertDescription>
            </Alert>
          {/if}

          <p class="text-muted-foreground text-sm">
            The current summary will be replaced with a newly generated one. The chapter's old
            summary will <strong>not</strong> be included in the prompt.
          </p>
        {:else}
          <div class="text-muted-foreground py-4 text-center">Chapter not found.</div>
        {/if}
      </div>
    </ScrollArea>

    <ResponsiveModal.Footer class="mt-auto border-t px-4 py-4">
      {#if !ui.memoryLoading}
        <Button variant="outline" onclick={onClose}>Cancel</Button>
      {/if}
      <Button onclick={onConfirm} disabled={!chapter || ui.memoryLoading} class="gap-2">
        {#if ui.memoryLoading}
          <RefreshCw class="h-4 w-4 animate-spin" />
          <span>Generating...</span>
        {:else}
          <RefreshCw class="h-4 w-4" />
          <span>Resummarize</span>
        {/if}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
