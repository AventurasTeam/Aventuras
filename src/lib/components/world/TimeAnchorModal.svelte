<script lang="ts">
  import { untrack } from 'svelte'
  import { story } from '#lib/stores/story.svelte.ts'
  import { ui } from '#lib/stores/ui.svelte.ts'
  import { Input } from '#lib/components/ui/input/index.ts'
  import { Textarea } from '#lib/components/ui/textarea/index.ts'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ExplanationFold from '#lib/components/shared/ExplanationFold.svelte'
  import StoryTimeField from '#lib/components/shared/StoryTimeField.svelte'
  import { Label } from '#lib/components/ui/label/index.ts'
  import { parseStoryTime, formatStoryTime } from '#lib/services/storyTime/index.ts'
  import { entryNumber, resolveEntryByNumber } from '#lib/utils/storyNavigation.ts'
  import type { StoryEntry } from '#lib/types/index.ts'

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
  let timeField = $state<HTMLInputElement | null>(null)
  let noteField = $state<HTMLTextAreaElement | null>(null)
  let seeded = $state({ number: '', time: '', note: '' })

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
  const dirty = $derived(
    numberText !== seeded.number || timeText !== seeded.time || note !== seeded.note,
  )

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
      numberText = ''
      seeded = { number: '', time: '', note: '' }
      return
    }
    const target = usableEntry
    const key = target?.id ?? null
    if (seededFor === key) return
    seededFor = key

    if (!target) {
      if (!fixedEntry) timeText = ''
      note = ''
      seeded = { number: untrack(() => seeded.number), time: timeText, note }
      return
    }

    if (fixedEntry) numberText = String(entryNumber(target))
    const anchor = story.timeAnchorFor(target.id)
    const seed = anchor?.assertedTime ?? target.metadata?.timeEnd ?? null
    timeText = seed ? formatStoryTime(seed) : ''
    note = anchor?.note ?? ''
    seeded = {
      number: fixedEntry ? numberText : untrack(() => seeded.number),
      time: timeText,
      note,
    }
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

  async function remove() {
    if (!usableEntry) return
    saving = true
    try {
      await story.removeTimeAnchor(usableEntry.id)
      open = false
    } catch (error) {
      ui.showToast(
        error instanceof Error ? error.message : 'The anchor could not be deleted',
        'error',
      )
    } finally {
      saving = false
    }
  }

  async function save() {
    if (!usableEntry || !parsedTime) return
    saving = true
    try {
      await story.setTimeAnchor(usableEntry.id, parsedTime, note.trim() || null)
      open = false
    } catch (error) {
      ui.showToast(
        error instanceof Error ? error.message : 'The anchor could not be saved',
        'error',
      )
    } finally {
      saving = false
    }
  }

  /** The anchor is saved only through Save, so Enter in a single-line field moves on. */
  function moveOn(e: KeyboardEvent, next: HTMLElement | null) {
    if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    next?.focus()
  }
</script>

<ActionModal
  bind:open
  size="lg"
  title={existing && usableEntry
    ? `Edit the anchor on entry ${entryNumber(usableEntry)}`
    : usableEntry
      ? `Create an anchor on entry ${entryNumber(usableEntry)}`
      : 'Create an anchor'}
  action={{ label: 'Save', disabled: !canSave, onConfirm: () => void save() }}
  busy={saving}
  {dirty}
  removal={existing && usableEntry
    ? {
        label: 'Delete this anchor',
        question: {
          title: 'Delete the anchor?',
          description: `The time you asserted on entry ${entryNumber(usableEntry)} is not recorded anywhere else.`,
          keepLabel: 'Keep anchor',
          confirmLabel: 'Delete anchor',
        },
        onRemove: () => void remove(),
      }
    : undefined}
>
  <ExplanationFold id="time_anchor_help" summary="What an anchor does">
    <p>
      A point of reference for the time reconciliation. Asserts when the entry ended. Does not
      change the recorded time.
    </p>
  </ExplanationFold>
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
            data-autofocus
            enterkeyhint="next"
            onkeydown={(e) => moveOn(e, timeField)}
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

    <StoryTimeField
      label="Anchor time point"
      placeholder="e.g. Y1 D4 14:30"
      bind:ref={timeField}
      bind:value={timeText}
      data-autofocus={fixedEntry ? true : undefined}
      enterkeyhint="next"
      onkeydown={(e: KeyboardEvent) => moveOn(e, noteField)}
    />

    <div class="flex flex-col gap-1">
      <Label for="time-anchor-note" class="text-xs">Note</Label>
      <Textarea
        id="time-anchor-note"
        rows={2}
        maxlength={NOTE_LIMIT}
        placeholder="optional"
        class="min-h-14 w-full text-sm"
        bind:ref={noteField}
        bind:value={note}
      />
      <span class="text-muted-foreground block text-right text-[10px]">
        {note.length}/{NOTE_LIMIT}
      </span>
    </div>
  </div>
</ActionModal>
