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
  import { Trash2 } from '@lucide/svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
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
<ActionModal
  open={entry !== null}
  onCancel={cancel}
  action={{
    label: 'Delete',
    icon: Trash2,
    tone: 'delete',
    disabled: preview === null,
    onConfirm: confirm,
  }}
  busy={deleting}
  title={`Delete entry ${number}`}
>
  <!-- The setting comes first, so what the switch overrules is read before it is switched. -->
  <p class="text-muted-foreground text-sm">
    {#if revertsOnDelete && number === lastEntryNumber}
      Revert on Delete is on: deleting this entry will undo the world state changes associated with
      it.
    {:else if revertsOnDelete}
      Revert on Delete is on: deleting an entry will delete every entry after it and undo the world
      state changes recorded for them.
    {:else}
      Revert on Delete is off.
    {/if}
  </p>
  {#if revertsOnDelete}
    <label class="flex items-center gap-2 text-sm">
      <Switch bind:checked={onlyThisEntry} disabled={deleting} />
      Delete only this entry, without a rollback
    </label>
  {/if}
  <!-- Says only what the title does not; "Only" sets the switch apart from the range it overrules. -->
  {#if !rollsBack}
    <p class="text-muted-foreground text-sm">
      {revertsOnDelete ? `Only entry ${number} will be deleted. ` : ''}The world state will stay as
      it is.
    </p>
  {:else if number !== lastEntryNumber}
    <p class="text-muted-foreground text-sm">
      Entries {number} to {lastEntryNumber} will be deleted.
    </p>
  {/if}
  {#if !rollsBack}
    {@const gone = deletedSnapshotsLine(snapshots.here)}
    {#if gone}
      <p class="text-muted-foreground text-sm">{gone}</p>
    {/if}
  {/if}
  {#if rollsBack && preview === null}
    <p class="text-muted-foreground text-xs italic">Checking the recorded world state changes…</p>
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
</ActionModal>
