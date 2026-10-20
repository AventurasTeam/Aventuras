<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import {
    KEEP_NONE,
    deletedChaptersLine,
    deletedSnapshotsLine,
    revertLines,
    type LoreChapter,
    type RevertKeep,
  } from '#lib/services/stateTracking/index.ts'
  import { story, type RevertPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { RotateCcw } from '@lucide/svelte'
  import ChangeList from './ChangeList.svelte'

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

  function regenerate(entryId: string, retry: boolean, keep?: RevertKeep) {
    if (retry) void ui.triggerRetryLastMessage(keep)
    else void ui.triggerRegenerateNarration(entryId, keep)
  }

  async function start(entryId: string, retry: boolean) {
    const entry = story.entries.find((e) => e.id === entryId)
    if (!entry) return
    const position = retry ? ui.retryBackup?.entryCountBeforeAction : entry.position
    let preview: RevertPreview | null = null
    try {
      if (position !== undefined) preview = await story.previewRegenerate(position)
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
      regenerate(entryId, retry, KEEP_NONE)
      return
    }
    // Removing the entries takes their snapshots with them; worth saying, not worth asking about.
    const snapshots = position !== undefined ? await story.snapshotsRemovedFrom(position) : []
    pending = { entry, retry, preview, chapters, snapshots }
  }

  function confirm() {
    if (!pending) return
    const { entry, retry } = pending
    pending = null
    regenerate(entry.id, retry, KEEP_NONE)
  }
</script>

<ResponsiveModal.Root
  bind:open={
    () => pending !== null,
    (next) => {
      if (!next) pending = null
    }
  }
>
  <ResponsiveModal.Content
    class="flex max-h-[85dvh] max-w-md flex-col gap-0 p-0"
    interactOutsideBehavior="ignore"
  >
    {#if pending}
      {@const preview = pending.preview}
      {@const othersListed = preview.manual.length + preview.tidy.length > 0}
      {@const deleted = deletedChaptersLine(pending.chapters)}
      {@const gone = deletedSnapshotsLine(pending.snapshots)}
      {@const lines = [
        ...(deleted ? [deleted] : []),
        ...(gone ? [gone] : []),
        ...revertLines(preview.classifier, preview.lore),
      ]}
      <ResponsiveModal.Header class="border-b px-6 py-4" closeButton={false}>
        <ResponsiveModal.Title>Regenerate entry {entryNumber(pending.entry)}</ResponsiveModal.Title>
        <ResponsiveModal.Description>
          {settings.experimentalFeatures.stateTracking
            ? 'Regenerating this entry will undo the world state changes recorded for it.'
            : 'Regenerating this entry will replace it.'}
        </ResponsiveModal.Description>
      </ResponsiveModal.Header>
      <!-- Buttons scroll with the content, so what they do is read before them. -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="space-y-3 px-6 py-4">
          {#if lines.length > 0}
            <div class="space-y-1">
              {#each lines as line, i (i)}
                <p class="text-muted-foreground text-sm">{line}</p>
              {/each}
            </div>
          {/if}
          {#if othersListed}
            <div class="space-y-1">
              <p class="text-muted-foreground text-sm">These changes will be reverted too:</p>
              {#if preview.manual.length > 0}
                <p class="text-muted-foreground text-xs">Changes you made by hand:</p>
                <ChangeList changes={preview.manual} unkeepable={[]} />
              {/if}
              {#if preview.tidy.length > 0}
                <p class="text-muted-foreground text-xs">Changes from lore management you ran:</p>
                <ChangeList changes={preview.tidy} unkeepable={[]} />
              {/if}
            </div>
          {/if}
        </div>
        <ResponsiveModal.Footer class="border-t px-6 py-4">
          <span class="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" class="flex-1 sm:flex-none" onclick={() => (pending = null)}>
              Cancel
            </Button>
            <Button onclick={confirm} class="flex-1 sm:flex-none">
              <RotateCcw class="h-4 w-4" />
              Regenerate
            </Button>
          </span>
        </ResponsiveModal.Footer>
      </div>
    {/if}
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
