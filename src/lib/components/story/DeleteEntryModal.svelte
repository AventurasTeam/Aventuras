<script lang="ts">
  import type { StoryEntry } from '#lib/types/index.ts'
  import { loreLine } from '#lib/services/stateTracking/index.ts'
  import { story, type RevertPreview } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { settings } from '#lib/stores/settings.svelte.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'
  import { errMessage } from '#lib/utils/error.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { Checkbox } from '#lib/components/ui/checkbox/index.ts'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { Loader2, Trash2, X } from '@lucide/svelte'
  import ChangeList from './ChangeList.svelte'

  let entry = $state<StoryEntry | null>(null)
  // What the revert would undo; null until known.
  let preview = $state<RevertPreview | null>(null)
  let deleting = $state(false)
  // Kept unless the reader unticks them: undoing their own work is the choice to make, not avoid.
  let keepManual = $state(true)
  let keepTidy = $state(true)
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
    keepManual = true
    keepTidy = true
    onlyThisEntry = false
    try {
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
        keep: { manual: keepManual, tidy: keepTidy },
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
          Revert on Delete is on: deleting this entry also undoes the world state changes associated
          with it.
        {:else if revertsOnDelete}
          Revert on Delete is on: deleting an entry also deletes every entry after it and undoes the
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
            Only entry {number} is deleted. The world state stays as it is.
          {:else if number === lastEntryNumber}
            Entry {number} is deleted.
          {:else}
            Entries {number} to {lastEntryNumber} are deleted.
          {/if}
        </p>
        {#if rollsBack && preview === null}
          <p class="text-muted-foreground text-xs italic">
            Checking the recorded world state changes…
          </p>
        {:else if rollsBack && preview}
          {@const line = loreLine(preview.lore, othersListed)}
          {#if line}
            <p class="text-muted-foreground text-sm">{line}</p>
          {/if}
          {#if othersListed}
            <p class="text-muted-foreground text-sm">The revert would also undo these changes:</p>
            {#if preview.manual.length > 0}
              <p class="text-muted-foreground text-xs">Changes you made by hand:</p>
              <ChangeList changes={preview.manual} unkeepable={preview.unkeepable} />
              <label class="flex items-center gap-2 text-xs">
                <Checkbox bind:checked={keepManual} disabled={deleting} />
                Keep them
              </label>
            {/if}
            {#if preview.tidy.length > 0}
              <p class="text-muted-foreground text-xs">Changes from lore management you ran:</p>
              <ChangeList changes={preview.tidy} unkeepable={preview.unkeepable} />
              <label class="flex items-center gap-2 text-xs">
                <Checkbox bind:checked={keepTidy} disabled={deleting} />
                Keep them
              </label>
            {/if}
          {/if}
        {/if}
      </div>
      <ResponsiveModal.Footer class="border-t px-6 py-4">
        <Button variant="secondary" size="sm" onclick={cancel} disabled={deleting} class="h-9 px-3">
          <X class="mr-1.5 h-4 w-4" />
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onclick={confirm}
          class="text-destructive can-hover:text-foreground h-9 px-3"
          disabled={(rollsBack && preview === null) || deleting}
        >
          {#if deleting}
            <Loader2 class="mr-1.5 h-4 w-4 animate-spin" />
          {:else}
            <Trash2 class="mr-1.5 h-4 w-4" />
          {/if}
          Delete
        </Button>
      </ResponsiveModal.Footer>
    </div>
  </ResponsiveModal.Content>
</ResponsiveModal.Root>
