<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import { KEEP_NONE, removalLines, type LoreChapter } from '#lib/services/stateTracking/index.ts'
  import { story, type RevertPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { RotateCcw } from '@lucide/svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import RevertSummary from './RevertSummary.svelte'

  // Set only while the reader decides: a regenerate with nothing to decide runs at once.
  let pending = $state<{
    entry: StoryEntry
    retry: boolean
    preview: RevertPreview
    chapters: LoreChapter[]
    snapshots: number[]
  } | null>(null)

  $effect(() => {
    const request = ui.regenerateRequest
    if (!request) return
    ui.requestRegenerate(null)
    void start(request.entryId, request.retry)
  })

  // A regenerate the reader confirms keeps none of their or Tidy's changes in its range.
  function regenerate(entryId: string, retry: boolean) {
    if (retry) void ui.triggerRetryLastMessage(KEEP_NONE)
    else void ui.triggerRegenerateNarration(entryId, KEEP_NONE)
  }

  async function start(entryId: string, retry: boolean) {
    const entry = story.entries.find((e) => e.id === entryId)
    if (!entry) return
    const position = retry ? ui.retryBackup?.entryCountBeforeAction : entry.position
    let preview: RevertPreview | null = null
    // Removing the entries takes their snapshots with them; worth saying, not worth asking about.
    let snapshots: number[] = []
    try {
      if (position !== undefined) {
        const [revert, removed] = await Promise.all([
          story.previewRegenerate(position),
          story.snapshotsRemovedFrom(position),
        ])
        preview = revert
        snapshots = removed.fromHere
      }
    } catch (error) {
      console.error('[RegenerateEntryModal] Could not preview the regenerate:', error)
      ui.showToast(`Could not check what regenerating undoes: ${errMessage(error)}`, 'error')
      return
    }
    // A chapter starting or ending on a removed entry goes with it, recorded or not.
    const chapters = position !== undefined ? story.chaptersRemovedFrom(position) : []
    const toDecide =
      !!preview && preview.manual.length + preview.tidy.length + preview.lore.length > 0
    if (!preview || (!toDecide && chapters.length === 0)) {
      regenerate(entryId, retry)
      return
    }
    pending = { entry, retry, preview, chapters, snapshots }
  }

  function confirm() {
    if (!pending) return
    const { entry, retry } = pending
    pending = null
    regenerate(entry.id, retry)
  }
</script>

<ActionModal
  open={pending !== null}
  onCancel={() => (pending = null)}
  action={{ label: 'Regenerate', icon: RotateCcw, tone: 'regenerate', onConfirm: confirm }}
  title={pending ? `Regenerate entry ${entryNumber(pending.entry)}` : 'Regenerate entry'}
>
  {#snippet description()}
    {settings.experimentalFeatures.stateTracking
      ? 'Regenerating this entry will undo the world state changes recorded for it.'
      : 'Regenerating this entry will replace it.'}
  {/snippet}
  {#if pending}
    {@const preview = pending.preview}
    <RevertSummary
      lines={removalLines(pending.chapters, pending.snapshots, preview.classifier, preview.lore)}
      heading="These changes will be reverted too:"
      manual={preview.manual}
      tidy={preview.tidy}
    />
  {/if}
</ActionModal>
