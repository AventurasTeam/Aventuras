<!--
  A modal that ends in Cancel plus one action. It owns the layout, every way out, the discard
  question and the busy lock, so a caller passes what the modal says and does and nothing else.
  See docs/development/ui-components.md.
-->
<script lang="ts">
  import { onDestroy, untrack, type Component, type Snippet } from 'svelte'
  import { fade } from 'svelte/transition'
  import { ArrowDownToLine, ArrowUpToLine, Trash2 } from '@lucide/svelte'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { setTextareaUncapped } from '#lib/components/ui/textarea/index.ts'
  import { Button } from '#lib/components/ui/button/index.ts'
  import { releaseOrphanScrollLock } from '#lib/utils/scrollLock.ts'
  import { claimBackPress } from '#lib/utils/backPress.ts'
  import { MODAL_CLOSE_TRANSITION_MS } from '#lib/constants/layout.ts'
  import { cn } from '#lib/utils/cn.ts'
  import ModalActions from './ModalActions.svelte'
  import DiscardConfirm from './DiscardConfirm.svelte'
  import { decideClose, type CloseSource } from './actionModalClose'
  import { readJumpState, type JumpState } from './scrollJump'
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
    /**
     * A way to do the job other than this modal, such as asking the assistant; left of the buttons.
     * It gets `leaveFor`, which asks before discarding edits and then runs what it is given.
     */
    alternative?: Snippet<[leaveFor: (next: () => void) => void]>
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
    /** The action waits for an edit: for a modal that edits values that already exist. */
    requireChange?: boolean
    /** See the catalog's width scale. */
    size?: 'md' | 'lg' | '2xl'
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
    alternative,
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
    requireChange = false,
    size = 'md',
    presentation = 'dialog',
  }: Props = $props()

  setTextareaUncapped()

  let question = $state<'discard' | 'remove' | null>(null)
  /** Run instead of closing when the discard was asked on the way somewhere else. */
  let afterDiscard: (() => void) | null = null
  /** What the modal shows; a close is routed through `leave` before `open` follows. */
  let shownOpen = $state(untrack(() => open))
  let wasOpen = untrack(() => open)
  let timer: ReturnType<typeof setTimeout> | null = null
  let frame = $state<HTMLDivElement | null>(null)
  /** Scrolls on a phone, where the buttons scroll with the body. */
  let outerScroller = $state<HTMLDivElement | null>(null)
  /** Scrolls from 768px up, between the pinned header and buttons. */
  let bodyScroller = $state<HTMLDivElement | null>(null)
  let jump = $state<JumpState>({ long: false, atTop: true, atBottom: false })
  let tallestScroller = 0
  let jumping = false

  /** Whichever of the two scrollers this width uses. */
  function activeScroller(): HTMLDivElement | null {
    for (const el of [bodyScroller, outerScroller]) {
      if (el && getComputedStyle(el).overflowY === 'auto') return el
    }
    return null
  }

  function measureJump() {
    if (jumping) return
    const el = activeScroller()
    if (!el) {
      jump = { long: false, atTop: true, atBottom: false }
      return
    }
    tallestScroller = Math.max(tallestScroller, el.clientHeight)
    jump = readJumpState({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      tallest: tallestScroller,
    })
  }

  async function jumpTo(edge: 'top' | 'bottom') {
    const el = activeScroller()
    if (!el) return
    // The tapped button goes at the edge it leads to, and the dialog's focus trap would
    // scroll the focus it loses back into view; this also closes a phone's keyboard.
    frame?.focus({ preventScroll: true })
    // Jumping down while a phone's keyboard is up would land short of the bottom once it closes.
    if (
      edge === 'bottom' &&
      el.clientHeight < tallestScroller &&
      matchMedia('(pointer: coarse)').matches
    ) {
      await untilRestored(el)
    }
    // The buttons change only once the jump has painted: a phone can spend longer than the fade
    // drawing the far end, and would show the buttons already changed.
    jumping = true
    el.scrollTo({ top: edge === 'top' ? 0 : el.scrollHeight })
    await nextFrame()
    await nextFrame()
    jumping = false
    measureJump()
  }

  function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()))
  }

  /** Resolves once the scroller is back to its tallest, or after `KEYBOARD_CLOSE_MS`. */
  function untilRestored(el: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        observer.disconnect()
        clearTimeout(fallback)
        resolve()
      }
      const observer = new ResizeObserver(() => {
        if (el.clientHeight >= tallestScroller) done()
      })
      const fallback = setTimeout(done, KEYBOARD_CLOSE_MS)
      observer.observe(el)
    })
  }

  // Remeasured as the content or the window changes size, not only on scroll.
  $effect(() => {
    const scrollers = [outerScroller, bodyScroller].filter((el) => el !== null)
    if (scrollers.length === 0) return
    const observer = new ResizeObserver(measureJump)
    for (const el of scrollers) {
      observer.observe(el)
      if (el.firstElementChild) observer.observe(el.firstElementChild)
    }
    measureJump()
    return () => observer.disconnect()
  })
  const KEYBOARD_CLOSE_MS = 600
  // What bits-ui's open focus could land on: a hidden form input or a disabled control cannot.
  const FOCUSABLE =
    'input:not([type=hidden]):not([aria-hidden=true]):enabled, textarea:enabled, select:enabled, button:enabled, [href], [tabindex="0"]'
  // A popup layer bits-ui portals to the end of the body, latest opened last.
  const OPEN_LAYER =
    '[data-state="open"]:is([role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"])'

  const locked = $derived(busy && !cancelWhileBusy)
  const actionDisabled = $derived(action.disabled || (requireChange && !dirty))
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
      tallestScroller = 0
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
    if (outcome === 'ask') {
      afterDiscard = null
      question = 'discard'
    } else if (outcome === 'closeQuestion') {
      question = null
      afterDiscard = null
    } else if (outcome === 'close') leave()
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
    if (!actionDisabled && !busy) action.onConfirm()
  }

  function leaveFor(next: () => void) {
    if (locked || question !== null) return
    if (!dirty) return next()
    afterDiscard = next
    question = 'discard'
  }

  function answer(confirmed: boolean) {
    const asked = question
    const then = afterDiscard
    question = null
    afterDiscard = null
    if (!confirmed) return
    if (then) return then()
    if (asked === 'remove') removal?.onRemove()
    else leave()
  }
</script>

{#snippet leaveVia()}
  {@render alternative?.(leaveFor)}
{/snippet}

{#snippet jumpButton(edge: 'top' | 'bottom', shown: boolean)}
  {@const label = edge === 'top' ? 'Jump to the top' : 'Jump to the bottom'}
  <!-- A slot of its own, so the other button keeps its place while this one fades. -->
  <span class="flex size-9">
    {#if shown}
      <span class="pointer-events-auto flex" transition:fade={{ duration: 150 }}>
        <Button
          variant="outline"
          size="icon"
          class="bg-background size-9 rounded-full shadow-md"
          aria-label={label}
          title={label}
          onclick={() => void jumpTo(edge)}
        >
          {#if edge === 'top'}
            <ArrowUpToLine class="size-4" />
          {:else}
            <ArrowDownToLine class="size-4" />
          {/if}
        </Button>
      </span>
    {/if}
  </span>
{/snippet}

<ResponsiveModal.Root
  bind:open={shownOpen}
  dismissible={!locked}
  sheet={presentation === 'sheet'}
  onOpenChange={handleOpenChange}
>
  <ResponsiveModal.Content
    class={cn(
      'flex max-h-[85dvh] flex-col gap-0 p-0',
      { md: 'max-w-md', lg: 'max-w-lg', '2xl': 'max-w-2xl' }[size],
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
      <!-- Tinted like the buttons' panel, so both read as a frame around the body. -->
      <ResponsiveModal.Header class="bg-muted/40 border-b px-6 py-4 text-left" closeButton={false}>
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

      <!--
        On a phone the buttons scroll with the content, which leaves the small screen to it. From
        768px up the body scrolls alone and the buttons stay pinned under it. Either way there is
        one scroller.
      -->
      <div
        bind:this={outerScroller}
        class="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto"
        onscroll={measureJump}
      >
        <div
          bind:this={bodyScroller}
          class="md:min-h-0 md:flex-1 md:overflow-y-auto"
          onscroll={measureJump}
        >
          {#if children}
            <div class="space-y-3 px-6 py-4">
              {@render children()}
            </div>
          {/if}
          {#if removal}
            <div class="px-6 pb-4">
              <Button
                variant="outline"
                size="sm"
                class={cn('gap-1.5', FEATURE_COLORS.delete.text, FEATURE_COLORS.delete.hoverText)}
                disabled={busy}
                onclick={() => (question = 'remove')}
              >
                <Trash2 class="h-4 w-4" />
                {removal.label}
              </Button>
            </div>
          {/if}
          {#if jump.long}
            <!--
              Sticks to the bottom of whichever scroller this width uses, and never below the body,
              so on a phone it stops above the buttons as they scroll into view.
            -->
            <div class="pointer-events-none sticky bottom-0 h-0">
              <div class="absolute right-3 bottom-3 flex flex-col gap-2">
                {@render jumpButton('top', !jump.atTop)}
                {@render jumpButton('bottom', !jump.atBottom)}
              </div>
            </div>
          {/if}
        </div>
        <ModalActions
          label={action.label}
          icon={action.icon}
          tone={action.tone}
          disabled={actionDisabled}
          onConfirm={action.onConfirm}
          onCancel={() => request('cancel')}
          {busy}
          {cancelWhileBusy}
          {cancelLabel}
          alternative={alternative ? leaveVia : undefined}
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
