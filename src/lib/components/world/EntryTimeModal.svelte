<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { ui } from '$lib/stores/ui.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Dialog from '$lib/components/ui/dialog'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import {
    parseStoryTime,
    formatStoryTime,
    storyTimeIsInvalid,
    toMinutes,
  } from '$lib/services/storyTime'
  import { entryNumber } from '$lib/utils/storyNavigation'

  const DESCRIPTION_FOLD_KEY = 'aventuras.entryTime.descriptionFolded'

  let { open = $bindable(false), entryId }: { open?: boolean; entryId: string } = $props()

  let startText = $state('')
  let endText = $state('')
  let saving = $state(false)

  const entry = $derived(story.entries.find((candidate) => candidate.id === entryId) ?? null)
  const start = $derived(parseStoryTime(startText))
  const end = $derived(parseStoryTime(endText))
  const isLastEntry = $derived(!!entry && story.entries[story.entries.length - 1]?.id === entry.id)
  const backwards = $derived(!!start && !!end && toMinutes(end) < toMinutes(start))
  const canSave = $derived(!!start && !!end && !backwards && !saving)

  /** `setEntryTimes` carries it along: an action is the instant the narration after it answers. */
  const precedingAction = $derived.by(() => {
    const index = story.entries.findIndex((candidate) => candidate.id === entryId)
    return index > 0 && story.entries[index - 1].type === 'user_action'
  })

  const checkpointHere = $derived(
    story.checkpoints.find((checkpoint) => checkpoint.lastEntryId === entryId) ?? null,
  )
  const forkCount = $derived(story.branchesForkedFrom(checkpointHere?.id ?? null, entryId))

  /** The reader's own reading habit, not this entry's: kept across dialogs and sessions. */
  let descriptionOpen = $state(true)
  /** Reset on every opening: what it says depends on the entry, so a fold cannot carry over. */
  let noticeOpen = $state(true)

  function toggleDescription() {
    descriptionOpen = !descriptionOpen
    try {
      localStorage.setItem(DESCRIPTION_FOLD_KEY, descriptionOpen ? 'open' : 'folded')
    } catch {
      // Private mode or blocked storage: the fold is a convenience, not state to insist on.
    }
  }

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
    noticeOpen = true
    try {
      descriptionOpen = localStorage.getItem(DESCRIPTION_FOLD_KEY) !== 'folded'
    } catch {
      descriptionOpen = true
    }
  })

  async function save() {
    if (!start || !end) return
    saving = true
    try {
      await story.setEntryTimes(entryId, start, end)
      open = false
    } catch (error) {
      ui.showToast(error instanceof Error ? error.message : 'The time could not be saved', 'error')
    } finally {
      saving = false
    }
  }
</script>

{#snippet foldIcon(isOpen: boolean)}
  {#if isOpen}
    <ChevronDown class="h-3 w-3 shrink-0" />
  {:else}
    <ChevronRight class="h-3 w-3 shrink-0" />
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg gap-4">
    <Dialog.Header>
      <Dialog.Title>Edit the recorded time</Dialog.Title>
      <Dialog.Description>
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-xs"
          aria-expanded={descriptionOpen}
          onclick={toggleDescription}
        >
          {@render foldIcon(descriptionOpen)}
          What this changes
        </button>
        {#if descriptionOpen}
          <span class="mt-1 block">
            Rewrites what entry {entry ? entryNumber(entry) : '?'} records for itself{precedingAction
              ? `, and moves the action before it to the same instant`
              : ''}. Chapter spans covering it and the clock kept for rollback are updated to match
            the new value. No other entry moves. This action may create a time gap or overlapping. A
            reconciliation run is advised to get rid of undesired anomalies.
          </span>
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    {#if checkpointHere}
      <div class="text-muted-foreground">
        <button
          type="button"
          class="hover:text-foreground flex items-center gap-1 text-xs"
          aria-expanded={noticeOpen}
          onclick={() => (noticeOpen = !noticeOpen)}
        >
          {@render foldIcon(noticeOpen)}
          {forkCount > 0 ? 'This entry is a fork point' : 'This entry carries a checkpoint'}
        </button>
        {#if noticeOpen}
          <p class="text-foreground mt-1 text-sm">
            {#if forkCount > 0}
              {forkCount === 1 ? 'A branch was' : `${forkCount} branches were`} forked from entry {entry
                ? entryNumber(entry)
                : '?'}, and the checkpoint “{checkpointHere.name}” holds the clock
              {forkCount === 1 ? 'it opens' : 'they open'} on, which this edit updates too. The edit affects
              {forkCount + 2} intervals: the one ending at this entry, the one continuing on this branch,
              and the one starting on {forkCount === 1
                ? 'the branch'
                : `each of the ${forkCount} 
              branches`} forked here. Running a reconciliation over each of them afterwards is advised.
            {:else}
              The checkpoint “{checkpointHere.name}” was taken here, and its clock is updated with
              the new ending. Nothing has been forked from it yet, so no other branch is affected.
            {/if}
          </p>
        {/if}
      </div>
    {/if}

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
      {:else if backwards}
        <p class="text-destructive text-xs sm:col-span-2">The entry cannot end before it begins.</p>
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
