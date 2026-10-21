<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import {
    KEEP_NONE,
    deletedSnapshotsLine,
    removalLines,
  } from '#lib/services/stateTracking/index.ts'
  import { story, type RevertPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Trash2 } from '@lucide/svelte'
  import ModalActions from '#lib/components/shared/ModalActions.svelte'
  import RevertSummary from './RevertSummary.svelte'

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
      const [removed, revert] = await Promise.all([
        story.snapshotsRemovedFrom(target.position, target.id),
        story.previewRevert(target.id),
      ])
      snapshots = removed
      preview = revert
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
          <RevertSummary
            lines={removalLines(
              story.chaptersRemovedFrom(entry.position),
              snapshots.fromHere,
              preview.classifier,
              preview.lore,
            )}
            heading="These changes will be reverted too:"
            manual={preview.manual}
            tidy={preview.tidy}
          />
        {/if}
      </div>
      <ModalActions
        label="Delete"
        icon={Trash2}
        tone="danger"
        onCancel={cancel}
        onConfirm={confirm}
        busy={deleting}
        disabled={preview === null}
      />
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
