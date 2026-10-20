<script lang="ts">
  import type { Component } from 'svelte'
  import { Loader2 } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'
  import * as ResponsiveModal from '#lib/components/ui/responsive-modal/index.ts'
  import { cn } from '#lib/utils/cn.ts'

  type Tone = 'danger' | 'default' | 'checkpoint' | 'branch'

  /** A confirmation modal's footer: Cancel and the action, side by side on a phone. */
  let {
    label,
    icon: Icon,
    onCancel,
    onConfirm,
    busy = false,
    disabled = false,
    tone = 'default',
  }: {
    label: string
    icon: Component<{ class?: string }>
    onCancel: () => void
    onConfirm: () => void
    /** The action runs: both buttons are disabled and the icon spins. */
    busy?: boolean
    disabled?: boolean
    tone?: Tone
  } = $props()

  const TONES: Record<Tone, string> = {
    danger: 'can-hover:text-foreground text-red-500 hover:text-red-500',
    default: '',
    checkpoint: 'bg-blue-500 text-white hover:bg-blue-600',
    branch: 'bg-amber-500 text-white hover:bg-amber-600',
  }
</script>

<ResponsiveModal.Footer class="border-t px-6 py-4">
  <span class="flex w-full gap-2 sm:w-auto">
    <Button variant="outline" class="flex-1 sm:flex-none" onclick={onCancel} disabled={busy}>
      Cancel
    </Button>
    <Button
      variant={tone === 'danger' ? 'outline' : 'default'}
      onclick={onConfirm}
      class={cn('flex-1 sm:flex-none', TONES[tone])}
      disabled={disabled || busy}
    >
      {#if busy}
        <Loader2 class="h-4 w-4 animate-spin" />
      {:else}
        <Icon class="h-4 w-4" />
      {/if}
      {label}
    </Button>
  </span>
</ResponsiveModal.Footer>
