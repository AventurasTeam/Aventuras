<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Dialog from '$lib/components/ui/dialog'
  import { parseStoryTime, formatStoryTime, storyTimeIsInvalid } from '$lib/services/storyTime'
  import { entryNumber } from '$lib/utils/storyNavigation'

  let { open = $bindable(false), entryId }: { open?: boolean; entryId: string } = $props()

  let startText = $state('')
  let endText = $state('')
  let saving = $state(false)

  const entry = $derived(story.entries.find((candidate) => candidate.id === entryId) ?? null)
  const start = $derived(parseStoryTime(startText))
  const end = $derived(parseStoryTime(endText))
  const isLastEntry = $derived(!!entry && story.entries[story.entries.length - 1]?.id === entry.id)
  const canSave = $derived(!!start && !!end && !saving)

  /** Seeded once per opening: the fields are the reader's working copy, not a live view. */
  let seeded = false
  $effect(() => {
    if (!open) {
      seeded = false
      return
    }
    if (seeded) return
    seeded = true
    const metadata = entry?.metadata
    startText = metadata?.timeStart ? formatStoryTime(metadata.timeStart) : ''
    endText = metadata?.timeEnd ? formatStoryTime(metadata.timeEnd) : ''
  })

  async function save() {
    if (!start || !end) return
    saving = true
    try {
      await story.setEntryTimes(entryId, start, end)
      open = false
    } finally {
      saving = false
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg gap-4">
    <Dialog.Header>
      <Dialog.Title>Edit the recorded time</Dialog.Title>
      <Dialog.Description>
        Rewrites what entry {entry ? entryNumber(entry) : '?'} records for itself. Chapter spans and the
        clocks kept for rollback follow it. Nothing else in the timeline moves.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-xs">
        Begins
        <Input
          bind:value={startText}
          placeholder="Y1 D4 14:30"
          class="mt-1 h-8 text-sm {storyTimeIsInvalid(startText) ? 'border-destructive' : ''}"
        />
      </label>
      <label class="text-xs">
        Ends
        <Input
          bind:value={endText}
          placeholder="Y1 D4 16:00"
          class="mt-1 h-8 text-sm {storyTimeIsInvalid(endText) ? 'border-destructive' : ''}"
        />
      </label>
      {#if storyTimeIsInvalid(startText) || storyTimeIsInvalid(endText)}
        <p class="text-destructive text-xs sm:col-span-2">
          Give both as Y1 D4 14:30. An unreadable time is left as it was.
        </p>
      {:else if isLastEntry}
        <p class="text-muted-foreground text-xs sm:col-span-2">
          This is the last entry, so the story's current time moves to its ending.
        </p>
      {/if}
    </div>

    <Dialog.Footer class="mt-2">
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button disabled={!canSave} onclick={save}>{saving ? 'Saving…' : 'Save'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
