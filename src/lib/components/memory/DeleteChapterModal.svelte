<script lang="ts">
  import type { Chapter } from '#lib/types/index.ts'
  import { deletedSnapshotsLine } from '#lib/services/stateTracking/index.ts'
  import { story, type ChapterLorePreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Loader2, Trash2 } from '@lucide/svelte'
  import ChangeList from '#lib/components/story/ChangeList.svelte'

  let chapter = $state<Chapter | null>(null)
  // What undoing the chapter's lore would undo; null until known.
  let preview = $state<ChapterLorePreview | null>(null)
  let deleting = $state(false)
  let undoLore = $state(true)

  const offered = $derived(preview?.refusal === null)
  const span = $derived.by(() => {
    if (!chapter) return ''
    const at = (id: string) => {
      const entry = story.entries.find((e) => e.id === id)
      return entry ? entryNumber(entry) : null
    }
    const first = at(chapter.startEntryId)
    const last = at(chapter.endEntryId)
    return first !== null && last !== null ? ` (entries ${first}–${last})` : ''
  })

  $effect(() => {
    const id = ui.deleteChapterId
    if (!id) return
    ui.requestChapterDelete(null)
    void open(id)
  })

  async function open(id: string) {
    const target = story.chapters.find((ch) => ch.id === id)
    if (!target) return
    chapter = target
    preview = null
    undoLore = true
    try {
      preview = await story.previewChapterLoreUndo(target.id)
    } catch (error) {
      console.error('[DeleteChapterModal] Could not preview the lore undo:', error)
      chapter = null
      ui.showToast(`Could not check what deleting undoes: ${errMessage(error)}`, 'error')
    }
  }

  function cancel() {
    if (deleting) return
    chapter = null
  }

  async function confirm() {
    if (!chapter || deleting) return
    deleting = true
    try {
      await story.deleteChapter(chapter.id, { undoLore: offered && undoLore })
    } catch (error) {
      console.error('[DeleteChapterModal] Failed to delete chapter:', error)
      ui.showToast(errMessage(error), 'error')
    } finally {
      deleting = false
      chapter = null
    }
  }
</script>

<ResponsiveModal.Root
  bind:open={
    () => chapter !== null,
    (next) => {
      if (!next) cancel()
    }
  }
  dismissible={!deleting}
>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] max-w-md flex-col gap-0 p-0"
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior={deleting ? 'ignore' : 'close'}
  >
    <ResponsiveModal.Header class="border-b px-6 py-4" closeButton={false}>
      <ResponsiveModal.Title>
        Delete chapter {chapter?.number}{chapter?.title ? `: ${chapter.title}` : ''}
      </ResponsiveModal.Title>
      <ResponsiveModal.Description>
        Its entries will remain, and the summary will be lost.
      </ResponsiveModal.Description>
      {#if offered}
        <label class="mt-2 flex items-center gap-2 text-sm">
          <Switch bind:checked={undoLore} disabled={deleting} />
          Undo this chapter's lore management
        </label>
      {/if}
    </ResponsiveModal.Header>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="space-y-3 px-6 py-4">
        {#if preview === null}
          <p class="text-muted-foreground text-xs italic">Checking the recorded lore changes…</p>
        {:else if offered && undoLore}
          {@const gone = deletedSnapshotsLine(preview.snapshots)}
          <div class="space-y-1">
            <p class="text-muted-foreground text-sm">
              Lore management changes of chapter {chapter?.number}{span} will be reverted, and removed
              from the recorded history with every change listed here.
            </p>
            {#if gone}
              <p class="text-muted-foreground text-sm">{gone}</p>
            {/if}
            <ChangeList changes={preview.undone} unkeepable={[]} />
          </div>
          {#if preview.manual.length + preview.tidy.length + preview.deletedChapters.length > 0}
            <div class="space-y-1">
              <p class="text-muted-foreground text-sm">
                Later changes to the same entries will be reverted too:
              </p>
              {#if preview.manual.length > 0}
                <p class="text-muted-foreground text-xs">Changes you made by hand:</p>
                <ChangeList changes={preview.manual} unkeepable={[]} />
              {/if}
              {#if preview.tidy.length > 0}
                <p class="text-muted-foreground text-xs">Changes from lore management you ran:</p>
                <ChangeList changes={preview.tidy} unkeepable={[]} />
              {/if}
              {#if preview.deletedChapters.length > 0}
                <p class="text-muted-foreground text-xs">
                  Changes from a deleted chapter's lore management:
                </p>
                <ChangeList changes={preview.deletedChapters} unkeepable={[]} />
              {/if}
            </div>
          {/if}
        {:else if offered}
          <div class="space-y-1">
            <p class="text-muted-foreground text-sm">
              Lore management changes of chapter {chapter?.number}{span} will stay in the lorebook:
            </p>
            <ChangeList changes={preview.undone} unkeepable={[]} />
          </div>
        {:else}
          <p class="text-muted-foreground text-sm">
            {preview.refusal === 'interrupted' || preview.refusal === 'untracked'
              ? "The chapter's lore will stay in the lorebook: changes made since it may not have been recorded."
              : 'No lore management changes were recorded for this chapter.'}
          </p>
        {/if}
      </div>
      <ResponsiveModal.Footer class="border-t px-6 py-4">
        <span class="flex w-full gap-2 sm:w-auto">
          <Button
            variant="outline"
            class="flex-1 sm:flex-none"
            onclick={cancel}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onclick={confirm}
            class="can-hover:text-foreground flex-1 text-red-500 hover:text-red-500 sm:flex-none"
            disabled={preview === null || deleting}
          >
            {#if deleting}
              <Loader2 class="h-4 w-4 animate-spin" />
            {:else}
              <Trash2 class="h-4 w-4" />
            {/if}
            Delete
          </Button>
        </span>
      </ResponsiveModal.Footer>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
