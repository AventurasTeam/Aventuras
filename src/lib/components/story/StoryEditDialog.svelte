<!--
  Edits a library story's title, genre, genre colour and description. Every field wraps and
  grows, since a card's header cannot show a long title and a description can run to
  paragraphs. Mounted fresh for each edit and seeded from the stored story, so dismissing it
  leaves nothing behind to reset.
-->
<script lang="ts" module>
  export interface StoryDetails {
    title: string
    genre: string | null
    description: string | null
    genreColor: string | null
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { ChevronDown, Check } from '@lucide/svelte'
  import * as ResponsiveModal from '$lib/components/ui/responsive-modal'
  import { Button } from '$lib/components/ui/button'
  import { Textarea } from '$lib/components/ui/textarea'
  import { Label } from '$lib/components/ui/label'
  import TagBadge from '$lib/components/tags/TagBadge.svelte'
  import { cn } from '$lib/utils/cn'
  import { createIsMobile } from '$lib/hooks/is-mobile.svelte'
  import { blurFocusedElement, releaseOrphanScrollLock } from '$lib/utils/scrollLock'
  import { MODAL_CLOSE_TRANSITION_MS } from '$lib/constants/layout'
  import WizardExitConfirm from '../wizard/WizardExitConfirm.svelte'
  import { createDrawerSwipeGuard } from '$lib/components/ui/drawer'
  import type { Story } from '$lib/types'
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
  let closing = false
  let returning = false
  /** Bumped to remount the modal, so a sheet brought back after a swipe starts from clean. */
  let modalKey = $state(0)
  let showDiscardConfirm = $state(false)
  const isMobile = createIsMobile()

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

  $effect(() => {
    if (!hasGenre) colorsOpen = false
  })

  // Unmounting skips `vaul`'s own restore, so the lock is released here; see `utils/scrollLock`.
  function close() {
    closing = true
    blurFocusedElement(isMobile.current)
    isOpen = false
    setTimeout(() => {
      releaseOrphanScrollLock()
      onClose()
    }, MODAL_CLOSE_TRANSITION_MS)
  }

  onDestroy(() => releaseOrphanScrollLock())

  /** Only a drawer swipe gets here: Escape and outside clicks are intercepted on the content. */
  // An edited sheet swiped down stays put and asks, instead of closing.
  let swipeGuard: ReturnType<typeof createDrawerSwipeGuard> | null = null
  $effect(() => {
    const guard = createDrawerSwipeGuard(
      () => dirty && !saving,
      () => (showDiscardConfirm = true),
    )
    swipeGuard = guard
    return () => guard.destroy()
  })

  function handleOpenChange(open: boolean) {
    if (open || closing || returning) return
    if (!dirty) return close()
    // Only if the swipe guard misjudged `vaul`'s close. Reopening the same drawer mid-close
    // leaves its swipe styles and scroll lock behind, so a fresh one comes back to ask.
    returning = true
    setTimeout(() => {
      releaseOrphanScrollLock()
      modalKey += 1
      isOpen = true
      showDiscardConfirm = true
      returning = false
    }, MODAL_CLOSE_TRANSITION_MS)
  }

  function requestClose() {
    if (saving) return
    if (dirty) showDiscardConfirm = true
    else close()
  }

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
    close()
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

  function handleKeydown(e: KeyboardEvent, multiline: boolean) {
    if (e.key !== 'Enter' || e.isComposing) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      void save()
    } else if (!multiline) {
      // Neither a line break nor a save: a phone's return key must not submit a half-typed form.
      e.preventDefault()
    }
  }
</script>

{#key modalKey}
  <ResponsiveModal.Root bind:open={isOpen} dismissible={!saving} onOpenChange={handleOpenChange}>
    <ResponsiveModal.Content
      class="flex max-h-[85vh] max-w-lg flex-col gap-0 p-0"
      onInteractOutside={(e: PointerEvent) => {
        e.preventDefault()
        requestClose()
      }}
      onpointerup={(e: PointerEvent) => swipeGuard?.release(e)}
      onpointerout={(e: PointerEvent) => swipeGuard?.release(e)}
      onEscapeKeydown={(e: KeyboardEvent) => {
        e.preventDefault()
        if (showDiscardConfirm) showDiscardConfirm = false
        else requestClose()
      }}
    >
      <!-- One scroller either way: the fields on desktop, the whole sheet on mobile. -->
      <div
        class={cn('min-h-0 flex-1', isMobile.current ? 'overflow-y-auto' : 'flex flex-col')}
        inert={showDiscardConfirm}
      >
        <ResponsiveModal.Header class="border-b px-4 py-4" closeButton={false}>
          <ResponsiveModal.Title>Edit Story</ResponsiveModal.Title>
          <ResponsiveModal.Description>
            Genre and description are used when generating every new entry in this story. Old
            entries are not affected.
          </ResponsiveModal.Description>
        </ResponsiveModal.Header>

        <div
          class={cn('space-y-4 px-4 py-4', !isMobile.current && 'min-h-0 flex-1 overflow-y-auto')}
        >
          <div class="space-y-1.5">
            <Label for="story-edit-title">Title</Label>
            <Textarea
              id="story-edit-title"
              rows={1}
              class="max-h-none min-h-9"
              bind:value={title}
              enterkeyhint="next"
              oninput={(e) => singleLine(e, (v) => (title = v))}
              onkeydown={(e) => handleKeydown(e, false)}
            />
          </div>

          <div class="space-y-1.5">
            <Label for="story-edit-genre">Genre</Label>
            <Textarea
              id="story-edit-genre"
              rows={1}
              class="max-h-none min-h-9"
              placeholder="e.g. Fantasy"
              bind:value={genre}
              enterkeyhint="next"
              oninput={(e) => singleLine(e, (v) => (genre = v))}
              onkeydown={(e) => handleKeydown(e, false)}
            />

            <button
              type="button"
              class="text-muted-foreground hover:text-foreground flex items-center gap-2 pt-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasGenre}
              aria-expanded={colorsOpen}
              aria-controls="story-edit-genre-colors"
              onclick={() => (colorsOpen = !colorsOpen)}
            >
              <span class="text-foreground">Badge colour:</span>
              {#if hasGenre}
                <TagBadge name={genre.trim()} color={resolveGenreColor(genre.trim(), genreColor)} />
              {/if}
              <ChevronDown
                class={cn('h-3.5 w-3.5 transition-transform', colorsOpen && 'rotate-180')}
              />
            </button>

            {#if colorsOpen}
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
                {#each GENRE_COLOR_KEYS as key (key)}
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
              class="max-h-none"
              placeholder="No description"
              bind:value={description}
              onkeydown={(e) => handleKeydown(e, true)}
            />
          </div>
        </div>

        <ResponsiveModal.Footer class="mt-auto border-t px-4 py-4">
          <Button variant="outline" onclick={requestClose} disabled={saving}>Cancel</Button>
          <Button onclick={save} disabled={!canSave}>Save</Button>
        </ResponsiveModal.Footer>
      </div>

      <WizardExitConfirm
        open={showDiscardConfirm}
        title="Discard your changes?"
        description="Your edits to this story will be lost."
        onCancel={() => (showDiscardConfirm = false)}
        onDiscard={() => {
          showDiscardConfirm = false
          close()
        }}
      />
    </ResponsiveModal.Content>
  </ResponsiveModal.Root>
{/key}
