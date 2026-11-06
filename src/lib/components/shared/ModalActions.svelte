<script lang="ts">
  import type { Component, Snippet } from 'svelte'
  import { Loader2 } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import ModalFooter from './ModalFooter.svelte'
  import { cn } from '#lib/utils/cn.ts'
  import { FEATURE_COLORS, type ActionTone } from './featureColors'
  import { PAIR_BUTTON, PAIR_ROW } from './buttonPair'

  /** A confirmation modal's footer: Cancel and the action, side by side on a phone. */
  let {
    label,
    icon: Icon,
    onCancel,
    onConfirm,
    busy = false,
    cancelWhileBusy = false,
    disabled = false,
    tone = 'default',
    cancelLabel = 'Cancel',
    centered = false,
    alternative,
  }: {
    label: string
    icon?: Component<{ class?: string }>
    onCancel: () => void
    onConfirm: () => void
    /** The action runs: the action is disabled and its icon spins; Cancel too, unless `cancelWhileBusy`. */
    busy?: boolean
    cancelWhileBusy?: boolean
    disabled?: boolean
    tone?: ActionTone
    /** Only when Cancel ends more than the modal, as "Cancel import" does. */
    cancelLabel?: string
    /** The pair centred rather than at the trailing edge, for a footer only as wide as it. */
    centered?: boolean
    /** Another way to do the job, at the left; above the pair on a phone. */
    alternative?: Snippet
  } = $props()
</script>

<ModalFooter class={centered ? 'sm:justify-center' : undefined}>
  {#if alternative}
    <span class="flex w-full max-sm:order-1 sm:mr-auto sm:w-auto">{@render alternative()}</span>
  {/if}
  <span class={PAIR_ROW}>
    <Button
      variant="outline"
      class={PAIR_BUTTON}
      onclick={onCancel}
      disabled={busy && !cancelWhileBusy}
    >
      {cancelLabel}
    </Button>
    <Button
      variant={tone === 'default' ? 'default' : 'feature'}
      onclick={onConfirm}
      class={cn(PAIR_BUTTON, tone !== 'default' && FEATURE_COLORS[tone].vars)}
      disabled={disabled || busy}
    >
      {#if busy}
        <Loader2 class="h-4 w-4 animate-spin" />
      {:else if Icon}
        <Icon class="h-4 w-4" />
      {/if}
      {label}
    </Button>
  </span>
</ModalFooter>
