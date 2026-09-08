<script lang="ts">
  import { story } from '$lib/stores/story.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Dialog from '$lib/components/ui/dialog'
  import { parseStoryTime, formatStoryTime, storyTimeIsInvalid } from '$lib/services/storyTime'
  import { entryNumber, resolveEntryByNumber } from '$lib/utils/storyNavigation'
  import type { StoryEntry } from '$lib/types'

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
  const chosenEntry = $derived<StoryEntry | null>(
    fixedEntry ?? resolveEntryByNumber(story.entries, Number(numberText)) ?? null,
  )
  const existing = $derived(chosenEntry ? story.timeAnchorFor(chosenEntry.id) : undefined)
  const parsedTime = $derived(parseStoryTime(timeText))
  const canSave = $derived(!!chosenEntry && parsedTime !== null && !saving)

  /** Seed the fields from whatever the dialog was opened on, once per opening. */
  let seededFor = $state<string | null>(null)
  $effect(() => {
    if (!open) {
      seededFor = null
      return
    }
    const key = entryId ?? 'free'
    if (seededFor === key) return
    seededFor = key

    numberText = fixedEntry ? String(entryNumber(fixedEntry)) : ''
    const anchor = fixedEntry ? story.timeAnchorFor(fixedEntry.id) : undefined
    const seed = anchor?.assertedTime ?? fixedEntry?.metadata?.timeEnd ?? null
    timeText = seed ? formatStoryTime(seed) : ''
    note = anchor?.note ?? ''
  })

  function excerpt(entry: StoryEntry): string {
    const text = entry.content.trim().replace(/\s+/g, ' ')
    return text.length > 160 ? `${text.slice(0, 160)}…` : text
  }

  async function save() {
    if (!chosenEntry || !parsedTime) return
    saving = true
    try {
      await story.setTimeAnchor(chosenEntry.id, parsedTime, note.trim() || null)
      open = false
    } finally {
      saving = false
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{existing ? 'Edit an anchor' : 'Create an anchor'}</Dialog.Title>
      <Dialog.Description>
        A staple for the time reconciliation. Asserts when the entry ended. Does not change the
        recorded time.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 text-sm">
      <div>
        <label class="flex items-center gap-2">
          <span class="text-muted-foreground w-28 shrink-0">Entry</span>
          {#if fixedEntry}
            <span class="font-medium">Entry {entryNumber(fixedEntry)}</span>
          {:else}
            <Input
              type="number"
              min="1"
              placeholder="number"
              class="h-8 w-28 text-sm"
              bind:value={numberText}
            />
          {/if}
        </label>

        <div class="mt-2 ml-30 text-xs">
          {#if chosenEntry}
            <span
              class="rounded px-1 text-[10px] tracking-wide uppercase {chosenEntry.type ===
              'user_action'
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary/10 text-primary'}"
            >
              {chosenEntry.type === 'user_action' ? 'You' : 'Story'}
            </span>
            <blockquote
              class="border-border text-foreground/80 mt-1 line-clamp-3 border-l-2 pl-2 italic"
            >
              {excerpt(chosenEntry)}
            </blockquote>
            <p class="text-muted-foreground mt-1">
              Recorded ending
              <span class="text-foreground">
                {chosenEntry.metadata?.timeEnd
                  ? formatStoryTime(chosenEntry.metadata.timeEnd)
                  : 'none'}
              </span>
            </p>
          {:else if numberText.trim() !== ''}
            <p class="text-destructive">No entry with that number on this branch.</p>
          {:else}
            <p class="text-muted-foreground">Enter the number of the entry to anchor.</p>
          {/if}
        </div>
      </div>

      <label class="flex items-center gap-2">
        <span class="text-muted-foreground w-28 shrink-0">Anchor time point</span>
        <Input placeholder="e.g. Y1 D4 14:30" class="h-8 w-48 text-sm" bind:value={timeText} />
        <span class="text-muted-foreground text-xs">
          {#if parsedTime}
            = {formatStoryTime(parsedTime)}
          {:else}
            year, day and clock time
          {/if}
        </span>
      </label>
      {#if storyTimeIsInvalid(timeText)}
        <p class="text-destructive ml-30 text-xs">
          Not a story time. Try 14:30, D4 14:30, or Y1 D4 14:30.
        </p>
      {/if}

      <label class="flex items-center gap-2">
        <span class="text-muted-foreground w-28 shrink-0">Note</span>
        <Input placeholder="optional" class="h-8 flex-1 text-sm" bind:value={note} />
      </label>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      <Button disabled={!canSave} onclick={save}>{saving ? 'Saving…' : 'Save'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
