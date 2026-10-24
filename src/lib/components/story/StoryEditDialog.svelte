<!--
  Edits a library story's title, genre, genre colour and description. Every field wraps and
  grows, since a card's header cannot show a long title and a description can run to
  paragraphs. Mounted fresh for each edit and seeded from the stored story, so dismissing it
  leaves nothing behind to reset.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import ActionModal from '#lib/components/shared/ActionModal.svelte'
  import { ChevronDown, Check } from '@lucide/svelte'
  import { Textarea } from '#lib/components/ui/textarea/index.ts'
  import { Label } from '#lib/components/ui/label/index.ts'
  import TagBadge from '#lib/components/tags/TagBadge.svelte'
  import { cn } from '#lib/utils/cn.ts'
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
  let saving = $state(false)
  let isOpen = $state(true)

  const dirty = $derived(
    title.trim() !== initial.title.trim() ||
      genre.trim() !== (initial.genre ?? '').trim() ||
      description.trim() !== (initial.description ?? '').trim() ||
      genreColor !== (initial.settings?.genreColor ?? null),
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
      await onSave({ title, genre, description, genreColor })
    } catch {
      return
    } finally {
      saving = false
    }
    isOpen = false
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

  function handleKeydown(e: KeyboardEvent, nextFieldId?: string) {
    if (e.key !== 'Enter' || e.isComposing || e.ctrlKey || e.metaKey) return
    if (nextFieldId) {
      // A single-value field takes no line break, and a phone's return key must not save a
      // half-typed form. It moves on instead, which is what its "next" label promises.
      e.preventDefault()
      document.getElementById(nextFieldId)?.focus()
    }
  }
</script>

<ActionModal
  presentation="sheet"
  bind:open={isOpen}
  onClosed={onClose}
  title="Edit story"
  description="Genre and description are used when generating every new entry in this story. Old entries are not affected."
  action={{ label: 'Save', disabled: !canSave, onConfirm: () => void save() }}
  busy={saving}
  {dirty}
  discardQuestion={{
    title: 'Discard your changes?',
    description: 'Your edits to this story will be lost.',
  }}
  size="lg"
>
  <div class="space-y-1.5">
    <Label for="story-edit-title">Title</Label>
    <Textarea
      id="story-edit-title"
      rows={1}
      class="min-h-9"
      bind:value={title}
      enterkeyhint="next"
      oninput={(e) => singleLine(e, (v) => (title = v))}
      onkeydown={(e) => handleKeydown(e, 'story-edit-genre')}
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
      onkeydown={(e) => handleKeydown(e, 'story-edit-description')}
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
      <ChevronDown class={cn('h-3.5 w-3.5 transition-transform', showColors && 'rotate-180')} />
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
              'flex h-7 w-7 items-center justify-center rounded-full',
              GENRE_COLORS[key].swatch,
              selectedKey === key && 'ring-ring ring-2 ring-offset-1',
            )}
            onclick={() => (genreColor = key)}
          >
            {#if selectedKey === key}
              <Check class="h-4 w-4 text-white" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="space-y-1.5">
    <Label for="story-edit-description">Description</Label>
    <Textarea
      id="story-edit-description"
      placeholder="No description"
      bind:value={description}
      onkeydown={(e) => handleKeydown(e)}
    />
  </div>
</ActionModal>
