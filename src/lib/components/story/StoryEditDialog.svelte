<!--
  Edits a library story's title, genre, genre colour, description and narrative voice. Every text
  field wraps and grows, since a card's header cannot show a long title and a description can run
  to paragraphs. The voice stays locked until asked for, since it changes every new entry. Mounted
  fresh for each edit and seeded from the stored story, so dismissing it leaves nothing behind to
  reset.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import ExplanationFold from '#lib/components/shared/ExplanationFold.svelte'
  import NarrativeVoiceFields from '#lib/components/shared/NarrativeVoiceFields.svelte'
  import { AlertTriangle, ChevronDown, Check } from '@lucide/svelte'
  import { Switch } from '#lib/components/ui/switch/index.ts'
  import { Textarea } from '#lib/components/ui/textarea/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import TagBadge from '#lib/components/tags/TagBadge.svelte'
  import { cn } from '#lib/utils/cn.ts'
  import { storyPov, storyTense } from '#lib/utils/storySettings.ts'
  import type { Story, StoryDetails } from '#lib/types/index.ts'
  import {
    GENRE_COLORS,
    GENRE_COLOR_KEYS,
    isGenreColorKey,
    resolveGenreColor,
    type GenreColorKey,
  } from './genreColors'

  interface Props {
    story: Story
    /** Rejects when nothing was stored, which keeps the dialog open with its edits. */
    onSave: (details: StoryDetails) => Promise<void>
    onClose: () => void
  }

  let { story: s, onSave, onClose }: Props = $props()

  // Seeded once: the dialog is mounted per edit, and must not follow the card while it is open.
  const initial = untrack(() => s)
  let title = $state(initial.title)
  let genre = $state(initial.genre ?? '')
  let description = $state(initial.description ?? '')
  // An unknown key from a newer build is kept as is: the swatches show "Default" as current,
  // but saving untouched must not quietly drop it.
  let genreColor = $state<string | null>(initial.settings?.genreColor ?? null)
  let colorsOpen = $state(false)
  const initialPOV = storyPov(initial)
  const initialTense = storyTense(initial)
  let pov = $state(initialPOV)
  let tense = $state(initialTense)
  let voiceUnlocked = $state(false)
  let saving = $state(false)
  let isOpen = $state(true)

  const voiceChanged = $derived(pov !== initialPOV || tense !== initialTense)
  const dirty = $derived(
    title.trim() !== initial.title.trim() ||
      genre.trim() !== (initial.genre ?? '').trim() ||
      description.trim() !== (initial.description ?? '').trim() ||
      genreColor !== (initial.settings?.genreColor ?? null) ||
      voiceChanged,
  )

  const canSave = $derived(title.trim().length > 0 && !saving)
  const hasGenre = $derived(genre.trim().length > 0)
  const selectedKey = $derived<GenreColorKey | null>(
    isGenreColorKey(genreColor) ? genreColor : null,
  )
  // Derived rather than closed by an effect, so it never disagrees with the genre for a frame.
  const showColors = $derived(colorsOpen && hasGenre)

  async function save() {
    if (!canSave) return
    saving = true
    try {
      await onSave({ title, genre, description, genreColor, pov, tense })
    } catch {
      return
    } finally {
      saving = false
    }
    isOpen = false
  }

  /** Locking again restores the stored voice, so a locked field never hides a change. */
  function setVoiceUnlocked(unlocked: boolean) {
    voiceUnlocked = unlocked
    if (unlocked) return
    pov = initialPOV
    tense = initialTense
  }

  /** Title and genre are single values that wrap for display; a line break is never stored. */
  function singleLine(e: Event & { currentTarget: HTMLTextAreaElement }, set: (v: string) => void) {
    const el = e.currentTarget
    if (!/[\r\n]/.test(el.value)) return
    // A CRLF is one break, so the caret is recounted from the collapsed text ahead of it.
    const collapse = (text: string) => text.replace(/\r\n|[\r\n]/g, ' ')
    const start = collapse(el.value.slice(0, el.selectionStart)).length
    const end = collapse(el.value.slice(0, el.selectionEnd)).length
    el.value = collapse(el.value)
    el.setSelectionRange(start, end)
    set(el.value)
  }
</script>

<ActionModal
  bind:open={isOpen}
  onClosed={onClose}
  title="Edit story"
  action={{ label: 'Save', disabled: !canSave, onConfirm: () => void save() }}
  busy={saving}
  {dirty}
  requireChange
  discardQuestion={{
    title: 'Discard your changes?',
    description: 'Your edits to this story will be lost.',
  }}
  size="2xl"
>
  <ExplanationFold id="story_edit_help" summary="How these are used">
    <p>
      Genre, description, perspective and tense are used when generating new entries in this story,
      unless a custom system prompt leaves them out. Old entries are not affected.
    </p>
  </ExplanationFold>
  <div class="space-y-1.5">
    <Label for="story-edit-title">Title</Label>
    <Textarea
      id="story-edit-title"
      rows={1}
      class="min-h-9"
      bind:value={title}
      enterkeyhint="next"
      oninput={(e) => singleLine(e, (v) => (title = v))}
    />
  </div>

  <div class="space-y-1.5">
    <Label for="story-edit-genre">Genre</Label>
    <Textarea
      id="story-edit-genre"
      rows={1}
      class="min-h-9"
      placeholder="e.g. Fantasy"
      bind:value={genre}
      enterkeyhint="next"
      oninput={(e) => singleLine(e, (v) => (genre = v))}
    />

    <button
      type="button"
      class="text-muted-foreground hover:text-foreground flex items-center gap-2 pt-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!hasGenre}
      aria-expanded={showColors}
      aria-controls="story-edit-genre-colors"
      onclick={() => (colorsOpen = !colorsOpen)}
    >
      <span class="text-foreground">Badge colour:</span>
      {#if hasGenre}
        <TagBadge name={genre.trim()} color={resolveGenreColor(genre.trim(), genreColor)} />
      {/if}
      <ChevronDown class={cn('size-3.5 transition-transform', showColors && 'rotate-180')} />
    </button>

    {#if showColors}
      <div
        id="story-edit-genre-colors"
        role="radiogroup"
        aria-label="Badge colour"
        class="flex flex-wrap items-center gap-2 pt-1"
      >
        <button
          type="button"
          role="radio"
          aria-checked={selectedKey === null}
          class={cn(
            'border-border text-muted-foreground hover:text-foreground h-7 rounded-md border px-2 text-xs',
            selectedKey === null && 'ring-ring ring-2 ring-offset-1',
          )}
          onclick={() => (genreColor = null)}
        >
          Default
        </button>
        {#each GENRE_COLOR_KEYS as key, i (i)}
          <button
            type="button"
            role="radio"
            aria-checked={selectedKey === key}
            aria-label={GENRE_COLORS[key].label}
            title={GENRE_COLORS[key].label}
            class={cn(
              'flex size-7 items-center justify-center rounded-full',
              GENRE_COLORS[key].swatch,
              selectedKey === key && 'ring-ring ring-2 ring-offset-1',
            )}
            onclick={() => (genreColor = key)}
          >
            {#if selectedKey === key}
              <Check class="size-4 text-white" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="space-y-1.5">
    <Label for="story-edit-description">Description</Label>
    <Textarea id="story-edit-description" placeholder="No description" bind:value={description} />
  </div>

  <div class="space-y-3 border-t pt-4">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-sm font-medium">Narrative voice</h3>
      <div class="flex items-center gap-2">
        <Label for="story-edit-voice-unlock" class="text-muted-foreground text-xs">Unlock</Label>
        <Switch
          id="story-edit-voice-unlock"
          checked={voiceUnlocked}
          onCheckedChange={setVoiceUnlocked}
        />
      </div>
    </div>
    <NarrativeVoiceFields
      selectedPOV={pov}
      selectedTense={tense}
      onPOVChange={(v) => (pov = v)}
      onTenseChange={(v) => (tense = v)}
      disabled={{ pov: !voiceUnlocked, tense: !voiceUnlocked }}
    />
    {#if voiceChanged}
      <p
        class="text-muted-foreground flex items-start gap-2 text-xs"
        {@attach (el) => el.scrollIntoView({ block: 'nearest' })}
      >
        <AlertTriangle class="text-warning mt-px size-4 shrink-0" />
        Old entries keep their wording. New entries are written in the new voice.
      </p>
    {/if}
  </div>
</ActionModal>
