<script lang="ts">
  import type { Component, Snippet } from 'svelte'
  import { Loader2 } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { cn } from '#lib/utils/cn.ts'
  import { FEATURE_COLORS, type ActionTone } from './featureColors'

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
    /** Another way to do the job, at the left; above the pair on a phone. */
    alternative?: Snippet
  } = $props()
</script>

<ResponsiveModal.Footer class="bg-muted/40 gap-2 border-t px-6 py-4 sm:space-x-0">
  {#if alternative}
    <span class="flex w-full max-sm:order-1 sm:mr-auto sm:w-auto">{@render alternative()}</span>
  {/if}
  <!-- On a phone half the width each, stacking in reading order when a label does not fit; from
       640px up both as wide as the wider. -->
  <span
    class="flex w-full flex-wrap gap-2 sm:inline-grid sm:w-auto sm:auto-cols-fr sm:grid-flow-col"
  >
    <Button
      variant="outline"
      class="basis-pair grow"
      onclick={onCancel}
      disabled={busy && !cancelWhileBusy}
    >
      {cancelLabel}
    </Button>
    <Button
      variant={tone === 'default' ? 'default' : 'feature'}
      onclick={onConfirm}
      class={cn('basis-pair grow', tone !== 'default' && FEATURE_COLORS[tone].vars)}
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
</ResponsiveModal.Footer>
