<script lang="ts">
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ExplanationFold from '#lib/components/shared/ExplanationFold.svelte'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import {
    parseStoryTime,
    formatStoryTime,
    storyTimeIsInvalid,
    toMinutes,
  } from '#lib/services/storyTime/index.ts'
  import { entryNumber } from '#lib/utils/storyNavigation.ts'

  let { open = $bindable(false), entryId }: { open?: boolean; entryId: string } = $props()

  let startText = $state('')
  let endText = $state('')
  let seededStart = $state('')
  let seededEnd = $state('')
  let saving = $state(false)
  let endField = $state<HTMLInputElement | null>(null)

  const entry = $derived(story.entries.find((candidate) => candidate.id === entryId) ?? null)
  const start = $derived(parseStoryTime(startText))
  const end = $derived(parseStoryTime(endText))
  const isLastEntry = $derived(!!entry && story.entries[story.entries.length - 1]?.id === entry.id)
  const backwards = $derived(!!start && !!end && toMinutes(end) < toMinutes(start))
  const canSave = $derived(!!start && !!end && !backwards && !saving)
  const dirty = $derived(startText !== seededStart || endText !== seededEnd)

  /** `setEntryTimes` carries it along: an action is the instant the narration after it answers. */
  const precedingAction = $derived.by(() => {
    const index = story.entries.findIndex((candidate) => candidate.id === entryId)
    return index > 0 && story.entries[index - 1].type === 'user_action'
  })

  const checkpointHere = $derived(
    story.checkpoints.find((checkpoint) => checkpoint.lastEntryId === entryId) ?? null,
  )
  const forkCount = $derived(story.branchesForkedFrom(checkpointHere?.id ?? null, entryId))

  /** Reset on every opening: what it says depends on the entry, so a fold cannot carry over. */
  let noticeOpen = $state(true)

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
    seededStart = startText
    seededEnd = endText
    noticeOpen = true
  })

  /** An edit is saved only through Save, so Enter moves on or drops the keyboard. */
  function handleEnter(e: KeyboardEvent, next: HTMLElement | null) {
    if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    if (next) next.focus()
    else (e.currentTarget as HTMLElement).blur()
  }

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

<ActionModal
  bind:open
  size="lg"
  title={entry ? `Edit the time of entry ${entryNumber(entry)}` : 'Edit the recorded time'}
  action={{ label: 'Save', disabled: !canSave, onConfirm: () => void save() }}
  busy={saving}
  {dirty}
>
  <!-- The header stays pinned, so the folds, which open long, sit here with the fields. -->
  <ExplanationFold id="entry_time_help" summary="What this changes">
    <p>
      Rewrites what entry {entry ? entryNumber(entry) : '?'} records for itself{precedingAction
        ? `, and moves the action before it to the same instant`
        : ''}. Chapter spans covering it and the clock kept for rollback are updated to match the
      new value. No other entry moves. This action may create a time gap or overlapping. A
      reconciliation run is advised to get rid of undesired anomalies.
    </p>
  </ExplanationFold>
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
            The checkpoint “{checkpointHere.name}” was taken here, and its clock is updated with the
            new ending. Nothing has been forked from it yet, so no other branch is affected.
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
        data-autofocus
        enterkeyhint="next"
        onkeydown={(e) => handleEnter(e, endField)}
        placeholder="Y1 D4 14:30"
        class="mt-1 h-8 text-sm {storyTimeIsInvalid(startText) ? 'border-destructive' : ''}"
      />
    </label>
    <label class="text-xs">
      Ends
      <Input
        bind:ref={endField}
        bind:value={endText}
        enterkeyhint="done"
        onkeydown={(e) => handleEnter(e, null)}
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
</ActionModal>
