<!--
  A modal that ends in Cancel plus one action. It owns the layout, every way out, the discard
  question and the busy lock, so a caller passes what the modal says and does and nothing else.
  See docs/development/ui-components.md.
-->
<script lang="ts">
  import { onDestroy, untrack, type Component, type Snippet } from 'svelte'
  import { Trash2 } from '@lucide/svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { setTextareaUncapped } from '#lib/components/ui/textarea/index.ts'
  import { releaseOrphanScrollLock } from '#lib/utils/scrollLock.ts'
  import { claimBackPress } from '#lib/utils/backPress.ts'
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
    /**
     * A sheet on a phone, only for a tool with no text field, nothing to lose and an action Cancel
     * can stop: `vaul` closes a sheet on a handle tap without asking. See the catalog.
     */
    presentation?: 'sheet' | 'dialog'
  }

  let {
    open = $bindable(false),
    onCancel,
    onClosed,
    title,
    description,
    titleIcon,
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
  /** What the modal shows; a close is routed through `leave` before `open` follows. */
  let shownOpen = $state(untrack(() => open))
  let wasOpen = untrack(() => open)
  let timer: ReturnType<typeof setTimeout> | null = null
  let frame = $state<HTMLDivElement | null>(null)
  // What bits-ui's open focus could land on: a hidden form input or a disabled control cannot.
  const FOCUSABLE =
    'input:not([type=hidden]):not([aria-hidden=true]):enabled, textarea:enabled, select:enabled, button:enabled, [href], [tabindex="0"]'
  // A popup layer bits-ui portals to the end of the body, latest opened last.
  const OPEN_LAYER =
    '[data-state="open"]:is([role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"])'

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
      shownOpen = true
      return
    }
    shownOpen = false
    question = null
    // Unmounting skips `vaul`'s own restore, so the lock is released here; see `utils/scrollLock`.
    schedule(() => {
      releaseOrphanScrollLock()
      onClosed?.()
    })
  })

  // Android's back press reaches this as Escape directly, not through a synthetic key event. A
  // layer opened over the modal, such as a Select's list, is declined back to the caller's Escape.
  $effect(() => {
    if (!open) return
    return claimBackPress(() => {
      const content = frame?.closest('[role="dialog"]')
      if (!content || [...document.querySelectorAll(OPEN_LAYER)].at(-1) !== content) return false
      request('escape')
      return true
    })
  })

  // A pending timer would otherwise act on whichever modal has taken this one's place.
  onDestroy(() => {
    if (timer) clearTimeout(timer)
    releaseOrphanScrollLock()
  })

  /**
   * Focuses the field a caller marked `data-autofocus`, so a phone raises its keyboard. iOS
   * WKWebView raises no keyboard for a focus outside a tap (`KeyboardDisplayRequiresUserAction`):
   * the field is focused there, but the keyboard waits for the user. An unmarked text field is
   * never focused, as bits-ui would when it comes first, so the modal itself takes the focus.
   */
  function focusMarkedField(e: Event) {
    const marked = frame?.querySelector<HTMLElement>('[data-autofocus]')
    if (marked) {
      e.preventDefault()
      marked.focus({ preventScroll: true })
      return
    }
    const first = frame?.querySelector(FOCUSABLE)
    if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
      e.preventDefault()
      frame?.focus({ preventScroll: true })
    }
  }

  function leave() {
    question = null
    if (onCancel) onCancel()
    else open = false
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
  }

  // Only a sheet's swipe or handle tap reaches here: Escape and outside clicks are intercepted on
  // the content. `vaul` has already hidden the sheet and cannot be vetoed, so the modal closes
  // whatever `onCancel` does, and a running action it cannot stop is left to finish unseen.
  function handleOpenChange(next: boolean) {
    if (next || !open) return
    question = null
    if (!locked) onCancel?.()
    open = false
  }

  // Ctrl+Enter in any field acts, so a modal whose Enter only moves on still has a key to finish.
  function handleShortcut(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.isComposing) return
    if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return
    e.preventDefault()
    if (!action.disabled && !busy) action.onConfirm()
  }

  function answer(confirmed: boolean) {
    const asked = question
    question = null
    if (!confirmed) return
    if (asked === 'remove') removal?.onRemove()
    else leave()
  }
</script>

<ResponsiveModal.Root
  bind:open={shownOpen}
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
      // Held near the top on a phone when it has a text field, so the keyboard shortening the
      // screen does not move it; only its bottom edge comes up, and the content scrolls.
      presentation === 'dialog' &&
        'max-md:has-[input:not([type=hidden]):not([aria-hidden=true]),textarea]:top-[calc(var(--safe-top)+1rem)] max-md:has-[input:not([type=hidden]):not([aria-hidden=true]),textarea]:translate-y-0',
    )}
    onInteractOutside={(e: PointerEvent) => {
      e.preventDefault()
      request('outside')
    }}
    onEscapeKeydown={(e: KeyboardEvent) => {
      e.preventDefault()
      request('escape')
    }}
    onOpenAutoFocus={focusMarkedField}
    onkeydown={handleShortcut}
  >
    <div
      bind:this={frame}
      tabindex="-1"
      class="flex min-h-0 flex-1 flex-col outline-none"
      inert={question !== null}
    >
      <!-- Left-aligned at every width: a title or description that wraps reads badly centred. -->
      <ResponsiveModal.Header class="border-b px-6 py-4 text-left" closeButton={false}>
        <ResponsiveModal.Title class={cn('text-left', titleIcon && 'flex items-center gap-2')}>
          {@render titleIcon?.()}
          {title}
        </ResponsiveModal.Title>
        {#if typeof description === 'string'}
          <ResponsiveModal.Description class="text-left">{description}</ResponsiveModal.Description>
        {:else if description}
          <ResponsiveModal.Description class="text-left">
            {@render description()}
          </ResponsiveModal.Description>
        {/if}
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
