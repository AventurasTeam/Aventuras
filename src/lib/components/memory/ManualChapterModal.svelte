<script lang="ts">
  import { storyContext } from '$lib/stores/storyContext.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { Badge } from '$lib/components/ui/badge'
  import { cn } from '$lib/utils/cn'

  interface Props {
    onConfirm: (endEntryIndex: number) => void
    onClose: () => void
  }

  let { onConfirm, onClose }: Props = $props()

  // Get entries available for chapter creation
  // These are entries after the last chapter
  const availableEntries = $derived(() => {
    const lastChapterEndIndex = storyContext.lastChapterEndIndex
    return storyContext.entries.slice(lastChapterEndIndex)
  })

  const entries = $derived(availableEntries())

  // Selected entry index (relative to available entries)
  let selectedIndex = $derived(Math.max(0, entries.length - 1))

  // Ensure selectedIndex stays in bounds
  $effect(() => {
    if (selectedIndex >= entries.length) {
      selectedIndex = Math.max(0, entries.length - 1)
    }
  })

  function handleConfirm() {
    if (entries.length === 0) return
    // Convert to absolute index
    const absoluteIndex = storyContext.lastChapterEndIndex + selectedIndex + 1
    onConfirm(absoluteIndex)
  }
</script>

<ResponsiveModal.Root open={true} onOpenChange={(open) => !open && onClose()}>
  <ResponsiveModal.Content class="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0">
    <ResponsiveModal.Header class="border-b px-4 py-4">
      <ResponsiveModal.Title>Create Chapter</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Select where to end this chapter. All entries up to and including the selected entry will be
        summarized.
      </ResponsiveModal.Description>
    </ResponsiveModal.Header>

    <div class="min-h-0 flex-1">
      {#if entries.length === 0}
        <div class="text-muted-foreground flex h-40 items-center justify-center">
          No entries available for chapter creation.
        </div>
      {:else}
        <ScrollArea class="h-[50vh] p-4">
          <div class="space-y-1">
            {#each entries as entry, idx (entry.id)}
              <button
                class={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  selectedIndex === idx
                    ? 'bg-primary/10 border-primary/50 ring-primary/20 ring-1'
                    : 'hover:bg-muted/50 border-transparent',
                )}
                onclick={() => (selectedIndex = idx)}
              >
                <div class="flex items-start gap-3">
                  <Badge
                    variant={entry.type === 'user_action' ? 'secondary' : 'outline'}
                    class="mt-0.5 h-5 shrink-0 px-1.5 text-[10px]"
                  >
                    {entry.type === 'user_action' ? 'ACTION' : 'NARRATIVE'}
                  </Badge>
                  <span class="text-foreground/80 line-clamp-2 text-sm leading-relaxed">
                    {entry.content}
                  </span>
                </div>
              </button>
            {/each}
          </div>
        </ScrollArea>

        <div class="text-muted-foreground bg-muted/20 border-t px-4 py-2 text-xs">
          Chapter will include {selectedIndex + 1} of {entries.length} entries
        </div>
      {/if}
    </div>

    <ResponsiveModal.Footer class="mt-auto border-t px-4 py-4">
      <Button variant="outline" onclick={onClose}>Cancel</Button>
      <Button onclick={handleConfirm} disabled={entries.length === 0 || ui.memoryLoading}>
        {#if ui.memoryLoading}
          Creating...
        {:else}
          Create Chapter
        {/if}
      </Button>
    </ResponsiveModal.Footer>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
