<script lang="ts">
  import type { Component } from 'svelte'
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
  } = $props()
</script>

<ResponsiveModal.Footer class="border-t px-6 py-4">
  <!-- Half the width each, until a label does not fit: then they stack in reading order. -->
  <span class="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
    <Button
      variant="outline"
      class="grow basis-[calc(50%-0.25rem)] sm:grow-0 sm:basis-auto"
      onclick={onCancel}
      disabled={busy && !cancelWhileBusy}
    >
      {cancelLabel}
    </Button>
    <Button
      variant={tone === 'default' ? 'default' : 'feature'}
      onclick={onConfirm}
      class={cn(
        'grow basis-[calc(50%-0.25rem)] sm:grow-0 sm:basis-auto',
        tone !== 'default' && FEATURE_COLORS[tone].vars,
      )}
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
