<!--
  A modal that ends in Cancel plus one action. It owns the layout, every way out, the discard
  question and the busy lock, so a caller passes what the modal says and does and nothing else.
  See docs/development/ui-components.md.
-->
<script lang="ts">
  import { onDestroy, untrack, type Component, type Snippet } from 'svelte'
  import { Trash2 } from '@lucide/svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { createDrawerSwipeGuard } from '#lib/components/ui/drawer/index.ts'
  import { setTextareaUncapped } from '#lib/components/ui/textarea/index.ts'
  import { releaseOrphanScrollLock } from '#lib/utils/scrollLock.ts'
  import { MODAL_CLOSE_TRANSITION_MS } from '#lib/constants/layout.ts'
  import { cn } from '#lib/utils/cn.ts'
  import ModalActions from './ModalActions.svelte'
  import DiscardConfirm from './DiscardConfirm.svelte'
  import { decideClose, type CloseSource } from './actionModalClose'
  import { FEATURE_COLORS, type ActionTone } from './featureColors'

  interface Action {
    label: string
    icon?: Component<{ class?: string }>
    tone?: ActionTone
    disabled?: boolean
    onConfirm: () => void
  }

  interface Question {
    title: string
    description: string
    keepLabel?: string
    confirmLabel?: string
  }

  interface Removal {
    label: string
    /** Asked inside the modal before `onRemove` runs. */
    question: Question
    onRemove: () => void
  }

  interface Props {
    open?: boolean
    /** The user leaves without the action, after confirming any discard. Defaults to closing. */
    onCancel?: () => void
    /** Once the modal has finished closing, for a caller that unmounts it then. */
    onClosed?: () => void
    title: string
    description?: string | Snippet
    /** Only for a confirmation that warns, drawn before the title. */
    titleIcon?: Snippet
    /** Controls that belong under the description, read before the body they change. */
    headerExtra?: Snippet
    /** The body; a confirmation whose description says it all has none. */
    children?: Snippet
    action: Action
    cancelLabel?: string
    removal?: Removal
    busy?: boolean
    cancelWhileBusy?: boolean
    /** The modal holds something that would be lost; see the catalog for when that is. */
    dirty?: boolean
    discardQuestion?: Question
    size?: 'md' | 'lg'
    /** A tool is a sheet on a phone; a command stays a dialog. See the catalog. */
    presentation?: 'sheet' | 'dialog'
  }

  let {
    open = $bindable(false),
    onCancel,
    onClosed,
    title,
    description,
    titleIcon,
    headerExtra,
    children,
    action,
    cancelLabel,
    removal,
    busy = false,
    cancelWhileBusy = false,
    dirty = false,
    discardQuestion = {
      title: 'Discard your changes?',
      description: 'What you have entered here will be lost.',
    },
    size = 'md',
    presentation = 'dialog',
  }: Props = $props()

  setTextareaUncapped()

  let question = $state<'discard' | 'remove' | null>(null)
  /** What the sheet shows; `open` is what the caller asked for. They part while a sheet returns. */
  let sheetOpen = $state(untrack(() => open))
  /** Bumped to remount the modal, so a sheet brought back after a swipe starts from clean. */
  let modalKey = $state(0)
  let returning = false
  let wasOpen = untrack(() => open)
  let timer: ReturnType<typeof setTimeout> | null = null

  const locked = $derived(busy && !cancelWhileBusy)
  const shown = $derived(
    question === 'remove' && removal
      ? removal.question
      : { ...discardQuestion, confirmLabel: discardQuestion.confirmLabel ?? 'Discard' },
  )

  function schedule(fn: () => void) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, MODAL_CLOSE_TRANSITION_MS)
  }

  $effect(() => {
    if (open === wasOpen) return
    wasOpen = open
    if (open) {
      if (!returning) sheetOpen = true
      return
    }
    sheetOpen = false
    question = null
    // Unmounting skips `vaul`'s own restore, so the lock is released here; see `utils/scrollLock`.
    schedule(() => {
      releaseOrphanScrollLock()
      onClosed?.()
    })
  })

  // A pending timer would otherwise act on whichever modal has taken this one's place.
  onDestroy(() => {
    if (timer) clearTimeout(timer)
    releaseOrphanScrollLock()
  })

  function leave() {
    question = null
    if (onCancel) onCancel()
    else open = false
  }

  /**
   * Brings back a sheet `vaul` closed on its own, once it is fully out. Reopening it mid-close
   * leaves its swipe styles and scroll lock behind, over a sheet that cannot be seen.
   */
  function returnSheet(ask: boolean) {
    returning = true
    schedule(() => {
      returning = false
      if (!open) return
      releaseOrphanScrollLock()
      modalKey += 1
      sheetOpen = true
      if (ask && question === null) question = 'discard'
    })
  }

  function request(source: CloseSource) {
    const outcome = decideClose(source, {
      busy,
      cancelWhileBusy,
      dirty,
      questionOpen: question !== null,
    })
    if (outcome === 'ask') question = 'discard'
    else if (outcome === 'closeQuestion') question = null
    else if (outcome === 'close') leave()
    else if (outcome === 'return') returnSheet(false)
    else if (outcome === 'returnAndAsk') returnSheet(true)
  }

  // Only a sheet's own close reaches here: Escape and outside clicks are intercepted on the content.
  function handleOpenChange(next: boolean) {
    if (next || returning || !open) return
    request('sheet')
  }

  // A swipe on a sheet with something to lose stays put and asks, instead of closing.
  let swipeGuard: ReturnType<typeof createDrawerSwipeGuard> | null = null
  $effect(() => {
    const guard = createDrawerSwipeGuard(
      () => (dirty || question !== null) && !locked,
      () => {
        if (question === null) question = 'discard'
      },
    )
    swipeGuard = guard
    return () => guard.destroy()
  })

  function answer(confirmed: boolean) {
    const asked = question
    question = null
    if (!confirmed) return
    if (asked === 'remove') removal?.onRemove()
    else leave()
  }
</script>

{#key modalKey}
  <ResponsiveModal.Root
    bind:open={sheetOpen}
    dismissible={!locked}
    sheet={presentation === 'sheet'}
    onOpenChange={handleOpenChange}
  >
    <ResponsiveModal.Content
      class={cn(
        'flex max-h-[85dvh] flex-col gap-0 p-0',
        size === 'lg' ? 'max-w-lg' : 'max-w-md',
        // Inset from a phone's edges, where the dialog would otherwise run full width.
        presentation === 'dialog' && 'w-[calc(100%-2rem)] rounded-lg',
      )}
      onInteractOutside={(e: PointerEvent) => {
        e.preventDefault()
        request('outside')
      }}
      onEscapeKeydown={(e: KeyboardEvent) => {
        e.preventDefault()
        request('escape')
      }}
      onpointerup={(e: PointerEvent) => swipeGuard?.release(e)}
      onpointerout={(e: PointerEvent) => swipeGuard?.release(e)}
    >
      <div class="flex min-h-0 flex-1 flex-col" inert={question !== null}>
        <ResponsiveModal.Header class="border-b px-6 py-4" closeButton={false}>
          <ResponsiveModal.Title
            class={titleIcon && 'flex items-center justify-center gap-2 sm:justify-start'}
          >
            {@render titleIcon?.()}
            {title}
          </ResponsiveModal.Title>
          {#if typeof description === 'string'}
            <ResponsiveModal.Description>{description}</ResponsiveModal.Description>
          {:else if description}
            <ResponsiveModal.Description>{@render description()}</ResponsiveModal.Description>
          {/if}
          {@render headerExtra?.()}
        </ResponsiveModal.Header>

        <!-- The one scroller: the buttons scroll with the content, so what they do is read first. -->
        <div class="min-h-0 flex-1 overflow-y-auto">
          {#if children}
            <div class="space-y-3 px-6 py-4">
              {@render children()}
            </div>
          {/if}
          {#if removal}
            <div class="px-6 pb-4">
              <button
                type="button"
                class={cn(
                  'flex items-center gap-1.5 text-sm font-medium disabled:opacity-50',
                  FEATURE_COLORS.delete.text,
                )}
                disabled={busy}
                onclick={() => (question = 'remove')}
              >
                <Trash2 class="h-4 w-4" />
                {removal.label}
              </button>
            </div>
          {/if}
          <ModalActions
            label={action.label}
            icon={action.icon}
            tone={action.tone}
            disabled={action.disabled}
            onConfirm={action.onConfirm}
            onCancel={() => request('cancel')}
            {busy}
            {cancelWhileBusy}
            {cancelLabel}
          />
        </div>
      </div>

      <DiscardConfirm
        open={question !== null}
        title={shown.title}
        description={shown.description}
        keepLabel={shown.keepLabel}
        discardLabel={shown.confirmLabel}
        onCancel={() => answer(false)}
        onDiscard={() => answer(true)}
      />
    </ResponsiveModal.Content>
  </ResponsiveModal.Root>
{/key}
