<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import {
    KEEP_NONE,
    deletedChaptersLine,
    deletedSnapshotsLine,
    revertLines,
  } from '#lib/services/stateTracking/index.ts'
  import { story, type RevertPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Loader2, Trash2 } from '@lucide/svelte'
  import ChangeList from './ChangeList.svelte'

  let entry = $state<StoryEntry | null>(null)
  // What the revert would undo; null until known.
  let preview = $state<RevertPreview | null>(null)
  // Snapshot entry numbers removed from this entry on, and at this entry alone.
  let snapshots = $state<{ fromHere: number[]; here: number[] }>({ fromHere: [], here: [] })
  let deleting = $state(false)
  let onlyThisEntry = $state(false)

  const revertsOnDelete = $derived(
    settings.experimentalFeatures.stateTracking && settings.experimentalFeatures.rollbackOnDelete,
  )
  const rollsBack = $derived(revertsOnDelete && !onlyThisEntry)
  const lastEntryNumber = $derived(
    story.entries.length > 0 ? entryNumber(story.entries[story.entries.length - 1]) : 0,
  )
  const number = $derived(entry ? entryNumber(entry) : 0)
  const othersListed = $derived(!!preview && preview.manual.length + preview.tidy.length > 0)

  $effect(() => {
    const id = ui.deleteEntryId
    if (!id) return
    ui.requestEntryDelete(null)
    void open(id)
  })

  async function open(id: string) {
    const target = story.entries.find((e) => e.id === id)
    if (!target) return
    entry = target
    preview = null
    onlyThisEntry = false
    snapshots = { fromHere: [], here: [] }
    try {
      const [fromHere, here] = await Promise.all([
        story.snapshotsRemovedFrom(target.position),
        story.snapshotsRemovedFrom(target.position, target.id),
      ])
      snapshots = { fromHere, here }
      preview = await story.previewRevert(target.id)
    } catch (error) {
      console.error('[DeleteEntryModal] Could not preview the revert:', error)
      entry = null
      ui.showToast(`Could not check what deleting undoes: ${errMessage(error)}`, 'error')
    }
  }

  function cancel() {
    if (deleting) return
    entry = null
  }

  async function confirm() {
    if (!entry || deleting) return
    deleting = true
    try {
      await story.deleteEntry(entry.id, undefined, {
        keep: KEEP_NONE,
        rollback: !onlyThisEntry,
      })
    } catch (error) {
      console.error('[DeleteEntryModal] Failed to delete entry:', error)
      alert(errMessage(error))
    } finally {
      deleting = false
      entry = null
    }
  }
</script>

<!-- Modal: nothing may change while the revert it describes is being decided and run. -->
<ResponsiveModal.Root
  bind:open={
    () => entry !== null,
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
      <ResponsiveModal.Title>Delete entry {number}</ResponsiveModal.Title>
      <ResponsiveModal.Description>
        {#if revertsOnDelete && number === lastEntryNumber}
          Revert on Delete is on: deleting this entry will undo the world state changes associated
          with it.
        {:else if revertsOnDelete}
          Revert on Delete is on: deleting an entry will delete every entry after it and undo the
          world state changes recorded for them.
        {:else}
          Revert on Delete is off.
        {/if}
      </ResponsiveModal.Description>
      <!-- Below the description, so what it overrules is read before it is switched. -->
      {#if revertsOnDelete}
        <label class="mt-2 flex items-center gap-2 text-sm">
          <Switch bind:checked={onlyThisEntry} disabled={deleting} />
          Delete only this entry, without a rollback
        </label>
      {/if}
    </ResponsiveModal.Header>
    <!-- Buttons scroll with the content, so what they do is read before them. -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="space-y-3 px-6 py-4">
        <p class="text-muted-foreground text-sm">
          {#if !rollsBack}
            Only entry {number} will be deleted. The world state will stay as it is.
          {:else if number === lastEntryNumber}
            Entry {number} will be deleted.
          {:else}
            Entries {number} to {lastEntryNumber} will be deleted.
          {/if}
        </p>
        {#if !rollsBack}
          {@const gone = deletedSnapshotsLine(snapshots.here)}
          {#if gone}
            <p class="text-muted-foreground text-sm">{gone}</p>
          {/if}
        {/if}
        {#if rollsBack && preview === null}
          <p class="text-muted-foreground text-xs italic">
            Checking the recorded world state changes…
          </p>
        {:else if rollsBack && preview && entry}
          {@const deleted = deletedChaptersLine(story.chaptersRemovedFrom(entry.position))}
          {@const gone = deletedSnapshotsLine(snapshots.fromHere)}
          {@const lines = [
            ...(deleted ? [deleted] : []),
            ...(gone ? [gone] : []),
            ...revertLines(preview.classifier, preview.lore),
          ]}
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
            disabled={(rollsBack && preview === null) || deleting}
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
