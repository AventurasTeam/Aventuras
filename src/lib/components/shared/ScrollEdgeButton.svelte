<!-- A round floating button that scrolls to the top or bottom of a long view. -->
<script lang="ts">
  import { ChevronDown, ChevronUp } from '@lucide/svelte'
  import { Button } from '#lib/components/ui/button/index.ts'

  interface Props {
    edge: 'top' | 'bottom'
    label: string
    onclick: () => void
  }

  let { edge, label, onclick }: Props = $props()
</script>

<Button
  variant="secondary"
  size="icon"
  class="size-8 rounded-full shadow-lg sm:size-9"
  aria-label={label}
  title={label}
  {onclick}
>
  {#if edge === 'top'}
    <ChevronUp class="size-4 sm:size-5" />
  {:else}
    <ChevronDown class="size-4 sm:size-5" />
  {/if}
</Button>
