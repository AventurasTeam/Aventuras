<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Textarea } from '$lib/components/ui/textarea'
  import * as Dialog from '$lib/components/ui/dialog'
  import { parseStoryTime, formatStoryTime, storyTimeIsInvalid } from '$lib/services/storyTime'
  import { entryNumber, resolveEntryByNumber } from '$lib/utils/storyNavigation'
  import type { StoryEntry } from '$lib/types'

  const NOTE_LIMIT = 140

  let {
    open = $bindable(false),
    /** Fixed when opened from an entry; left empty to be chosen when opened from the anchor list. */
    entryId = null,
  }: { open?: boolean; entryId?: string | null } = $props()

  let numberText = $state('')
  let timeText = $state('')
  let note = $state('')
  let saving = $state(false)

  const fixedEntry = $derived(
    entryId ? (story.entries.find((e) => e.id === entryId) ?? null) : null,
  )

  const typedEntry = $derived(
    numberText.trim() === '' ? null : resolveEntryByNumber(story.entries, numberText.trim()),
  )
  const chosenEntry = $derived<StoryEntry | null>(fixedEntry ?? typedEntry)

  /** An anchor asserts when an entry ended, and a player action has no ending to speak of. */
  const isAction = $derived(chosenEntry?.type === 'user_action')
  const usableEntry = $derived(chosenEntry && !isAction ? chosenEntry : null)

  const existing = $derived(usableEntry ? story.timeAnchorFor(usableEntry.id) : undefined)
  const parsedTime = $derived(parseStoryTime(timeText))
  const canSave = $derived(!!usableEntry && parsedTime !== null && !saving)

  /**
   * Fill the fields from whichever entry is in view, once per entry.
   *
   * Keyed on the entry rather than on opening, so choosing a different number in the add flow
   * re-seeds the time from that entry's recorded ending instead of leaving the previous one.
   */
  let seededFor = $state<string | null>(null)
  $effect(() => {
    if (!open) {
      seededFor = null
      return
    }
    const target = usableEntry
    const key = target?.id ?? null
    if (seededFor === key) return
    seededFor = key

    if (!target) {
      if (!fixedEntry) timeText = ''
      note = ''
      return
    }

    if (fixedEntry) numberText = String(entryNumber(target))
    const anchor = story.timeAnchorFor(target.id)
    const seed = anchor?.assertedTime ?? target.metadata?.timeEnd ?? null
    timeText = seed ? formatStoryTime(seed) : ''
    note = anchor?.note ?? ''
  })

  function recordedSpan(entry: StoryEntry): string {
    const start = entry.metadata?.timeStart
    const end = entry.metadata?.timeEnd
    if (!start && !end) return 'none recorded'
    if (start && end) {
      const from = formatStoryTime(start)
      const to = formatStoryTime(end)
      return from === to ? from : `${from} → ${to}`
    }
    return formatStoryTime(start ?? end!)
  }

  async function save() {
    if (!usableEntry || !parsedTime) return
    saving = true
    try {
      await story.setTimeAnchor(usableEntry.id, parsedTime, note.trim() || null)
      open = false
    } finally {
      saving = false
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg gap-4">
    <Dialog.Header>
      <Dialog.Title>{existing ? 'Edit an anchor' : 'Create an anchor'}</Dialog.Title>
      <Dialog.Description>
        A staple for the time reconciliation. Asserts when the entry ended. Does not change the
        recorded time.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 text-sm">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label class="flex items-center gap-2">
          <span class="text-muted-foreground shrink-0">Entry number:</span>
          {#if fixedEntry}
            <span class="font-medium">{entryNumber(fixedEntry)}</span>
          {:else}
            <!-- Text with a numeric keypad rather than a number input: the spinners are noise
                 at this size, and a stepper is no way to pick an entry out of hundreds. -->
            <Input
              inputmode="numeric"
              placeholder="e.g. 12"
              class="h-8 w-24 text-sm"
              bind:value={numberText}
            />
          {/if}
        </label>
        <span class="flex items-center gap-2">
          <span class="text-muted-foreground shrink-0">Recorded time:</span>
          <span class="font-medium">
            {chosenEntry ? recordedSpan(chosenEntry) : '—'}
          </span>
        </span>
      </div>

      <!-- Fixed height, so choosing a different entry does not resize the dialog under the cursor. -->
      <div class="h-10 overflow-hidden text-xs">
        {#if usableEntry}
          <blockquote class="border-border text-foreground/80 line-clamp-2 border-l-2 pl-2 italic">
            {usableEntry.content.trim().replace(/\s+/g, ' ')}
          </blockquote>
        {:else if isAction}
          <p class="text-destructive">
            Entry {chosenEntry ? entryNumber(chosenEntry) : ''} is a player action. An action is an instant,
            so there is no ending to anchor.
          </p>
        {:else if numberText.trim() !== ''}
          <p class="text-destructive">No entry with that number on this branch.</p>
        {:else}
          <p class="text-muted-foreground">Enter the number of the entry to anchor.</p>
        {/if}
      </div>

      <label class="flex items-center gap-2">
        <span class="text-muted-foreground shrink-0">Anchor time point:</span>
        <Input placeholder="e.g. Y1 D4 14:30" class="h-8 w-36 text-sm" bind:value={timeText} />
        <span class="text-muted-foreground shrink-0 text-xs">
          {#if parsedTime}
            = {formatStoryTime(parsedTime)}
          {:else}
            year, day, clock
          {/if}
        </span>
      </label>
      {#if storyTimeIsInvalid(timeText)}
        <p class="text-destructive -mt-2 text-xs">
          Not a story time. Try 14:30, D4 14:30, or Y1 D4 14:30.
        </p>
      {/if}

      <label class="flex items-start gap-2">
        <span class="text-muted-foreground mt-2 shrink-0">Note:</span>
        <span class="flex-1">
          <Textarea
            rows={2}
            autosize={false}
            maxlength={NOTE_LIMIT}
            placeholder="optional"
            class="h-14 w-full resize-none text-sm"
            bind:value={note}
          />
          <span class="text-muted-foreground mt-0.5 block text-right text-[10px]">
            {note.length}/{NOTE_LIMIT}
          </span>
        </span>
      </label>
    </div>

    <Dialog.Footer class="mt-2">
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button disabled={!canSave} onclick={save}>{saving ? 'Saving…' : 'Save'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
