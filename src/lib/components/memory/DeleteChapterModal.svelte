<script lang="ts">
  import type { Chapter } from '#lib/types/index.ts'
  import { deletedSnapshotsLine } from '#lib/services/stateTracking/index.ts'
  import { story, type ChapterLorePreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import { Trash2 } from '@lucide/svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ChangeList from '#lib/components/story/ChangeList.svelte'
  import RevertSummary from '#lib/components/story/RevertSummary.svelte'

  let chapter = $state<Chapter | null>(null)
  // What undoing the chapter's lore would undo; null until known.
  let preview = $state<ChapterLorePreview | null>(null)
  let deleting = $state(false)
  let undoLore = $state(true)

  const offered = $derived(preview?.refusal === null)
  const span = $derived.by(() => {
    if (!chapter) return ''
    const first = story.entryNumberOf(chapter.startEntryId)
    const last = story.entryNumberOf(chapter.endEntryId)
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

<ActionModal
  open={chapter !== null}
  onCancel={cancel}
  action={{
    label: 'Delete',
    icon: Trash2,
    tone: 'delete',
    disabled: preview === null || preview.refusal === 'inherited',
    onConfirm: confirm,
  }}
  busy={deleting}
  title={`Delete chapter ${chapter?.number ?? ''}${chapter?.title ? `: ${chapter.title}` : ''}`}
>
  {#snippet description()}
    Its entries will remain, and the summary will be lost.
  {/snippet}
  {#if offered}
    <label class="flex items-center gap-2 text-sm">
      <Switch bind:checked={undoLore} disabled={deleting} />
      Undo this chapter's lore management
    </label>
  {/if}
  {#if preview === null}
    <p class="text-muted-foreground text-xs italic">Checking the recorded lore changes…</p>
  {:else if offered && undoLore}
    {@const gone = deletedSnapshotsLine(preview.snapshots)}
    <div class="space-y-1">
      <p class="text-muted-foreground text-sm">
        Lore management changes of chapter {chapter?.number}{span} will be reverted, and removed from
        the recorded history with every change listed here.
      </p>
      {#if gone}
        <p class="text-muted-foreground text-sm">{gone}</p>
      {/if}
      <ChangeList changes={preview.undone} />
    </div>
    <RevertSummary
      heading="Later changes to the same entries will be reverted too:"
      manual={preview.manual}
      tidy={preview.tidy}
      deletedChapters={preview.deletedChapters}
    />
  {:else if offered}
    <div class="space-y-1">
      <p class="text-muted-foreground text-sm">
        Lore management changes of chapter {chapter?.number}{span} will stay in the lorebook:
      </p>
      <ChangeList changes={preview.undone} />
    </div>
  {:else}
    <p class="text-muted-foreground text-sm">
      {preview.refusal === 'interrupted' || preview.refusal === 'untracked'
        ? "The chapter's lore will stay in the lorebook: changes made since it may not have been recorded."
        : preview.refusal === 'forked'
          ? "The chapter's lore will stay in the lorebook: a branch forked after it inherits that lore."
          : preview.refusal === 'inherited'
            ? 'This chapter was cut on another branch, and can only be deleted there.'
            : 'No lore management changes were recorded for this chapter.'}
    </p>
  {/if}
</ActionModal>
